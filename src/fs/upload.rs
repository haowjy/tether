//! `POST /fs/upload` (fs.md): the body streams into a 0600 part file (`files::Temp`) in
//! `uploads_dir`, flushed every 2 MiB, then renamed without replacing to a name the
//! daemon chooses. Only the client name's extension is used. A part file is deleted on
//! any failure, and leftovers from a daemon that died are swept at startup.

use std::fs::File;
use std::io;
use std::os::unix::fs::{DirBuilderExt as _, FileExt as _};
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use bytes::Bytes;
use futures_util::{Stream, StreamExt as _};
use rustix::io::Errno;
use tracing::debug;

use super::{FsError, Opened, Roots, Want, expand, open};
use crate::blocking::Lane;
use crate::config::ConfigFile;
use crate::files::{Dir, Temp};
use crate::proto::fs::Uploaded;

/// Larger uploads get `413 too_large`.
pub const MAX_UPLOAD: u64 = 128 << 20;
/// Waiting this long for a body byte aborts the upload.
const IDLE: Duration = Duration::from_secs(30);
/// Body bytes are written in chunks of this size...
const CHUNK: usize = 64 * 1024;
/// ...and every this many are `fdatasync`ed and their pages dropped, so the upload's
/// dirty pages, charged to the unit and unreclaimable until written, stay small on a
/// disk the unit reaches at idle I/O priority.
const FLUSH_EVERY: u64 = 2 << 20;
/// Nothing else in tether names a file like this.
const PART_PREFIX: &str = ".tether-upload-";
const PART_SUFFIX: &str = ".part";
/// Name clashes tried before giving up: four random characters clash rarely.
const RENAME_TRIES: usize = 16;
const BASE32: &[u8; 32] = b"abcdefghijklmnopqrstuvwxyz234567";

/// `uploads_dir`, created 0700 if missing and then opened through the roots read
/// after creating it, so a folder that didn't exist a moment ago still counts. Blocks.
pub fn open_dir(file: &ConfigFile, home: &Path) -> Result<Opened, FsError> {
    let config = file.load()?;
    if let Some(dir) = expand(&config.uploads_dir, home) {
        // A failure shows up in the open below.
        let _ = std::fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(&dir);
    }
    let roots = Roots::resolve(&config, home)?;
    let dir = roots.uploads.canonical.as_deref().and_then(Path::to_str);
    let dir = dir.ok_or(FsError::NotADirectory)?;
    open(&roots.scope(), dir, Want::Dir)
}

/// Writes `body` into a part file in `dir` and renames it to its final name. `limit` is
/// the size cap. Takes one fs thread per chunk written; the caller holds the upload slot.
pub async fn receive<S, E>(
    lane: &Lane,
    dir: Opened,
    client_name: &str,
    limit: u64,
    body: S,
) -> Result<Uploaded, FsError>
where
    S: Stream<Item = Result<Bytes, E>> + Unpin,
    E: std::fmt::Display,
{
    let dir_path = dir.path.clone();
    let (dir, part_lane) = (Dir::from(dir.file), lane.clone());
    let part = lane
        .run(move || Part::create(&dir, part_lane).map_err(write_error))
        .await??;
    let file = part.file.clone();
    match copy(lane, file, limit, body).await {
        Ok(size) => {
            let name = part.land(extension(client_name)).await?;
            Ok(Uploaded {
                path: format!("{dir_path}/{name}"),
                size,
            })
        }
        Err(error) => {
            part.remove().await;
            Err(error)
        }
    }
}

/// The body into `file`, 64 KiB at a time. Returns its size.
async fn copy<S, E>(lane: &Lane, file: Arc<File>, limit: u64, mut body: S) -> Result<u64, FsError>
where
    S: Stream<Item = Result<Bytes, E>> + Unpin,
    E: std::fmt::Display,
{
    let mut chunk = Vec::with_capacity(CHUNK);
    let mut written = 0;
    let mut flushed = 0;
    loop {
        // Only time spent waiting for the body counts toward the idle timeout.
        let next = tokio::time::timeout(IDLE, body.next()).await;
        let mut bytes = match next {
            Err(_) => {
                debug!("an upload went idle: aborted");
                return Err(FsError::BadRequest);
            }
            Ok(None) => break,
            Ok(Some(Err(cause))) => {
                debug!(%cause, "an upload's body failed: aborted");
                return Err(FsError::BadRequest);
            }
            Ok(Some(Ok(bytes))) => bytes,
        };
        let total = written + (chunk.len() + bytes.len()) as u64;
        if total > limit {
            return Err(FsError::TooLarge);
        }
        while !bytes.is_empty() {
            let take = (CHUNK - chunk.len()).min(bytes.len());
            chunk.extend_from_slice(&bytes.split_to(take));
            if chunk.len() == CHUNK {
                let flush = written + CHUNK as u64 - flushed >= FLUSH_EVERY;
                chunk = write(lane, &file, chunk, written, flush).await?;
                written += CHUNK as u64;
                if flush {
                    flushed = written;
                }
            }
        }
    }
    let size = written + chunk.len() as u64;
    if !chunk.is_empty() {
        write(lane, &file, chunk, written, false).await?;
    }
    Ok(size)
}

/// Writes `chunk` at `at` on an fs thread and hands the emptied buffer back.
async fn write(
    lane: &Lane,
    file: &Arc<File>,
    mut chunk: Vec<u8>,
    at: u64,
    flush: bool,
) -> Result<Vec<u8>, FsError> {
    let file = file.clone();
    lane.run(move || {
        file.write_all_at(&chunk, at).map_err(write_error)?;
        if flush {
            // The one wait with no deadline: a slow disk slows the upload to its pace.
            file.sync_data().map_err(write_error)?;
            #[cfg(target_os = "linux")]
            let _ = rustix::fs::fadvise(&*file, 0, None, rustix::fs::Advice::DontNeed);
        }
        chunk.clear();
        Ok(chunk)
    })
    .await?
}

fn write_error(error: io::Error) -> FsError {
    let errno = error.raw_os_error().map(Errno::from_raw_os_error);
    match errno {
        Some(Errno::NOSPC | Errno::DQUOT) => FsError::NoSpace,
        _ => FsError::Internal(error),
    }
}

/// `.tether-upload-<random>.part` in the uploads folder, deleted unless it landed. The
/// delete runs on the fs lane, since the folder may sit on the slow disk; one that gets
/// no thread in time leaves the file to the startup sweep.
struct Part {
    /// `None` once it landed or was deleted.
    temp: Option<Temp>,
    file: Arc<File>,
    lane: Lane,
}

impl Part {
    fn create(dir: &Dir, lane: Lane) -> io::Result<Self> {
        let name = format!("{PART_PREFIX}{}{PART_SUFFIX}", random(16)?);
        let temp = Temp::create(dir, name.as_ref(), 0o600)?;
        Ok(Self {
            file: temp.file().clone(),
            temp: Some(temp),
            lane,
        })
    }

    /// Renames the part file to a free final name. A failure deletes it.
    async fn land(mut self, extension: String) -> Result<String, FsError> {
        let temp = self.temp.take();
        let landed = self.lane.run(move || {
            let names = (0..RENAME_TRIES).map(|_| final_name(SystemTime::now(), &extension));
            let gone = || io::Error::from(io::ErrorKind::NotFound);
            temp.ok_or_else(gone)?.land(names)
        });
        landed.await?.map_err(FsError::Internal)
    }

    /// Deletes the part file before the response goes out.
    async fn remove(mut self) {
        if let Some(temp) = self.temp.take() {
            let _ = self.lane.run(move || temp.discard()).await;
        }
    }
}

impl Drop for Part {
    /// A request dropped mid-upload (the client went away) still deletes its part file.
    fn drop(&mut self) {
        if let Some(temp) = self.temp.take() {
            self.lane.spawn(move || temp.discard());
        }
    }
}

/// The extension of the client's name, lowercased, if it is 1 to 8 ASCII
/// alphanumerics; else `bin`. Nothing else of the name reaches the folder.
pub fn extension(client_name: &str) -> String {
    let extension = client_name
        .rsplit_once('.')
        .map(|(_, extension)| extension)
        .filter(|extension| {
            (1..=8).contains(&extension.len())
                && extension.bytes().all(|byte| byte.is_ascii_alphanumeric())
        });
    extension.map_or_else(|| "bin".to_owned(), str::to_ascii_lowercase)
}

/// `YYYYMMDD-HHMMSSZ-xxxx.<ext>`, in UTC.
fn final_name(now: SystemTime, extension: &str) -> io::Result<String> {
    Ok(format!("{}-{}.{extension}", utc_stamp(now), random(4)?))
}

/// `YYYYMMDD-HHMMSSZ`, from RFC 3339 with the punctuation taken out.
fn utc_stamp(now: SystemTime) -> String {
    let digits: String = humantime::format_rfc3339_seconds(now)
        .to_string()
        .chars()
        .filter(char::is_ascii_digit)
        .collect();
    format!("{}-{}Z", &digits[..8], &digits[8..14])
}

/// `n` random base32 characters.
fn random(n: usize) -> io::Result<String> {
    let mut bytes = vec![0; n];
    getrandom::fill(&mut bytes).map_err(io::Error::other)?;
    Ok(bytes
        .iter()
        .map(|byte| char::from(BASE32[usize::from(byte & 31)]))
        .collect())
}

/// Deletes part files a daemon that died left in `dir`. Run after the port is bound:
/// a second daemon started by mistake mustn't delete the running one's uploads.
pub fn sweep(dir: &Path) -> io::Result<usize> {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(0),
        Err(error) => return Err(error),
    };
    let mut removed = 0;
    for entry in entries {
        let entry = entry?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with(PART_PREFIX) && name.ends_with(PART_SUFFIX) {
            std::fs::remove_file(entry.path())?;
            removed += 1;
        }
    }
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use std::time::UNIX_EPOCH;

    use futures_util::stream;

    use super::*;
    use crate::blocking::Lanes;
    use crate::fs::test_tree::Tree;

    fn dir(tree: &Tree) -> Opened {
        let scope = crate::fs::Scope::roots(vec![tree.root().to_owned()]);
        open(&scope, &tree.str(""), Want::Dir).expect("the folder")
    }

    fn names(tree: &Tree) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(tree.root())
            .expect("the folder")
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

    fn body(chunks: Vec<Vec<u8>>) -> impl Stream<Item = Result<Bytes, io::Error>> + Unpin {
        stream::iter(chunks.into_iter().map(|chunk| Ok(Bytes::from(chunk))))
    }

    #[test]
    fn names_are_utc_stamped_with_only_the_extension_kept() {
        assert_eq!(extension("IMG_0001.JPG"), "jpg");
        assert_eq!(extension("photo.heic"), "heic");
        assert_eq!(extension("a.tar.gz"), "gz");
        for bad in [
            "noext",
            "x.",
            "x.toolongext",
            "x.j$g",
            "../../etc/passwd",
            "a.b/c",
            ".bashrc;rm",
        ] {
            assert_eq!(extension(bad), "bin", "{bad}");
        }
        assert_eq!(extension(".png"), "png");
        let at = UNIX_EPOCH + Duration::from_secs(1_792_651_205); // 2026-10-22T06:40:05Z
        let name = final_name(at, "jpg").expect("a name");
        let (stamp, rest) = name.split_at(17);
        assert_eq!(stamp, "20261022-064005Z-");
        let (suffix, extension) = rest.split_once('.').expect("an extension");
        assert_eq!(extension, "jpg");
        assert!(
            suffix.len() == 4 && suffix.bytes().all(|b| BASE32.contains(&b)),
            "{name}"
        );
    }

    #[tokio::test]
    async fn an_upload_lands_0600_under_its_final_name() {
        use std::os::unix::fs::PermissionsExt as _;
        let tree = Tree::new("upload");
        let lane = Lanes::default().fs;
        let chunks = vec![vec![1; 100_000], vec![2; 50_000], vec![3; 7]];
        let uploaded = receive(&lane, dir(&tree), "IMG.JPG", MAX_UPLOAD, body(chunks))
            .await
            .expect("uploaded");
        assert_eq!(uploaded.size, 150_007);
        let path = Path::new(&uploaded.path);
        assert_eq!(path.parent(), Some(tree.root()));
        assert!(uploaded.path.ends_with(".jpg"), "{}", uploaded.path);
        let bytes = std::fs::read(path).expect("read");
        assert_eq!(
            (bytes.len(), bytes[99_999], bytes[100_000], bytes[150_006]),
            (150_007, 1, 2, 3)
        );
        let mode = std::fs::metadata(path).expect("stat").permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
        assert_eq!(names(&tree).len(), 1);
    }

    #[tokio::test]
    async fn over_the_cap_the_part_file_is_deleted() {
        let tree = Tree::new("upload-cap");
        let lane = Lanes::default().fs;
        let chunks = vec![vec![0; 70_000], vec![0; 70_000]];
        let refused = receive(&lane, dir(&tree), "a.png", 100_000, body(chunks)).await;
        assert!(matches!(refused, Err(FsError::TooLarge)), "{refused:?}");
        assert!(names(&tree).is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn an_idle_body_is_aborted_and_its_part_file_deleted() {
        let tree = Tree::new("upload-idle");
        let lane = Lanes::default().fs;
        let stalled = body(vec![vec![0; 10]]).chain(stream::pending());
        let started = tokio::time::Instant::now();
        let refused = receive(&lane, dir(&tree), "a.png", MAX_UPLOAD, stalled).await;
        assert!(matches!(refused, Err(FsError::BadRequest)), "{refused:?}");
        assert!(started.elapsed() >= IDLE);
        assert!(names(&tree).is_empty());
    }
}
