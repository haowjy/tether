//! Which sources a request runs (complete.md "Answering a request"): a small shell
//! lexer over the text before the cursor, and `literal`, the escaping it reads back.
//! Pure.

/// What one request asks of the sources.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Query {
    /// History runs: nothing but spaces after the cursor, something before it.
    pub history: bool,
    /// The word source, if one runs.
    pub word: Option<Word>,
}

/// The current word's source. Every string is a value: escapes and quotes removed. A
/// current word whose leading `~` is quoted or escaped gets `./` before it: the same
/// file, which paths and carapace then can't read as a home directory.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Word {
    /// The first word of a command: names on `PATH` starting with it.
    Command(String),
    /// A path: after a redirection, or a first word with a `/` or a leading `~` or `.`.
    Path(String),
    /// A later word of `cmd`: carapace when it covers `cmd`, else paths.
    Arg {
        cmd: String,
        args: Vec<String>,
        cur: String,
    },
}

impl Word {
    /// For the debug log, which never carries the text.
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Command(_) => "command",
            Self::Path(_) => "path",
            Self::Arg { .. } => "arg",
        }
    }
}

/// Words after which the next one starts a command again.
const KEYWORDS: [&str; 10] = [
    "if", "then", "elif", "else", "do", "while", "until", "!", "time", "{",
];

pub fn context(before: &str, after: &str) -> Query {
    let history = after.trim().is_empty() && !before.trim().is_empty();
    let inside_word = after.chars().next().is_some_and(|c| !c.is_whitespace());
    let word = if inside_word {
        None
    } else {
        Lexer::default().run(before)
    };
    Query { history, word }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Quote {
    Single,
    Double,
    Backtick,
}

/// The word being read.
#[derive(Debug, Default)]
struct Partial {
    /// As typed.
    raw: String,
    value: String,
    /// Holds `$`, a backtick or a glob character, quoted or not.
    expands: bool,
}

/// One command's words so far.
#[derive(Debug, Default)]
struct Command {
    /// Finished words' values, from the command name on; leading assignments and
    /// keywords aren't in it.
    words: Vec<String>,
    /// The next word is a redirection's target.
    target: bool,
}

#[derive(Debug, Default)]
struct Lexer {
    command: Command,
    word: Option<Partial>,
    /// Commands suspended by `(` or `$(`, each with the word it interrupted.
    outer: Vec<(Command, Option<Partial>)>,
    quote: Option<Quote>,
    escaped: bool,
}

impl Lexer {
    fn run(mut self, before: &str) -> Option<Word> {
        let mut chars = before.chars().peekable();
        while let Some(c) = chars.next() {
            if self.escaped {
                self.escaped = false;
                self.escape(c);
                continue;
            }
            match self.quote {
                Some(quote) => self.quoted(quote, c),
                None => self.unquoted(c, &mut chars),
            }
        }
        if self.quote.is_some() || self.escaped {
            return None;
        }
        let current = self.word.take().unwrap_or_default();
        if current.expands {
            return None;
        }
        let Command { mut words, target } = self.command;
        let value = if current.value.starts_with('~') && !current.raw.starts_with('~') {
            format!("./{}", current.value)
        } else {
            current.value
        };
        Some(if target {
            Word::Path(value)
        } else if words.is_empty() {
            if value.contains('/') || value.starts_with('~') || value.starts_with('.') {
                Word::Path(value)
            } else {
                Word::Command(value)
            }
        } else {
            let cmd = words.remove(0);
            Word::Arg {
                cmd,
                args: words,
                cur: value,
            }
        })
    }

    /// The character after a backslash.
    fn escape(&mut self, c: char) {
        let quote = self.quote;
        let word = self.partial();
        word.raw.push(c);
        match quote {
            // Inside double quotes a backslash escapes only these.
            Some(Quote::Double) if !matches!(c, '$' | '`' | '"' | '\\' | '\n') => {
                word.value.push('\\');
                word.value.push(c);
            }
            // A line continuation.
            None if c == '\n' => {}
            _ => word.value.push(c),
        }
    }

    fn quoted(&mut self, quote: Quote, c: char) {
        let word = self.partial();
        word.raw.push(c);
        match (quote, c) {
            (Quote::Single, '\'') | (Quote::Double, '"') | (Quote::Backtick, '`') => {
                self.quote = None;
            }
            (Quote::Double, '\\') => self.escaped = true,
            // A word that expands is never completed, so where a substitution inside
            // double quotes ends doesn't matter.
            (Quote::Double, '$' | '`') => {
                word.expands = true;
                word.value.push(c);
            }
            _ => word.value.push(c),
        }
    }

    fn unquoted(&mut self, c: char, chars: &mut std::iter::Peekable<std::str::Chars<'_>>) {
        let mut next = |want: char| chars.next_if_eq(&want).is_some();
        match c {
            '\\' => {
                self.partial().raw.push(c);
                self.escaped = true;
            }
            '\'' | '"' | '`' => {
                let word = self.partial();
                word.raw.push(c);
                word.expands |= c == '`';
                self.quote = Some(match c {
                    '\'' => Quote::Single,
                    '"' => Quote::Double,
                    _ => Quote::Backtick,
                });
            }
            ' ' | '\t' => self.finish(),
            '\n' | ';' => self.new_command(),
            '|' => {
                // `|`, `||`, `|&`
                let _ = next('|') || next('&');
                self.new_command();
            }
            '&' if next('>') => {
                // `&>`, `&>>`
                next('>');
                self.redirect();
            }
            // `&`, `&&`
            '&' => {
                next('&');
                self.new_command();
            }
            '<' | '>' => {
                // `N>` and `N<`: the digits name a descriptor, not a word.
                let descriptor = self.word.as_ref().is_some_and(|word| {
                    word.raw.bytes().all(|b| b.is_ascii_digit()) && !word.raw.is_empty()
                });
                if descriptor {
                    self.word = None;
                }
                // `>>`, `>|`, `>&`, `<<`, `<<<`, `<&`, `<>`
                if c == '>' {
                    let _ = next('>') || next('|');
                } else {
                    while next('<') {}
                    next('>');
                }
                next('&');
                self.redirect();
            }
            '(' if self
                .word
                .as_ref()
                .is_some_and(|word| word.raw.ends_with('$')) =>
            {
                // `$(`: the word it interrupts resumes after the `)`.
                let word = self.word.take();
                let command = std::mem::take(&mut self.command);
                self.outer.push((command, word));
            }
            '(' => {
                self.finish();
                let command = std::mem::take(&mut self.command);
                self.outer.push((command, None));
            }
            ')' => {
                self.finish();
                if let Some((command, word)) = self.outer.pop() {
                    self.command = command;
                    self.word = word;
                    if let Some(word) = &mut self.word {
                        word.raw.push(c);
                    }
                }
            }
            _ => {
                let word = self.partial();
                word.raw.push(c);
                word.value.push(c);
                word.expands |= matches!(c, '$' | '*' | '?' | '[');
            }
        }
    }

    fn partial(&mut self) -> &mut Partial {
        self.word.get_or_insert_with(Partial::default)
    }

    fn redirect(&mut self) {
        self.finish();
        self.command.target = true;
    }

    fn new_command(&mut self) {
        self.finish();
        self.command = Command::default();
    }

    /// Ends the word being read, if any.
    fn finish(&mut self) {
        let Some(word) = self.word.take() else {
            return;
        };
        let command = &mut self.command;
        if command.target {
            command.target = false;
        } else if command.words.is_empty()
            && (KEYWORDS.contains(&word.raw.as_str()) || assignment(&word.raw))
        {
            // The command hasn't started yet.
        } else {
            command.words.push(word.value);
        }
    }
}

/// `NAME=…` or `NAME+=…`, unquoted.
fn assignment(raw: &str) -> bool {
    let Some((name, _)) = raw.split_once('=') else {
        return false;
    };
    let name = name.strip_suffix('+').unwrap_or(name);
    let mut bytes = name.bytes();
    bytes
        .next()
        .is_some_and(|b| b.is_ascii_alphabetic() || b == b'_')
        && bytes.all(|b| b.is_ascii_alphanumeric() || b == b'_')
}

/// `value` as shell text that bash and zsh both read back as exactly `value`, at any
/// position in a word: every ASCII character outside `[A-Za-z0-9._+,:@%/-]`
/// backslash-escaped, and non-ASCII characters as they are, since neither shell gives
/// those meaning. That covers blanks, separators, quotes, `$`, backticks, globs, `!`,
/// braces and `#`, and `~` and `=` everywhere: bash expands `~` at a word's start and
/// after `=` or `:` in `name=…` arguments, and zsh expands a leading `=cmd`, and `~`
/// or `=` after `=` or `:` with `MAGIC_EQUAL_SUBST`; bash's own Tab escapes both too.
/// A backslash before a newline would join lines, so callers drop control characters
/// first. Every path, command and carapace insert goes through this; history doesn't.
pub fn literal(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for c in value.chars() {
        if c.is_ascii() && !c.is_ascii_alphanumeric() && !"._+,:@%/-".contains(c) {
            escaped.push('\\');
        }
        escaped.push(c);
    }
    escaped
}

#[cfg(test)]
mod tests {
    use super::*;

    fn command(prefix: &str) -> Option<Word> {
        Some(Word::Command(prefix.to_owned()))
    }

    fn path(value: &str) -> Option<Word> {
        Some(Word::Path(value.to_owned()))
    }

    fn arg(cmd: &str, args: &[&str], cur: &str) -> Option<Word> {
        Some(Word::Arg {
            cmd: cmd.to_owned(),
            args: args.iter().map(|&arg| arg.to_owned()).collect(),
            cur: cur.to_owned(),
        })
    }

    #[test]
    fn the_lexer_picks_the_word_source() {
        let table = [
            ("", command("")),
            ("gi", command("gi")),
            ("  gi", command("gi")),
            ("git ", arg("git", &[], "")),
            ("git checkout -", arg("git", &["checkout"], "-")),
            (
                "git checkout origin/m",
                arg("git", &["checkout"], "origin/m"),
            ),
            ("ls src/", arg("ls", &[], "src/")),
            ("./scr", path("./scr")),
            ("~/bin/x", path("~/bin/x")),
            ("/usr/bi", path("/usr/bi")),
            ("ls | gr", command("gr")),
            ("ls |& gr", command("gr")),
            ("a || b && c; d & e", command("e")),
            ("(cd x; ma", command("ma")),
            ("echo $(gi", command("gi")),
            ("if gr", command("gr")),
            ("if true; then ech", command("ech")),
            ("while ! tes", command("tes")),
            ("time car", command("car")),
            ("{ ec", command("ec")),
            ("FOO=1 BAR+=x car", command("car")),
            ("FOO=1 cargo b", arg("cargo", &[], "b")),
            ("sudo FOO=1", arg("sudo", &[], "FOO=1")),
            // Redirections: their targets are paths, and `2>&1` starts nothing.
            ("ls > ou", path("ou")),
            ("ls >ou", path("ou")),
            ("ls 2>", path("")),
            ("ls >> log", path("log")),
            ("cat < in", path("in")),
            ("ls &> o", path("o")),
            ("make 2>&1 ", arg("make", &[], "")),
            ("make 2>&1 | gr", command("gr")),
            ("ls > out -", arg("ls", &[], "-")),
            ("echo a2>f", path("f")),
            // Values: escapes and quotes removed.
            ("cd My\\ Dir/s", arg("cd", &[], "My Dir/s")),
            ("cd 'My Dir'/s", arg("cd", &[], "My Dir/s")),
            ("cd \"My Dir\"/s", arg("cd", &[], "My Dir/s")),
            ("echo \"a\\b\\\"c\"", arg("echo", &[], "a\\b\"c")),
            ("echo 'it''s'", arg("echo", &[], "its")),
            // A quoted leading `~` is a file's name, not a home directory.
            ("cat \\~ro", arg("cat", &[], "./~ro")),
            ("cat '~'/s", arg("cat", &[], "./~/s")),
            ("cat ~/s", arg("cat", &[], "~/s")),
            ("cat a\\~", arg("cat", &[], "a~")),
            // Skipped: an open quote or escape, an expansion, a glob.
            ("echo 'unterminated", None),
            ("echo \"unterminated", None),
            ("echo `ls", None),
            ("echo trailing\\", None),
            ("echo $HO", None),
            ("echo \"$HO\"", None),
            ("ls *.r", None),
            ("ls file?", None),
            ("ls [ab", None),
            ("echo $(pwd)/sr", None),
            // An expansion in an earlier word doesn't matter.
            ("echo $HOME sr", arg("echo", &["$HOME"], "sr")),
        ];
        for (before, want) in table {
            assert_eq!(context(before, "").word, want, "{before:?}");
        }
    }

    #[test]
    fn history_needs_text_before_and_none_after() {
        assert!(context("git st", "").history);
        assert!(context("git st", "   ").history);
        assert!(!context("   ", "").history);
        assert!(!context("git st", " --x").history);
        // Inside a word: no word source either.
        assert_eq!(context("git st", "atus").word, None);
        assert_eq!(context("git st", " --x").word, arg("git", &[], "st"));
    }
}
