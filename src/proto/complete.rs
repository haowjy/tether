//! The `POST /complete` bodies (complete.md "Request and response"). Errors are
//! `ErrorBody`. Named `CompleteRequest`, not `Request`: the TypeScript lands beside the
//! DOM's global `Request`.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct CompleteRequest {
    /// The input from its start to the cursor, as on screen.
    pub before: String,
    /// The input from the cursor to its end.
    pub after: String,
    /// Absolute; null while the tab's directory isn't known yet.
    pub cwd: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct Completion {
    /// At most 20, history first.
    pub chips: Vec<Chip>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct Chip {
    /// Typed at the cursor, verbatim: it only extends what is typed, and holds no
    /// control character.
    pub insert: String,
    /// What the chip shows: the whole history line, the command, carapace's display,
    /// or the file name with a `/` for a directory.
    pub label: String,
    pub source: ChipSource,
    /// At most 100 bytes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum ChipSource {
    History,
    Command,
    Carapace,
    Path,
}
