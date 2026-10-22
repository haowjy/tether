//! Listings (fs.md "GET /fs/list"): one scan of the directory through its descriptor,
//! sorted and cut to a page. Nothing is kept between requests; paging re-scans. Path
//! completion reads the same scan (complete.md "Paths").

use std::cmp::Ordering;
use std::ffi::CStr;
use std::io;
use std::path::Path;

use rustix::fs::{AtFlags, Dir, FileType, Stat};

use super::{Opened, Scope, mime};
use crate::proto::fs::{Entry, EntryKind, Listing};

/// Entries in one page.
pub const PAGE: usize = 200;
/// A scan stops at this many entries read...
const SCAN_ENTRIES: usize = 5000;
/// ...or this many bytes of names kept.
const SCAN_NAMES: usize = 1 << 20;

/// What a listing keeps from the scan.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Filter {
    /// Names starting with `.` too.
    pub hidden: bool,
    /// The picker: directories only, with no size or time.
    pub dirs_only: bool,
}

/// One page of the directory `dir`, opened through `scope`. Blocks.
pub fn list(dir: &Opened, scope: &Scope, filter: Filter, offset: u32) -> io::Result<Listing> {
    let mut scan = Scan::read(dir, filter)?;
    scan.sort();
    let start = (offset as usize).min(scan.entries.len());
    let end = (start + PAGE).min(scan.entries.len());
    let entries = scan.entries[start..end]
        .iter()
        .map(|scanned| scan.entry(dir, scanned, filter))
        .collect();
    let parent = Path::new(&dir.path)
        .parent()
        .filter(|parent| scope.find(parent).is_some())
        .and_then(Path::to_str)
        .map(str::to_owned);
    Ok(Listing {
        path: dir.path.clone(),
        root: scope.dir(dir.root).to_string_lossy().into_owned(),
        parent,
        total: u32::try_from(scan.entries.len()).unwrap_or(u32::MAX),
        offset,
        truncated: scan.truncated,
        entries,
    })
}

#[derive(Debug, Clone, Copy)]
struct Scanned {
    /// The name's bytes in `Scan::names`, NUL included, so it can be `stat`ed as is.
    start: u32,
    len: u32,
    kind: EntryKind,
    link: bool,
}

/// Every name in one buffer, so a 5,000-entry scan is two allocations.
#[derive(Debug, Default)]
pub struct Scan {
    names: Vec<u8>,
    entries: Vec<Scanned>,
    truncated: bool,
}

impl Scan {
    /// Names and `d_type`, `stat`ing only links and `DT_UNKNOWN`, so a symlinked
    /// directory sorts as a directory. Blocks.
    pub fn read(dir: &Opened, filter: Filter) -> io::Result<Self> {
        let mut scan = Self::default();
        let mut read = 0;
        let mut entries = Dir::read_from(&dir.file)?;
        while let Some(entry) = entries.read() {
            let entry = entry?;
            let name = entry.file_name();
            let bytes = name.to_bytes();
            if bytes == b"." || bytes == b".." {
                continue;
            }
            if read == SCAN_ENTRIES {
                scan.truncated = true;
                break;
            }
            read += 1;
            if !filter.hidden && bytes.starts_with(b".") {
                continue;
            }
            let Some((kind, link)) = kind_of(dir, name, entry.file_type()) else {
                continue;
            };
            if filter.dirs_only && kind != EntryKind::Dir {
                continue;
            }
            let with_nul = name.to_bytes_with_nul();
            if scan.names.len() + with_nul.len() > SCAN_NAMES {
                scan.truncated = true;
                break;
            }
            scan.entries.push(Scanned {
                start: scan.names.len() as u32,
                len: with_nul.len() as u32,
                kind,
                link,
            });
            scan.names.extend_from_slice(with_nul);
        }
        Ok(scan)
    }

    /// Each name, in directory order, with its kind after following links.
    pub fn names(&self) -> impl Iterator<Item = (&[u8], EntryKind)> {
        self.entries
            .iter()
            .map(|scanned| (self.name(scanned).to_bytes(), scanned.kind))
    }

    fn name(&self, scanned: &Scanned) -> &CStr {
        let start = scanned.start as usize;
        let bytes = &self.names[start..start + scanned.len as usize];
        CStr::from_bytes_with_nul(bytes).unwrap_or_default()
    }

    /// Directories first, then by name with ASCII case folded, ties by bytes.
    fn sort(&mut self) {
        let names = &self.names;
        let name = |scanned: &Scanned| {
            let start = scanned.start as usize;
            &names[start..start + scanned.len as usize - 1]
        };
        self.entries.sort_unstable_by(|a, b| {
            let (a_name, b_name) = (name(a), name(b));
            (a.kind != EntryKind::Dir)
                .cmp(&(b.kind != EntryKind::Dir))
                .then_with(|| fold_cmp(a_name, b_name))
                .then_with(|| a_name.cmp(b_name))
        });
    }

    /// The page entry, with size and time from a `stat` (following links).
    fn entry(&self, dir: &Opened, scanned: &Scanned, filter: Filter) -> Entry {
        let name = self.name(scanned);
        let text = String::from_utf8_lossy(name.to_bytes()).into_owned();
        let utf8 = std::str::from_utf8(name.to_bytes())
            .is_err()
            .then_some(false);
        let mut entry = Entry {
            name: text,
            kind: scanned.kind,
            link: scanned.link,
            size: None,
            mtime: None,
            mime: None,
            utf8,
        };
        if filter.dirs_only || scanned.kind == EntryKind::Broken {
            return entry;
        }
        if let Ok(stat) = rustix::fs::statat(&dir.file, name, AtFlags::empty()) {
            let (size, mtime) = size_and_time(&stat);
            entry.mtime = Some(mtime);
            if scanned.kind == EntryKind::File {
                entry.size = Some(size);
                entry.mime = Some(mime::for_name(&entry.name).to_owned());
            }
        }
        entry
    }
}

/// The kind after following a link, and whether the entry is one. `None`: it vanished.
fn kind_of(dir: &Opened, name: &CStr, file_type: FileType) -> Option<(EntryKind, bool)> {
    let followed = || match rustix::fs::statat(&dir.file, name, AtFlags::empty()) {
        Ok(stat) => (kind(FileType::from_raw_mode(stat.st_mode)), true),
        Err(_) => (EntryKind::Broken, true),
    };
    match file_type {
        FileType::Symlink => Some(followed()),
        FileType::Unknown => {
            let stat = rustix::fs::statat(&dir.file, name, AtFlags::SYMLINK_NOFOLLOW).ok()?;
            match FileType::from_raw_mode(stat.st_mode) {
                FileType::Symlink => Some(followed()),
                other => Some((kind(other), false)),
            }
        }
        other => Some((kind(other), false)),
    }
}

fn kind(file_type: FileType) -> EntryKind {
    match file_type {
        FileType::Directory => EntryKind::Dir,
        FileType::RegularFile => EntryKind::File,
        _ => EntryKind::Other,
    }
}

/// `stat`'s field types differ by platform.
#[allow(clippy::unnecessary_cast, clippy::cast_sign_loss)]
fn size_and_time(stat: &Stat) -> (u64, i64) {
    (stat.st_size as u64, stat.st_mtime as i64)
}

/// Compares with ASCII case folded.
pub fn fold_cmp(a: &[u8], b: &[u8]) -> Ordering {
    a.iter()
        .map(u8::to_ascii_lowercase)
        .cmp(b.iter().map(u8::to_ascii_lowercase))
}

#[cfg(test)]
mod tests {
    use std::ffi::OsStr;
    use std::os::unix::ffi::OsStrExt as _;
    use std::os::unix::fs::symlink;

    use super::*;
    use crate::fs::test_tree::Tree;
    use crate::fs::{Want, open};

    fn listed(tree: &Tree, filter: Filter, offset: u32) -> Listing {
        let scope = Scope::roots(vec![tree.root().to_owned()]);
        let dir = open(&scope, &tree.str(""), Want::Dir).expect("the root");
        list(&dir, &scope, filter, offset).expect("listed")
    }

    #[test]
    fn listings_sort_dirs_first_follow_links_and_mark_what_cant_be_opened() {
        let tree = Tree::new("list");
        for dir in ["beta", "Alpha", ".hidden-dir"] {
            tree.mkdir(dir);
        }
        tree.write("b.md", b"# b");
        tree.write("A.txt", b"abc");
        tree.write("a.txt", b"x");
        tree.write(".env", b"");
        symlink(tree.path("beta"), tree.path("link-to-dir")).expect("a link");
        symlink(tree.path("missing"), tree.path("broken")).expect("a link");
        let fifo = std::process::Command::new("mkfifo")
            .arg(tree.path("fifo"))
            .status();
        assert!(fifo.expect("mkfifo ran").success());
        std::fs::write(tree.path("").join(OsStr::from_bytes(b"caf\xe9")), b"").expect("written");

        let visible = Filter {
            hidden: false,
            dirs_only: false,
        };
        let listing = listed(&tree, visible, 0);
        let names: Vec<(&str, EntryKind, bool)> = listing
            .entries
            .iter()
            .map(|entry| (entry.name.as_str(), entry.kind, entry.link))
            .collect();
        use EntryKind::*;
        assert_eq!(
            names,
            [
                ("Alpha", Dir, false),
                ("beta", Dir, false),
                ("link-to-dir", Dir, true),
                ("A.txt", File, false),
                ("a.txt", File, false),
                ("b.md", File, false),
                ("broken", Broken, true),
                ("caf\u{fffd}", File, false),
                ("fifo", Other, false),
            ]
        );
        let entry = |name: &str| listing.entries.iter().find(|e| e.name == name).expect(name);
        assert_eq!(
            (entry("A.txt").size, entry("A.txt").mime.as_deref()),
            (Some(3), Some("text/plain; charset=utf-8"))
        );
        assert_eq!(
            entry("b.md").mime.as_deref(),
            Some("text/markdown; charset=utf-8")
        );
        assert_eq!(entry("caf\u{fffd}").utf8, Some(false));
        assert_eq!(entry("a.txt").utf8, None);
        assert!(entry("broken").mtime.is_none() && entry("beta").mtime.is_some());
        assert_eq!(
            (listing.total, listing.truncated, listing.parent),
            (9, false, None)
        );

        let hidden = listed(
            &tree,
            Filter {
                hidden: true,
                ..visible
            },
            0,
        );
        assert_eq!(hidden.total, 11);
        assert_eq!(hidden.entries[0].name, ".hidden-dir");
        let paged = listed(&tree, visible, 8);
        assert_eq!((paged.offset, paged.entries.len()), (8, 1));

        let picker = listed(
            &tree,
            Filter {
                hidden: false,
                dirs_only: true,
            },
            0,
        );
        let dirs: Vec<&str> = picker.entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(dirs, ["Alpha", "beta", "link-to-dir"]);
        assert!(
            picker
                .entries
                .iter()
                .all(|e| e.size.is_none() && e.mtime.is_none())
        );
    }
}
