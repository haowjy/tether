//! The `/fs/*` bodies (fs.md "Routes"). Errors are `ErrorBody`. Paths are
//! absolute UTF-8 strings; a name that isn't UTF-8 is listed but can't be sent back.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// `GET /fs/roots` and the answer to every Settings change.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Roots {
    /// The canonical `$HOME`: the picker starts here.
    pub home: String,
    pub roots: Vec<RootStatus>,
    pub uploads_dir: RootStatus,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct RootStatus {
    /// As stored in `config.toml`.
    pub path: String,
    /// Null when the entry is missing, isn't a directory, or isn't absolute or `~/`.
    pub canonical: Option<String>,
    pub ok: bool,
}

/// The body of `POST /fs/roots/add`, `/fs/roots/remove` and `/fs/uploads-dir`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct PathBody {
    pub path: String,
}

/// `GET /fs/list/{*path}`, and the picker's `GET /fs/dirs/{*path}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct Listing {
    /// Canonical.
    pub path: String,
    /// The root it is under (the longest match), or `$HOME` for the picker.
    pub root: String,
    /// Null when the parent is outside every root.
    pub parent: Option<String>,
    /// Entries scanned, after the hidden and directories-only filters.
    pub total: u32,
    pub offset: u32,
    /// The directory has more entries than one scan reads.
    pub truncated: bool,
    pub entries: Vec<Entry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct Entry {
    /// U+FFFD in place of bytes that aren't UTF-8.
    pub name: String,
    /// After following a symlink.
    pub kind: EntryKind,
    /// The entry itself is a symlink.
    pub link: bool,
    /// Files.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub size: Option<u64>,
    /// Unix seconds; absent for `broken` and in the picker.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub mtime: Option<i64>,
    /// Files: the type `/fs/raw` would send.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub mime: Option<String>,
    /// `false` for a name that isn't UTF-8, which can't be opened; absent otherwise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub utf8: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum EntryKind {
    Dir,
    File,
    /// A FIFO, socket or device.
    Other,
    /// A symlink whose target is missing or can't be reached.
    Broken,
}

/// `201` from `POST /fs/upload`. Swift mirrors it by hand.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct Uploaded {
    /// Absolute and canonical: native types it, quoted, into the tab.
    pub path: String,
    pub size: u64,
}
