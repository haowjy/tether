//! `auth.toml` and `host_id` in the state directory (auth.md "State on disk").
//!
//! Every write of `auth.toml` holds the state directory's `flock` for its whole
//! read-modify-write and lands through `files::Temp` (temp file, `fsync`, rename,
//! directory `fsync`), so a reader sees the old file or the new one, and a crash leaves
//! one of them. Reads take no lock. The daemon and the CLI both write; nothing caches
//! the file.

use std::fs::{self, File};
use std::io;
use std::os::unix::fs::{DirBuilderExt as _, PermissionsExt as _};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use serde::ser::SerializeStruct as _;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::warn;

use super::token::{self, Hash};
use crate::files::{self, Dir, Temp};

/// Wrong codes before the pending code is deleted.
pub const MAX_WRONG_TRIES: u32 = 5;
/// Device names are cut to this many characters.
const NAME_LIMIT: usize = 64;

const AUTH: &str = "auth.toml";
const HOST_ID: &str = "host_id";

#[derive(Debug, Clone, PartialEq, Default)]
pub struct AuthFile {
    pub devices: Vec<Device>,
    pub pending: Option<Pending>,
    refused_devices: Vec<toml::Value>,
}

#[derive(Serialize)]
#[serde(untagged)]
enum DeviceRow<'a> {
    Known(&'a Device),
    Refused(&'a toml::Value),
}

impl Serialize for AuthFile {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let has_devices = !self.devices.is_empty() || !self.refused_devices.is_empty();
        let fields = usize::from(has_devices) + usize::from(self.pending.is_some());
        let mut file = serializer.serialize_struct("AuthFile", fields)?;
        if has_devices {
            let rows = self
                .devices
                .iter()
                .map(DeviceRow::Known)
                .chain(self.refused_devices.iter().map(DeviceRow::Refused))
                .collect::<Vec<_>>();
            file.serialize_field("device", &rows)?;
        }
        if let Some(pending) = &self.pending {
            file.serialize_field("pending", pending)?;
        }
        file.end()
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DeviceKind {
    #[default]
    Native,
    Node,
}

impl DeviceKind {
    fn is_native(&self) -> bool {
        *self == Self::Native
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Device {
    pub name: String,
    #[serde(default, skip_serializing_if = "DeviceKind::is_native")]
    pub kind: DeviceKind,
    /// sha256 of a native device's token, hex. The token itself is never stored.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token_sha256: Option<String>,
    /// Stable node ID and owner login for a browser device.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub node_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub login: Option<String>,
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
        match fs::read_to_string(&path) {
            Ok(text) => parse(&path, &text),
            // A missing file is an empty one.
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(AuthFile::default()),
            Err(error) => Err(io_at(&path)(error)),
        }
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
    /// a restart, and the fifth deletes it. Blocks on the lock: run it on the auth lane.
    pub fn enroll(
        &self,
        code: &str,
        device_name: &str,
        by: &str,
        now: SystemTime,
    ) -> Result<Added, EnrollError> {
        let token = token::generate().map_err(StoreError::from)?;
        let token_hash = token::hash(&token);
        self.update(|file| {
            redeem(file, code, now)?;
            let name = add_native(file, device_name, &token_hash, by, now);
            Ok(Added { name, token })
        })?
    }

    /// `POST /auth/node/enroll`. An existing node keeps its name and doesn't consume
    /// the shared code.
    pub fn enroll_node(
        &self,
        code: &str,
        device_name: &str,
        node_id: &str,
        login: &str,
        by: &str,
        now: SystemTime,
    ) -> Result<String, EnrollError> {
        self.update(|file| {
            if let Some(device) = file.devices.iter().find(|device| {
                device.kind == DeviceKind::Node
                    && device.node_id.as_deref() == Some(node_id)
                    && device.login.as_deref() == Some(login)
            }) {
                return Ok(device.name.clone());
            }
            redeem(file, code, now)?;
            Ok(add_node(file, device_name, node_id, login, by, now))
        })?
    }

    /// `tether device add`: a device enrolled from the server's shell.
    pub fn add_device(&self, name: &str, now: SystemTime) -> Result<Added, StoreError> {
        let token = token::generate()?;
        let token_hash = token::hash(&token);
        let name = self.update(|file| add_native(file, name, &token_hash, "cli", now))?;
        Ok(Added { name, token })
    }

    /// `tether device remove`: false if no device has that name.
    pub fn remove_device(&self, name: &str) -> Result<bool, StoreError> {
        self.update(|file| {
            let before = file.devices.len();
            file.devices.retain(|device| device.name != name);
            let removed = file.devices.len() < before;
            let before = file.refused_devices.len();
            file.refused_devices
                .retain(|row| row.get("name").and_then(toml::Value::as_str) != Some(name));
            removed || file.refused_devices.len() < before
        })
    }

    /// Removes the enrolled node and any accidentally duplicated row for the same ID.
    pub fn remove_node(&self, node_id: &str) -> Result<bool, StoreError> {
        self.update(|file| {
            let before = file.devices.len();
            file.devices.retain(|device| {
                device.kind != DeviceKind::Node || device.node_id.as_deref() != Some(node_id)
            });
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

    /// The state directory's lock (`files::lock`), which `config.toml`'s writes hold too.
    fn lock(&self) -> Result<File, StoreError> {
        files::lock(&self.dir).map_err(io_at(&self.dir))
    }

    /// `name`, 0600, replaced whole with `text`. The caller holds the lock.
    fn replace(&self, name: &str, text: &str) -> Result<(), StoreError> {
        let temp = Dir::open(&self.dir)
            .and_then(|dir| Temp::create(&dir, format!("{name}.tmp").as_ref(), 0o600))
            .map_err(io_at(&self.dir))?;
        temp.replace(name.as_ref(), text.as_bytes())
            .map_err(io_at(&self.dir.join(name)))
    }
}

/// Checks the pending code and applies its shared wrong-try counter.
fn redeem(file: &mut AuthFile, code: &str, now: SystemTime) -> Result<(), EnrollError> {
    let presented = token::hash(&token::normalize_code(code));
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
    Ok(())
}

/// Picks a name not used by an admitted or refused row.
fn unique_name(file: &AuthFile, name: &str) -> String {
    let base = clean_name(name);
    let taken = |candidate: &str| {
        file.devices.iter().any(|device| device.name == candidate)
            || file
                .refused_devices
                .iter()
                .any(|row| row.get("name").and_then(toml::Value::as_str) == Some(candidate))
    };
    let mut candidate = base.clone();
    let mut suffix = 2;
    while taken(&candidate) {
        candidate = format!("{base}-{suffix}");
        suffix += 1;
    }
    candidate
}

fn add_native(
    file: &mut AuthFile,
    name: &str,
    token_hash: &Hash,
    by: &str,
    now: SystemTime,
) -> String {
    let name = unique_name(file, name);
    file.devices.push(Device {
        name: name.clone(),
        kind: DeviceKind::Native,
        token_sha256: Some(token::hex(token_hash)),
        node_id: None,
        login: None,
        enrolled_at: rfc3339(now),
        enrolled_by: by.to_owned(),
    });
    name
}

fn add_node(
    file: &mut AuthFile,
    name: &str,
    node_id: &str,
    login: &str,
    by: &str,
    now: SystemTime,
) -> String {
    let name = unique_name(file, name);
    file.devices.push(Device {
        name: name.clone(),
        kind: DeviceKind::Node,
        token_sha256: None,
        node_id: Some(node_id.to_owned()),
        login: Some(login.to_owned()),
        enrolled_at: rfc3339(now),
        enrolled_by: by.to_owned(),
    });
    name
}

impl Device {
    pub(crate) fn valid(&self) -> bool {
        match self.kind {
            DeviceKind::Native => {
                self.token_sha256.is_some() && self.node_id.is_none() && self.login.is_none()
            }
            DeviceKind::Node => {
                self.token_sha256.is_none() && self.node_id.is_some() && self.login.is_some()
            }
        }
    }
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

fn parse(path: &Path, text: &str) -> Result<AuthFile, StoreError> {
    #[derive(Deserialize)]
    struct Raw {
        #[serde(default, rename = "device")]
        devices: Vec<toml::Value>,
        #[serde(default)]
        pending: Option<Pending>,
    }

    let raw: Raw = toml::from_str(text).map_err(|error| StoreError::Parse {
        path: path.to_owned(),
        line: files::toml_line(text, &error),
    })?;
    let mut devices = Vec::with_capacity(raw.devices.len());
    let mut refused_devices = Vec::new();
    for value in raw.devices {
        let name = value
            .get("name")
            .and_then(toml::Value::as_str)
            .unwrap_or("<unnamed>")
            .to_owned();
        match value.clone().try_into::<Device>() {
            Ok(device) if device.valid() => devices.push(device),
            _ => {
                warn!(device = %name, "refused invalid or unknown device row");
                refused_devices.push(value);
            }
        }
    }
    Ok(AuthFile {
        devices,
        pending: raw.pending,
        refused_devices,
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
    fn refused_device_rows_survive_other_writes_and_can_be_removed_by_name() {
        let (store, _cleanup) = temp_store();
        fs::write(
            store.dir().join(AUTH),
            "[[device]]\nname = \"future\"\ntoken_sha256 = \"bad\"\nenrolled_at = \"2026-10-23T00:00:00Z\"\nenrolled_by = \"cli\"\nfuture_scope = \"read-only\"\n\n[[device]]\nname = \"old\"\ntoken_sha256 = \"bad\"\nenrolled_at = \"2026-10-23T00:00:00Z\"\nenrolled_by = \"cli\"\n",
        )
        .expect("written");

        let devices = store.read().expect("the file").devices;
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].name, "old");
        assert_eq!(devices[0].kind, DeviceKind::Native);

        let added = store
            .add_device("future", SystemTime::now())
            .expect("add device");
        assert_eq!(added.name, "future-2");

        store
            .set_pending(Duration::from_secs(600), SystemTime::now())
            .expect("write a pending code");
        let rows = device_rows(&store);
        assert_eq!(rows.len(), 3);
        let future = rows
            .iter()
            .find(|row| row.get("name").and_then(toml::Value::as_str) == Some("future"))
            .expect("refused row survived the pending-code write");
        assert_eq!(
            future.get("future_scope").and_then(toml::Value::as_str),
            Some("read-only")
        );

        assert!(store.remove_device("old").expect("remove the native row"));
        assert_eq!(
            device_rows(&store)
                .iter()
                .filter(|row| row.get("name").and_then(toml::Value::as_str) == Some("future"))
                .count(),
            1,
            "removing a typed row must preserve the refused row"
        );
        assert!(
            store
                .remove_device("future")
                .expect("remove the refused row by name")
        );
        assert_eq!(
            store.read().expect("typed row remains").devices[0].name,
            "future-2"
        );
        assert!(
            store
                .remove_device("future-2")
                .expect("remove added device")
        );
        assert!(device_rows(&store).is_empty());
    }

    fn device_rows(store: &Store) -> Vec<toml::Value> {
        let text = fs::read_to_string(store.dir().join(AUTH)).expect("auth.toml");
        let document: toml::Value = toml::from_str(&text).expect("valid auth.toml");
        document
            .get("device")
            .and_then(toml::Value::as_array)
            .map_or_else(Vec::new, |rows| rows.to_vec())
    }

    #[test]
    fn the_host_id_is_written_once() {
        let (store, _cleanup) = temp_store();
        let id = store.host_id().expect("an id");
        assert!(token::is_host_id(&id), "{id}");
        assert_eq!(store.host_id().expect("the same id"), id);
    }
}
