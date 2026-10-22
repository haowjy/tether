//! Test support for faking a tmux server under `Session`s: the commands in the lines a
//! session writes, and tmux's stdout answering them. It reads `command.rs`'s text, so it
//! lives beside it and changes with it; the fake's server decides only what each
//! command finds, never how tether spells it.

use super::PaneId;

/// One command in a line, as far as a fake tmux needs to answer it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Command {
    /// `display-message -p`: answered with `format` expanded for `target` (`expand`).
    Display {
        target: Option<String>,
        format: String,
    },
    /// `capture-pane -p` of a pane; tmux fails it when the pane is gone.
    Capture { pane: PaneId, rows: Capture },
    /// Anything else tether sends, which prints nothing.
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Capture {
    /// The screen in use: the snapshot's rows.
    Screen,
    /// The bytes tmux's parser holds.
    Pending,
    /// The saved primary screen; nothing without an alternate screen.
    Saved,
    /// History rows `start..=end`.
    Range { start: i32, end: i32 },
}

/// The commands of a line a `Session` wrote, in order.
pub fn commands(line: &str) -> Vec<Command> {
    line.split(" ; ")
        .map(|text| command(&words(text)))
        .collect()
}

fn command(words: &[String]) -> Command {
    let value = |flag: &str| {
        let at = words.iter().position(|word| word == flag)?;
        words.get(at + 1)
    };
    match words.first().map(String::as_str) {
        Some("display-message") => Command::Display {
            target: value("-t").cloned(),
            format: words.last().cloned().unwrap_or_default(),
        },
        Some("capture-pane") => {
            let pane = value("-t").and_then(|pane| PaneId::parse(pane.as_bytes()));
            let number = |flag| value(flag).and_then(|number| number.parse().ok());
            let has = |flag: &str| words.iter().any(|word| word == flag);
            let rows = match (number("-S"), number("-E")) {
                (Some(start), Some(end)) => Capture::Range { start, end },
                _ if has("-P") => Capture::Pending,
                _ if has("-a") => Capture::Saved,
                _ => Capture::Screen,
            };
            let pane = pane.unwrap_or_else(|| panic!("capture-pane without a pane: {words:?}"));
            Command::Capture { pane, rows }
        }
        _ => Command::Other,
    }
}

/// A command's words as tmux's parser reads them: single quotes and `\` escapes
/// removed (`command::quote`).
fn words(text: &str) -> Vec<String> {
    let mut words = Vec::new();
    let mut word: Option<String> = None;
    let mut chars = text.chars();
    while let Some(c) = chars.next() {
        match c {
            ' ' => words.extend(word.take()),
            '\'' => {
                let word = word.get_or_insert_default();
                word.extend(chars.by_ref().take_while(|c| *c != '\''));
            }
            '\\' => word.get_or_insert_default().extend(chars.next()),
            c => word.get_or_insert_default().push(c),
        }
    }
    words.extend(word);
    words
}

/// `format` with each `#{name}` replaced by `value(name)`, as tmux expands it.
pub fn expand(format: &str, mut value: impl FnMut(&str) -> String) -> String {
    let mut out = String::new();
    let mut rest = format;
    while let Some(at) = rest.find("#{") {
        out.push_str(&rest[..at]);
        let end = rest[at..]
            .find('}')
            .unwrap_or_else(|| panic!("unclosed variable in {format:?}"));
        out.push_str(&value(&rest[at + 2..at + end]));
        rest = &rest[at + end + 1..];
    }
    out + rest
}

/// tmux's stdout for a line, `reply` answering each command with its rows or its
/// error: a reply block per command, numbered from `block`, and none after an error,
/// since tmux skips the rest of a list.
pub fn answer(
    line: &str,
    block: &mut u64,
    mut reply: impl FnMut(&Command) -> Result<Vec<String>, String>,
) -> String {
    let mut stdout = String::new();
    for command in commands(line) {
        let number = *block;
        *block += 1;
        stdout.push_str(&format!("%begin 1 {number} 1\n"));
        match reply(&command) {
            Ok(rows) => {
                rows.iter().for_each(|row| {
                    stdout.push_str(row);
                    stdout.push('\n');
                });
                stdout.push_str(&format!("%end 1 {number} 1\n"));
            }
            Err(message) => {
                stdout.push_str(&format!("{message}\n%error 1 {number} 1\n"));
                break;
            }
        }
    }
    stdout
}
