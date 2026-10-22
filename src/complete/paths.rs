//! Path chips (complete.md "Paths"): the current word split into a directory and a
//! name prefix, the directory listed through `fs::open` with `/` as the scope. Names,
//! never contents, from any directory Jimmy can read, as the shell's own Tab does.
//! Splitting is pure; inserts are escaped by `chip`. The last directory's listing is
//! kept while a fresh open shows the same mtime.

use std::os::unix::fs::MetadataExt as _;
use std::path::Path;
use std::sync::Arc;

use super::{CHIPS, chip};
use crate::fs::list::{Filter, Scan, fold_cmp};
use crate::fs::{FsError, Scope, Want};
use crate::proto::complete::{Chip, ChipSource};
use crate::proto::fs::EntryKind;

/// Where to look for the current word's completions.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Target {
    /// A bare `~`: the chip `/`.
    Tilde,
    /// Names in `dir`, an absolute path, that start with `prefix`.
    Dir { dir: String, prefix: String },
}

/// `None`: nothing to complete (`~user`, or a relative path with no `cwd`).
pub fn split(value: &str, cwd: Option<&str>, home: &Path) -> Option<Target> {
    if value == "~" {
        return Some(Target::Tilde);
    }
    let (dir, prefix) = match value.rfind('/') {
        Some(at) => value.split_at(at + 1),
        None => ("", value),
    };
    let dir = if let Some(rest) = dir.strip_prefix("~/") {
        format!("{}/{rest}", home.to_str()?)
    } else if value.starts_with('~') {
        return None;
    } else if dir.starts_with('/') {
        dir.to_owned()
    } else {
        format!("{}/{dir}", cwd?)
    };
    Some(Target::Dir {
        dir,
        prefix: prefix.to_owned(),
    })
}

/// One directory's names, and what identifies its state.
#[derive(Debug)]
pub struct Listing {
    /// Canonical.
    path: String,
    /// `(dev, ino, mtime)`.
    stamp: (u64, u64, i64, i64),
    scan: Scan,
}

impl Listing {
    /// `dir`'s names: `cached` while it is the same directory with the same mtime.
    /// Blocks.
    pub fn load(dir: &str, cached: Option<Arc<Self>>) -> Result<Arc<Self>, FsError> {
        let opened = crate::fs::open(&Scope::everything(), dir, Want::Dir)?;
        let meta = &opened.meta;
        let stamp = (meta.dev(), meta.ino(), meta.mtime(), meta.mtime_nsec());
        if let Some(cached) = cached.filter(|c| c.path == opened.path && c.stamp == stamp) {
            return Ok(cached);
        }
        let all = Filter {
            hidden: true,
            dirs_only: false,
        };
        let scan = Scan::read(&opened, all).map_err(FsError::io)?;
        Ok(Arc::new(Self {
            path: opened.path,
            stamp,
            scan,
        }))
    }

    /// Chips for the names starting with `prefix`, by name with ASCII case folded. A
    /// name starting with `.` only when `prefix` does.
    pub fn chips(&self, prefix: &str) -> Vec<Chip> {
        let hidden = prefix.starts_with('.');
        let mut found: Vec<(&str, bool)> = self
            .scan
            .names()
            .filter_map(|(name, kind)| {
                let name = std::str::from_utf8(name).ok()?;
                let shown = name.starts_with(prefix) && (hidden || !name.starts_with('.'));
                shown.then_some((name, kind == EntryKind::Dir))
            })
            .collect();
        found.sort_unstable_by(|a, b| fold_cmp(a.0.as_bytes(), b.0.as_bytes()).then(a.0.cmp(b.0)));
        found
            .into_iter()
            .filter_map(|(name, dir)| {
                let rest = &name[prefix.len()..];
                let (end, label) = if dir {
                    ("/", format!("{name}/"))
                } else {
                    (" ", name.to_owned())
                };
                chip(ChipSource::Path, rest, end, label, None)
            })
            .take(CHIPS)
            .collect()
    }
}

/// The chip for a bare `~`.
pub fn tilde() -> Vec<Chip> {
    chip(ChipSource::Path, "", "/", "~/".to_owned(), None)
        .into_iter()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fs::test_tree::Tree;

    fn dir(dir: &str, prefix: &str) -> Option<Target> {
        Some(Target::Dir {
            dir: dir.to_owned(),
            prefix: prefix.to_owned(),
        })
    }

    #[test]
    fn words_split_into_a_directory_and_a_prefix() {
        let home = Path::new("/home/j");
        let cwd = Some("/repo");
        assert_eq!(split("~", cwd, home), Some(Target::Tilde));
        assert_eq!(split("~/", cwd, home), dir("/home/j/", ""));
        assert_eq!(split("~/src/te", cwd, home), dir("/home/j/src/", "te"));
        assert_eq!(split("~root/x", cwd, home), None);
        assert_eq!(split("~root", cwd, home), None);
        assert_eq!(split("/etc/pa", cwd, home), dir("/etc/", "pa"));
        assert_eq!(split("/", cwd, home), dir("/", ""));
        assert_eq!(split("src/ma", cwd, home), dir("/repo/src/", "ma"));
        assert_eq!(split("Car", cwd, home), dir("/repo/", "Car"));
        assert_eq!(split("", cwd, home), dir("/repo/", ""));
        // A relative path needs the tab's directory.
        assert_eq!(split("src/ma", None, home), None);
        assert_eq!(split("/etc/pa", None, home), dir("/etc/", "pa"));
    }

    #[test]
    fn listings_reach_any_readable_directory_and_escape_what_they_insert() {
        let tree = Tree::new("complete-paths");
        tree.mkdir("My Dir");
        tree.mkdir("mine");
        tree.mkdir(".git");
        tree.write("Makefile", b"");
        tree.write("a'b(c).txt", b"");
        tree.write("caf\u{e9}", b"");
        tree.write(".env", b"");
        tree.write("line\nbreak", b"");
        let chips = |prefix: &str| -> Vec<(String, String)> {
            let listing = Listing::load(&tree.str(""), None).expect("listed");
            let chips = listing.chips(prefix);
            chips.into_iter().map(|c| (c.insert, c.label)).collect()
        };
        let pair = |insert: &str, label: &str| (insert.to_owned(), label.to_owned());
        assert_eq!(
            chips("m"),
            [pair("ine/", "mine/")],
            "matching is case-sensitive"
        );
        assert_eq!(
            chips("M"),
            [pair("akefile ", "Makefile"), pair("y\\ Dir/", "My Dir/")]
        );
        assert_eq!(chips("a"), [pair("\\'b\\(c\\).txt ", "a'b(c).txt")]);
        assert_eq!(chips("c"), [pair("af\u{e9} ", "caf\u{e9}")]);
        // Dotfiles only for a dot; a name with a control character is never offered.
        assert!(chips("").iter().all(|(_, label)| !label.starts_with('.')));
        assert_eq!(chips(".").len(), 2);
        assert!(chips("li").is_empty());

        // Outside every root and `$HOME`: names still come, as the shell's Tab lists.
        let etc = Listing::load("/etc/", None).expect("listed");
        assert!(etc.chips("pass").iter().any(|c| c.label == "passwd"));
        // A file isn't a directory to list.
        assert!(Listing::load(&tree.str("Makefile"), None).is_err());

        // The cache holds while the mtime does, and a change is seen.
        let listing = Listing::load(&tree.str(""), None).expect("listed");
        let again = Listing::load(&tree.str(""), Some(listing.clone())).expect("listed");
        assert!(Arc::ptr_eq(&listing, &again));
        std::thread::sleep(std::time::Duration::from_millis(10));
        tree.write("Makefile.am", b"");
        let changed = Listing::load(&tree.str(""), Some(listing.clone())).expect("listed");
        assert!(!Arc::ptr_eq(&listing, &changed));
        assert_eq!(changed.chips("Makefile").len(), 2);
    }
}
