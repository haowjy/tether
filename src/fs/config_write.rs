//! The Settings sheet's writes to `config.toml` (fs.md "Writing config.toml"): under
//! the state directory's lock, which auth's writers hold too; through a symlinked file
//! to its target; only `roots` or `uploads_dir` changed, with `toml_edit` keeping
//! comments, order and unknown keys; and through `files::Temp` with the file's mode,
//! retried if the file changed while the new text was written.

use std::ffi::{OsStr, OsString};
use std::fs;
use std::io;
use std::os::unix::fs::{DirBuilderExt as _, PermissionsExt as _};
use std::path::{Path, PathBuf};

use rustix::io::Errno;
use toml_edit::{DocumentMut, Item, Value};
use tracing::{info, warn};

use super::{FsError, MAX_PATH, Roots, check_shape};
use crate::config::{Config, ConfigError, ConfigFile};
use crate::files::{self, Dir, Stamp, Temp};

/// Writes retried when the file changed under one, before `503 busy`.
const TRIES: usize = 3;

#[derive(Debug, Clone)]
pub enum Change {
    /// A directory strictly below `$HOME`, stored canonical.
    AddRoot(String),
    /// Every entry whose stored text or canonical path is this.
    RemoveRoot(String),
    /// As `AddRoot`, into `uploads_dir`.
    UploadsDir(String),
}

/// Checks `change` and writes it, holding `state_dir`'s lock. Blocks, on the disk and on
/// the lock.
pub fn apply(
    file: &ConfigFile,
    state_dir: &Path,
    home: &Path,
    change: Change,
) -> Result<(), FsError> {
    let change = match change {
        Change::AddRoot(path) => Change::AddRoot(below_home(&path, home)?),
        Change::UploadsDir(path) => Change::UploadsDir(below_home(&path, home)?),
        // Stored text, which needn't be absolute (`~/code`): only the rest of the shape.
        Change::RemoveRoot(path) if path.len() > MAX_PATH || path.contains('\0') => {
            return Err(FsError::BadRequest);
        }
        remove @ Change::RemoveRoot(_) => remove,
    };
    let _lock = files::lock(state_dir).map_err(FsError::Internal)?;
    let target = target(&file.path)?;
    let (Some(parent), Some(name)) = (target.parent(), target.file_name()) else {
        return Err(FsError::Internal(io::Error::other(
            "config.toml has no name",
        )));
    };
    let dir = Dir::open(parent).map_err(FsError::Internal)?;
    let mut temp_name = OsString::from(name);
    temp_name.push(".tmp");
    for _ in 0..TRIES {
        let before = read(&dir, name, &target)?;
        let config = Config::parse(&target, &before.text)?;
        let mut doc: DocumentMut = before.text.parse().map_err(|_| ConfigError::Parse {
            path: target.clone(),
            line: 0,
        })?;
        if !edit(&mut doc, &config, home, &change)? {
            return Ok(());
        }
        let temp = Temp::create(&dir, &temp_name, before.mode).map_err(write_error)?;
        let text = doc.to_string();
        if temp
            .replace_if(name, text.as_bytes(), before.stamp)
            .map_err(write_error)?
        {
            info!(path = %target.display(), ?change, "config.toml written");
            return Ok(());
        }
        info!(path = %target.display(), "config.toml changed while being written: retrying");
    }
    warn!(path = %target.display(), "config.toml kept changing: write refused");
    Err(FsError::Busy)
}

/// Applies `change` to `doc`; false if it changes nothing. `config` is the same text.
fn edit(
    doc: &mut DocumentMut,
    config: &Config,
    home: &Path,
    change: &Change,
) -> Result<bool, FsError> {
    match change {
        Change::AddRoot(canonical) => {
            let roots = Roots::resolve(config, home)?;
            let present = roots
                .roots
                .iter()
                .any(|root| root.canonical.as_deref() == Some(Path::new(canonical)));
            if !present {
                add_root(doc, canonical);
            }
            Ok(!present)
        }
        Change::RemoveRoot(path) => {
            let roots = Roots::resolve(config, home)?;
            let doomed: Vec<&str> = roots
                .roots
                .iter()
                .filter(|root| {
                    root.stored == *path || root.canonical.as_deref() == Some(Path::new(path))
                })
                .map(|root| root.stored.as_str())
                .collect();
            Ok(remove_roots(doc, |stored| doomed.contains(&stored)))
        }
        Change::UploadsDir(canonical) => {
            let unchanged = config.uploads_dir == *canonical;
            if !unchanged {
                set_uploads_dir(doc, canonical);
            }
            Ok(!unchanged)
        }
    }
}

// In `toml_edit`, the comment after an array entry's comma is the next entry's prefix
// (or the array's trailing text after the last entry): a prefix is the tail of the line
// before, up to its newline, then the entry's own lines. Adding and removing entries
// moves those line tails, so a comment stays on the line it was written on.

/// Appends to `roots`, laid out like the entries before it.
fn add_root(doc: &mut DocumentMut, path: &str) {
    let Some(roots) = doc.get_mut("roots").and_then(Item::as_array_mut) else {
        let mut roots = toml_edit::Array::new();
        roots.push(path);
        doc.insert("roots", Item::Value(Value::Array(roots)));
        return;
    };
    let trailing = roots.trailing().as_str().unwrap_or_default().to_owned();
    let last = roots.iter().last().map(prefix);
    let multi_line =
        trailing.contains('\n') || roots.iter().any(|entry| prefix(entry).contains('\n'));
    let mut entry = Value::from(path);
    if multi_line {
        let indent = last.as_deref().map_or("  ", own_lines);
        entry
            .decor_mut()
            .set_prefix(format!("{}{indent}", line_tail(&trailing)));
        roots.set_trailing(format!("\n{}", own_lines(&trailing)));
    } else if last.is_some() {
        entry.decor_mut().set_prefix(" ");
    }
    roots.push_formatted(entry);
}

/// Removes the `roots` entries `doomed` picks; false if none.
fn remove_roots(doc: &mut DocumentMut, doomed: impl Fn(&str) -> bool) -> bool {
    let Some(roots) = doc.get_mut("roots").and_then(Item::as_array_mut) else {
        return false;
    };
    let before = roots.len();
    // The line tail of the entry before a removed run, waiting for the next survivor.
    let mut carried: Option<String> = None;
    let mut index = 0;
    while let Some(entry) = roots.get(index) {
        let text = prefix(entry);
        if entry.as_str().is_some_and(&doomed) {
            carried.get_or_insert_with(|| line_tail(&text).to_owned());
            roots.remove(index);
            continue;
        }
        if let Some(tail) = carried.take() {
            let own = own_lines(&text);
            // A single-line array's first entry has no separator before it.
            let own = if index == 0 && !text.contains('\n') {
                own.trim_start()
            } else {
                own
            };
            if let Some(entry) = roots.get_mut(index) {
                entry.decor_mut().set_prefix(format!("{tail}{own}"));
            }
        }
        index += 1;
    }
    if let Some(tail) = carried {
        let trailing = roots.trailing().as_str().unwrap_or_default().to_owned();
        roots.set_trailing(format!("{tail}{}", own_lines(&trailing)));
    }
    roots.len() < before
}

fn prefix(entry: &Value) -> String {
    let prefix = entry.decor().prefix().and_then(|prefix| prefix.as_str());
    prefix.unwrap_or_default().to_owned()
}

/// The text up to and including the first newline: the line before's tail.
fn line_tail(text: &str) -> &str {
    text.find('\n').map_or("", |at| &text[..=at])
}

/// The text after the first newline: the entry's own lines and indent.
fn own_lines(text: &str) -> &str {
    text.find('\n').map_or(text, |at| &text[at + 1..])
}

/// Replaces `uploads_dir`, keeping a comment after the old value.
fn set_uploads_dir(doc: &mut DocumentMut, path: &str) {
    match doc.get_mut("uploads_dir").and_then(Item::as_value_mut) {
        Some(value) => {
            let decor = value.decor().clone();
            *value = Value::from(path);
            *value.decor_mut() = decor;
        }
        None => {
            doc.insert("uploads_dir", toml_edit::value(path));
        }
    }
}

/// The canonical path of an existing directory strictly below the canonical `$HOME`:
/// the app can't widen the scope to `$HOME` or past it.
fn below_home(path: &str, home: &Path) -> Result<String, FsError> {
    check_shape(path).map_err(|_| FsError::BadRequest)?;
    let home = fs::canonicalize(home).map_err(FsError::Internal)?;
    let canonical = fs::canonicalize(path).map_err(FsError::io)?;
    if !canonical.starts_with(&home) || canonical == home {
        return Err(FsError::OutsideHome);
    }
    if !fs::metadata(&canonical).map_err(FsError::io)?.is_dir() {
        return Err(FsError::NotADirectory);
    }
    canonical
        .into_os_string()
        .into_string()
        .map_err(|_| FsError::BadRequest)
}

/// The file to write: a symlink's target, so a dotfiles link stays a link. A missing
/// file is written where it was looked for, its directory created 0700. A link whose
/// target is missing, the file's or a directory's on the way, is refused and both are
/// left alone: renaming over it would replace the link with a copy, and following it
/// would create a file, or directories, wherever it points.
fn target(path: &Path) -> Result<PathBuf, FsError> {
    let refuse = |why: &str| FsError::ConfigReadOnly(io::Error::other(why));
    match fs::canonicalize(path) {
        Ok(target) => Ok(target),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            // Missing, yet there: a link to nothing.
            if fs::symlink_metadata(path).is_ok() {
                return Err(refuse("it is a symlink to nothing"));
            }
            let (Some(dir), Some(name)) = (path.parent(), path.file_name()) else {
                return Err(FsError::Internal(error));
            };
            // `mkdir` meets a dangling link to a directory as an entry that is there
            // but isn't a directory.
            let created = fs::DirBuilder::new()
                .recursive(true)
                .mode(0o700)
                .create(dir);
            match created {
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                    return Err(refuse(
                        "a directory on the way is a symlink to nothing or a file",
                    ));
                }
                created => created.map_err(write_error)?,
            }
            Ok(fs::canonicalize(dir).map_err(FsError::Internal)?.join(name))
        }
        Err(error) => Err(FsError::Internal(error)),
    }
}

/// The file as read, to change and to compare against before the rename: its text,
/// its stamp (`None`: missing) and its mode, which the new file gets exactly.
struct Before {
    text: String,
    stamp: Option<Stamp>,
    mode: u32,
}

/// `name` in `dir`, which is `target`; a missing file is an empty one, mode 0600.
fn read(dir: &Dir, name: &OsStr, target: &Path) -> Result<Before, FsError> {
    let unreadable = |source| ConfigError::Io {
        path: target.to_owned(),
        source,
    };
    let Some(opened) = dir.read(name).map_err(unreadable)? else {
        return Ok(Before {
            text: String::new(),
            stamp: None,
            mode: 0o600,
        });
    };
    let meta = opened.metadata().map_err(FsError::Internal)?;
    let text = io::read_to_string(&opened).map_err(unreadable)?;
    Ok(Before {
        text,
        stamp: Some(Stamp::of(&meta)),
        mode: meta.permissions().mode() & 0o7777,
    })
}

/// A file Jimmy can't write (read-only filesystem, a link into `/nix/store`) is a
/// conflict, not a failure.
fn write_error(error: io::Error) -> FsError {
    match error.raw_os_error().map(Errno::from_raw_os_error) {
        Some(Errno::ROFS | Errno::ACCESS | Errno::PERM) => FsError::ConfigReadOnly(error),
        _ => FsError::Internal(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const HAND_WRITTEN: &str = r#"# tether's config, by hand.
port = 7851 # not the default

# Project roots.
roots = [
  "~/code/tether", # the daemon
  "/srv/data",
]

uploads_dir = "~/inbox" # photos land here
future_key = { from = "a newer daemon" }

[tmux]
# The private server.
socket_name = "work"

[future_table]
answer = 42
"#;

    fn doc(text: &str) -> DocumentMut {
        text.parse().expect("parses")
    }

    #[test]
    fn adding_a_root_keeps_comments_order_and_unknown_keys() {
        let mut doc = doc(HAND_WRITTEN);
        add_root(&mut doc, "/home/jimmy/notes");
        let text = doc.to_string();
        let expected = HAND_WRITTEN.replace(
            "  \"/srv/data\",\n]",
            "  \"/srv/data\",\n  \"/home/jimmy/notes\",\n]",
        );
        assert_eq!(text, expected);
        let config = Config::parse(Path::new("config.toml"), &text).expect("still a config");
        assert_eq!(config.roots.len(), 3);
    }

    #[test]
    fn comments_stay_on_their_lines_and_single_line_arrays_stay_tidy() {
        let commented = "roots = [\n  \"/a\", # A\n  \"/b\", # B\n  \"/c\", # C\n]\n";
        for (doomed, expected) in [
            ("/a", "roots = [\n  \"/b\", # B\n  \"/c\", # C\n]\n"),
            ("/b", "roots = [\n  \"/a\", # A\n  \"/c\", # C\n]\n"),
            ("/c", "roots = [\n  \"/a\", # A\n  \"/b\", # B\n]\n"),
        ] {
            let mut doc = doc(commented);
            assert!(remove_roots(&mut doc, |stored| stored == doomed));
            assert_eq!(doc.to_string(), expected, "removing {doomed}");
        }
        let mut doc = doc(commented);
        add_root(&mut doc, "/d");
        let added = "roots = [\n  \"/a\", # A\n  \"/b\", # B\n  \"/c\", # C\n  \"/d\",\n]\n";
        assert_eq!(doc.to_string(), added);

        let mut doc = self::doc("roots = [\"/a\", \"/b\", \"/c\"]\n");
        assert!(remove_roots(&mut doc, |stored| stored == "/a"));
        assert_eq!(doc.to_string(), "roots = [\"/b\", \"/c\"]\n");
        add_root(&mut doc, "/d");
        assert_eq!(doc.to_string(), "roots = [\"/b\", \"/c\", \"/d\"]\n");
        let mut doc = self::doc("roots = []\n");
        add_root(&mut doc, "/a");
        assert_eq!(doc.to_string(), "roots = [\"/a\"]\n");
    }

    #[test]
    fn removing_roots_keeps_the_rest_of_the_file() {
        let mut doc = doc(HAND_WRITTEN);
        assert!(remove_roots(&mut doc, |stored| stored == "/srv/data"));
        assert!(!remove_roots(&mut doc, |stored| stored == "/srv/data"));
        let text = doc.to_string();
        assert!(
            text.contains("  \"~/code/tether\", # the daemon\n]"),
            "{text}"
        );
        assert!(!text.contains("/srv/data"), "{text}");
        for kept in [
            "# tether's config",
            "# not the default",
            "future_key",
            "[future_table]",
            "# The private server.",
        ] {
            assert!(text.contains(kept), "{kept}: {text}");
        }
    }

    #[test]
    fn a_file_without_the_keys_gets_them_before_its_tables() {
        let mut doc = doc("# mine\n[tmux]\nsocket_name = \"work\"\n");
        add_root(&mut doc, "/a");
        set_uploads_dir(&mut doc, "/b");
        let text = doc.to_string();
        let config = Config::parse(Path::new("config.toml"), &text).expect("still a config");
        assert_eq!(
            (config.roots, config.uploads_dir),
            (vec!["/a".to_owned()], "/b".to_owned())
        );
        assert_eq!(config.tmux.socket_name.as_deref(), Some("work"));
        // The comment is the table's, and stays on it.
        assert!(text.contains("# mine\n[tmux]\n"), "{text}");
    }

    #[test]
    fn setting_uploads_dir_keeps_its_comment() {
        let mut doc = doc(HAND_WRITTEN);
        set_uploads_dir(&mut doc, "/home/jimmy/photos");
        let text = doc.to_string();
        assert!(
            text.contains("uploads_dir = \"/home/jimmy/photos\" # photos land here\n"),
            "{text}"
        );
        assert_eq!(
            text.replace("\"/home/jimmy/photos\"", "\"~/inbox\""),
            HAND_WRITTEN
        );
    }
}
