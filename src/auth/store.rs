//! `auth.toml` and `host_id` in the state directory (auth.md "State on disk").
//!
//! Every write of `auth.toml` holds the `lock` file's `flock` for its whole
//! read-modify-write and lands by temp file, `fsync`, rename and directory `fsync`, so
//! a reader sees the old file or the new one, and a crash leaves one of them. Reads
//! take no lock. The daemon and the CLI both write; nothing caches the file.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Write as _};
use std::os::unix::fs::{DirBuilderExt as _, OpenOptionsExt as _, PermissionsExt as _};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use serde::{Deserialize, Serialize};
use thiserror::Error;

use super::token::{self, Hash};

/// Wrong codes before the pending code is deleted.
pub const MAX_WRONG_TRIES: u32 = 5;
/// Device names are cut to this many characters.
const NAME_LIMIT: usize = 64;

const AUTH: &str = "auth.toml";
const HOST_ID: &str = "host_id";
const LOCK: &str = "lock";

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct AuthFile {
    #[serde(default, rename = "device", skip_serializing_if = "Vec::is_empty")]
    pub devices: Vec<Device>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending: Option<Pending>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Device {
    pub name: String,
    /// sha256 of the token, hex. The token itself is never stored.
    pub token_sha256: String,
    /// RFC 3339, UTC.
    pub enrolled_at: String,
    /// The Tailscale login that enrolled it, or `cli`.
    pub enrolled_by: String,
}

/// The enrolment code `tether enroll` printed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Pending {
    /// sha256 of the normalized code, hex.
    pub code_sha256: String,
    /// RFC 3339, UTC.
    pub expires_at: String,
    pub wrong_tries: u32,
}

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("{}: {source}", path.display())]
    Io { path: PathBuf, source: io::Error },
    /// Only the position: the message could quote the file.
    #[error("{} doesn't parse (line {line})", path.display())]
    Parse { path: PathBuf, line: usize },
    #[error("{} doesn't hold a host id", path.display())]
    BadHostId { path: PathBuf },
    #[error("can't encode auth.toml: {0}")]
    Encode(#[from] toml::ser::Error),
    #[error("no random bytes: {0}")]
    Random(#[from] getrandom::Error),
}

#[derive(Debug, Error)]
pub enum EnrollError {
    /// Wrong, expired, or none pending.
    #[error("bad enrolment code")]
    BadCode,
    #[error(transparent)]
    Store(#[from] StoreError),
}

/// A device the store added, with its token, which exists only here.
#[derive(Debug)]
pub struct Added {
    pub name: String,
    pub token: String,
}

#[derive(Debug, Clone)]
pub struct Store {
    dir: PathBuf,
}

impl Store {
    /// The state directory, created 0700 if missing.
    pub fn open(dir: PathBuf) -> Result<Self, StoreError> {
        fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(&dir)
            .map_err(io_at(&dir))?;
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).map_err(io_at(&dir))?;
        Ok(Self { dir })
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// The host id, written by whichever of daemon or CLI needs it first and never
    /// rewritten.
    pub fn host_id(&self) -> Result<String, StoreError> {
        let path = self.dir.join(HOST_ID);
        if let Some(id) = self.read_host_id(&path)? {
            return Ok(id);
        }
        let _lock = self.lock()?;
        if let Some(id) = self.read_host_id(&path)? {
            return Ok(id);
        }
        let id = token::host_id()?;
        self.replace(HOST_ID, &format!("{id}\n"))?;
        Ok(id)
    }

    fn read_host_id(&self, path: &Path) -> Result<Option<String>, StoreError> {
        match fs::read_to_string(path) {
            Ok(text) if token::is_host_id(text.trim()) => Ok(Some(text.trim().to_owned())),
            Ok(_) => Err(StoreError::BadHostId {
                path: path.to_owned(),
            }),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(io_at(path)(error)),
        }
    }

    /// The file as it is now, with no lock: writes replace it whole.
    pub fn read(&self) -> Result<AuthFile, StoreError> {
        let path = self.dir.join(AUTH);
        loaded(&path, fs::read_to_string(&path))
    }

    /// `read` without blocking the runtime, for each request's check.
    pub async fn read_async(&self) -> Result<AuthFile, StoreError> {
        let path = self.dir.join(AUTH);
        loaded(&path, tokio::fs::read_to_string(&path).await)
    }

    /// `tether enroll`: a new pending code, replacing any earlier one.
    pub fn set_pending(&self, ttl: Duration, now: SystemTime) -> Result<String, StoreError> {
        let code = token::new_code()?;
        let pending = Pending {
            code_sha256: token::hex(&token::hash(&token::normalize_code(&code))),
            expires_at: rfc3339(now + ttl),
            wrong_tries: 0,
        };
        self.update(|file| file.pending = Some(pending))?;
        Ok(code)
    }

    /// `POST /auth/enroll`. A right code adds the device and consumes the code in one
    /// write. A wrong one counts against the code in the file, so the count survives
    /// a restart, and the fifth deletes it. Blocks on the lock: run it off the runtime.
    pub fn enroll(
        &self,
        code: &str,
        device_name: &str,
        by: &str,
        now: SystemTime,
    ) -> Result<Added, EnrollError> {
        let presented = token::hash(&token::normalize_code(code));
        let token = token::generate().map_err(StoreError::from)?;
        let token_hash = token::hash(&token);
        self.update(|file| {
            let Some(pending) = &mut file.pending else {
                return Err(EnrollError::BadCode);
            };
            let live = humantime::parse_rfc3339(&pending.expires_at).is_ok_and(|at| now < at);
            if !live {
                file.pending = None;
                return Err(EnrollError::BadCode);
            }
            if !token::matches(&pending.code_sha256, &presented) {
                pending.wrong_tries += 1;
                if pending.wrong_tries >= MAX_WRONG_TRIES {
                    file.pending = None;
                }
                return Err(EnrollError::BadCode);
            }
            file.pending = None;
            let name = add(&mut file.devices, device_name, &token_hash, by, now);
            Ok(Added { name, token })
        })?
    }

    /// `tether device add`: a device enrolled from the server's shell.
    pub fn add_device(&self, name: &str, now: SystemTime) -> Result<Added, StoreError> {
        let token = token::generate()?;
        let token_hash = token::hash(&token);
        let name = self.update(|file| add(&mut file.devices, name, &token_hash, "cli", now))?;
        Ok(Added { name, token })
    }

    /// `tether device remove`: false if no device has that name.
    pub fn remove_device(&self, name: &str) -> Result<bool, StoreError> {
        self.update(|file| {
            let before = file.devices.len();
            file.devices.retain(|device| device.name != name);
            file.devices.len() < before
        })
    }

    /// Read, change and write the file under the lock. Nothing is written when `change`
    /// left the file as it was, so a stream of bad requests costs no writes.
    fn update<T>(&self, change: impl FnOnce(&mut AuthFile) -> T) -> Result<T, StoreError> {
        let _lock = self.lock()?;
        let before = self.read()?;
        let mut file = before.clone();
        let result = change(&mut file);
        if file != before {
            self.replace(AUTH, &toml::to_string(&file)?)?;
        }
        Ok(result)
    }

    /// The state directory's `flock`, held until dropped: every tether writer holds it
    /// for its read-modify-write, of `auth.toml` and of `config.toml` (fs.md).
    pub fn lock(&self) -> Result<File, StoreError> {
        let path = self.dir.join(LOCK);
        let file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .mode(0o600)
            .open(&path)
            .map_err(io_at(&path))?;
        rustix::fs::flock(&file, rustix::fs::FlockOperation::LockExclusive)
            .map_err(|errno| io_at(&path)(errno.into()))?;
        Ok(file)
    }

    /// Temp file in the same directory, `fsync`, rename over `name`, `fsync` the
    /// directory. The caller holds the lock.
    fn replace(&self, name: &str, text: &str) -> Result<(), StoreError> {
        let temp = self.dir.join(format!("{name}.tmp"));
        let target = self.dir.join(name);
        match fs::remove_file(&temp) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(io_at(&temp)(error)),
        }
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&temp)
            .map_err(io_at(&temp))?;
        file.write_all(text.as_bytes()).map_err(io_at(&temp))?;
        file.sync_all().map_err(io_at(&temp))?;
        fs::rename(&temp, &target).map_err(io_at(&target))?;
        File::open(&self.dir)
            .and_then(|dir| dir.sync_all())
            .map_err(io_at(&self.dir))
    }
}

/// Adds a device under a unique name (`-2`, `-3`… on a clash) and returns the name.
fn add(
    devices: &mut Vec<Device>,
    name: &str,
    token_hash: &Hash,
    by: &str,
    now: SystemTime,
) -> String {
    let base = clean_name(name);
    let taken = |name: &str| devices.iter().any(|device| device.name == name);
    let mut name = base.clone();
    let mut suffix = 2;
    while taken(&name) {
        name = format!("{base}-{suffix}");
        suffix += 1;
    }
    devices.push(Device {
        name: name.clone(),
        token_sha256: token::hex(token_hash),
        enrolled_at: rfc3339(now),
        enrolled_by: by.to_owned(),
    });
    name
}

/// Device names come from the phone and are printed in a terminal: no control
/// characters, no surrounding space, at most `NAME_LIMIT` characters.
fn clean_name(name: &str) -> String {
    let name: String = name
        .chars()
        .filter(|c| !c.is_control())
        .take(NAME_LIMIT)
        .collect();
    match name.trim() {
        "" => "device".to_owned(),
        name => name.to_owned(),
    }
}

/// `auth.toml` as read: a missing file is an empty one.
fn loaded(path: &Path, text: io::Result<String>) -> Result<AuthFile, StoreError> {
    match text {
        Ok(text) => parse(path, &text),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(AuthFile::default()),
        Err(error) => Err(io_at(path)(error)),
    }
}

fn parse(path: &Path, text: &str) -> Result<AuthFile, StoreError> {
    toml::from_str(text).map_err(|error| StoreError::Parse {
        path: path.to_owned(),
        line: error.span().map_or(0, |span| {
            text.get(..span.start)
                .map_or(0, |head| head.matches('\n').count() + 1)
        }),
    })
}

fn rfc3339(at: SystemTime) -> String {
    humantime::format_rfc3339_seconds(at).to_string()
}

fn io_at(path: &Path) -> impl FnOnce(io::Error) -> StoreError + '_ {
    move |source| StoreError::Io {
        path: path.to_owned(),
        source,
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicU32, Ordering};

    use super::*;

    /// Removes the directory when the test ends.
    struct Cleanup(PathBuf);

    impl Drop for Cleanup {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn temp_store() -> (Store, Cleanup) {
        static NEXT: AtomicU32 = AtomicU32::new(0);
        let n = NEXT.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("tether-store-{}-{n}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        (Store::open(dir.clone()).expect("a state dir"), Cleanup(dir))
    }

    fn files(store: &Store) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(store.dir())
            .expect("the state dir")
            .map(|entry| {
                entry
                    .expect("an entry")
                    .file_name()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        names.sort();
        names
    }

    #[test]
    fn a_right_code_adds_the_device_and_is_consumed_in_one_write() {
        let (store, _cleanup) = temp_store();
        let now = SystemTime::now();
        let code = store
            .set_pending(Duration::from_secs(600), now)
            .expect("a code");
        // Typed loosely: lowercase, no dash, O and L for 0 and 1.
        let typed = code
            .replace('-', " ")
            .to_lowercase()
            .replace('0', "o")
            .replace('1', "l");
        let added = store
            .enroll(&typed, "phone", "jimmy@github", now)
            .expect("enrolled");
        let file = store.read().expect("the file");
        assert_eq!(file.pending, None);
        assert_eq!(file.devices.len(), 1);
        assert_eq!(file.devices[0].enrolled_by, "jimmy@github");
        let hash = token::hash(&added.token);
        assert_eq!(token::find(&file.devices, &hash), Some(&file.devices[0]));
        assert!(added.token.starts_with(token::TOKEN_PREFIX) && added.token.len() == 50);
        // Single use.
        assert!(matches!(
            store.enroll(&code, "phone", "jimmy@github", now),
            Err(EnrollError::BadCode)
        ));
        // Mode 0600, and no temp file left behind.
        let mode = fs::metadata(store.dir().join(AUTH))
            .expect("auth.toml")
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
        assert_eq!(files(&store), ["auth.toml", "lock"]);
        // The same name again gets a suffix.
        let second = store.add_device("phone", now).expect("added");
        assert_eq!(second.name, "phone-2");
    }

    #[test]
    fn wrong_codes_count_in_the_file_and_the_fifth_deletes_the_code() {
        let (store, _cleanup) = temp_store();
        let now = SystemTime::now();
        let code = store
            .set_pending(Duration::from_secs(600), now)
            .expect("a code");
        for tries in 1..MAX_WRONG_TRIES {
            // A fresh `Store` reads only the file, as a restarted daemon would.
            let restarted = Store::open(store.dir().to_owned()).expect("reopened");
            let wrong = restarted.enroll("ZZZZ-ZZZZ", "phone", "x", now);
            assert!(matches!(wrong, Err(EnrollError::BadCode)));
            let pending = restarted
                .read()
                .expect("the file")
                .pending
                .expect("still pending");
            assert_eq!(pending.wrong_tries, tries);
        }
        let fifth = store.enroll("ZZZZ-ZZZZ", "phone", "x", now);
        assert!(matches!(fifth, Err(EnrollError::BadCode)));
        assert_eq!(store.read().expect("the file").pending, None);
        // The right code is dead with it.
        let late = store.enroll(&code, "phone", "x", now);
        assert!(matches!(late, Err(EnrollError::BadCode)));
        assert!(store.read().expect("the file").devices.is_empty());
    }

    #[test]
    fn an_expired_code_is_refused_and_removed() {
        let (store, _cleanup) = temp_store();
        let then = SystemTime::now();
        let code = store
            .set_pending(Duration::from_secs(600), then)
            .expect("a code");
        let later = then + Duration::from_secs(601);
        let expired = store.enroll(&code, "phone", "x", later);
        assert!(matches!(expired, Err(EnrollError::BadCode)));
        let file = store.read().expect("the file");
        assert_eq!((file.pending, file.devices.len()), (None, 0));
    }

    #[test]
    fn concurrent_writers_lose_no_update() {
        let (store, _cleanup) = temp_store();
        let now = SystemTime::now();
        let writers: Vec<_> = (0..8)
            .map(|n| {
                let store = Store::open(store.dir().to_owned()).expect("reopened");
                std::thread::spawn(move || {
                    for m in 0..5 {
                        store.add_device(&format!("d{n}-{m}"), now).expect("added");
                    }
                })
            })
            .collect();
        for writer in writers {
            writer.join().expect("a writer");
        }
        assert_eq!(store.read().expect("the file").devices.len(), 40);
        assert!(store.remove_device("d3-4").expect("removed"));
        assert!(!store.remove_device("d3-4").expect("gone already"));
        assert_eq!(store.read().expect("the file").devices.len(), 39);
    }

    #[test]
    fn a_file_that_doesnt_parse_fails_closed_without_quoting_it() {
        let (store, _cleanup) = temp_store();
        fs::write(
            store.dir().join(AUTH),
            "[[device]]\nname = \"a\"\ntoken_sha256 = 7secret\n",
        )
        .expect("written");
        let error = store.read().expect_err("doesn't parse");
        let text = error.to_string();
        assert!(
            text.contains("line 3") && !text.contains("secret"),
            "{text}"
        );
        // A write refuses to replace it.
        assert!(store.add_device("b", SystemTime::now()).is_err());
    }

    #[test]
    fn the_host_id_is_written_once() {
        let (store, _cleanup) = temp_store();
        let id = store.host_id().expect("an id");
        assert!(token::is_host_id(&id), "{id}");
        assert_eq!(store.host_id().expect("the same id"), id);
    }
}
