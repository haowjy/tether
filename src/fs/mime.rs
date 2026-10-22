//! The content types `/fs/raw` sends (fs.md "Content types"): an allowlist by
//! lowercased extension, plus a few whole names. It sends nothing a browser runs: HTML,
//! script, CSS and XML go out as plain text, and `nosniff` makes the declared type the
//! only one.

const TEXT: &str = "text/plain; charset=utf-8";
const MARKDOWN: &str = "text/markdown; charset=utf-8";
const BINARY: &str = "application/octet-stream";

/// By lowercased extension.
const BY_EXTENSION: &[(&str, &str)] = &[
    ("png", "image/png"),
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("gif", "image/gif"),
    ("webp", "image/webp"),
    ("heic", "image/heic"),
    ("heif", "image/heif"),
    ("avif", "image/avif"),
    ("bmp", "image/bmp"),
    ("ico", "image/x-icon"),
    // `<img>` runs no script in an SVG.
    ("svg", "image/svg+xml"),
    ("mp4", "video/mp4"),
    ("m4v", "video/mp4"),
    ("mov", "video/quicktime"),
    ("mp3", "audio/mpeg"),
    ("m4a", "audio/mp4"),
    ("wav", "audio/wav"),
    ("md", MARKDOWN),
    ("markdown", MARKDOWN),
    ("pdf", "application/pdf"),
    // Markup a browser would render, served as text.
    ("html", TEXT),
    ("htm", TEXT),
    ("xhtml", TEXT),
    ("xml", TEXT),
    ("css", TEXT),
    ("js", TEXT),
    ("mjs", TEXT),
    ("cjs", TEXT),
    // Source, config, data.
    ("txt", TEXT),
    ("text", TEXT),
    ("log", TEXT),
    ("csv", TEXT),
    ("tsv", TEXT),
    ("json", TEXT),
    ("jsonl", TEXT),
    ("ndjson", TEXT),
    ("jsonc", TEXT),
    ("json5", TEXT),
    ("toml", TEXT),
    ("yaml", TEXT),
    ("yml", TEXT),
    ("ini", TEXT),
    ("cfg", TEXT),
    ("conf", TEXT),
    ("env", TEXT),
    ("properties", TEXT),
    ("lock", TEXT),
    ("rs", TEXT),
    ("go", TEXT),
    ("mod", TEXT),
    ("sum", TEXT),
    ("py", TEXT),
    ("pyi", TEXT),
    ("ipynb", TEXT),
    ("rb", TEXT),
    ("ts", TEXT),
    ("tsx", TEXT),
    ("jsx", TEXT),
    ("mts", TEXT),
    ("cts", TEXT),
    ("vue", TEXT),
    ("svelte", TEXT),
    ("astro", TEXT),
    ("scss", TEXT),
    ("sass", TEXT),
    ("less", TEXT),
    ("c", TEXT),
    ("h", TEXT),
    ("cc", TEXT),
    ("cpp", TEXT),
    ("cxx", TEXT),
    ("hpp", TEXT),
    ("hh", TEXT),
    ("m", TEXT),
    ("mm", TEXT),
    ("swift", TEXT),
    ("kt", TEXT),
    ("kts", TEXT),
    ("java", TEXT),
    ("gradle", TEXT),
    ("scala", TEXT),
    ("clj", TEXT),
    ("cljs", TEXT),
    ("edn", TEXT),
    ("ex", TEXT),
    ("exs", TEXT),
    ("erl", TEXT),
    ("hrl", TEXT),
    ("hs", TEXT),
    ("ml", TEXT),
    ("mli", TEXT),
    ("fs", TEXT),
    ("fsx", TEXT),
    ("cs", TEXT),
    ("lua", TEXT),
    ("pl", TEXT),
    ("pm", TEXT),
    ("php", TEXT),
    ("r", TEXT),
    ("jl", TEXT),
    ("dart", TEXT),
    ("zig", TEXT),
    ("nim", TEXT),
    ("el", TEXT),
    ("lisp", TEXT),
    ("scm", TEXT),
    ("rkt", TEXT),
    ("vim", TEXT),
    ("sh", TEXT),
    ("bash", TEXT),
    ("zsh", TEXT),
    ("fish", TEXT),
    ("ps1", TEXT),
    ("bat", TEXT),
    ("sql", TEXT),
    ("graphql", TEXT),
    ("gql", TEXT),
    ("proto", TEXT),
    ("tex", TEXT),
    ("bib", TEXT),
    ("rst", TEXT),
    ("adoc", TEXT),
    ("org", TEXT),
    ("mdx", TEXT),
    ("diff", TEXT),
    ("patch", TEXT),
    ("nix", TEXT),
    ("tf", TEXT),
    ("hcl", TEXT),
    ("cmake", TEXT),
    ("mk", TEXT),
    ("service", TEXT),
    ("timer", TEXT),
    ("socket", TEXT),
    ("srt", TEXT),
    ("vtt", TEXT),
    ("plist", TEXT),
];

/// Whole names, lowercased, for files with no extension that the table could use.
const BY_NAME: &[&str] = &[
    "makefile",
    "gnumakefile",
    "dockerfile",
    "containerfile",
    "justfile",
    "license",
    "readme",
    "changelog",
    "gemfile",
    "rakefile",
    "procfile",
    ".gitignore",
    ".gitattributes",
    ".editorconfig",
    ".env",
    ".bashrc",
    ".bash_profile",
    ".profile",
    ".zshrc",
    ".vimrc",
];

/// The type for a file named `name`.
pub fn for_name(name: &str) -> &'static str {
    let lower = name.to_ascii_lowercase();
    if BY_NAME.contains(&lower.as_str()) {
        return TEXT;
    }
    let Some((_, extension)) = lower.rsplit_once('.').filter(|(stem, _)| !stem.is_empty()) else {
        return BINARY;
    };
    BY_EXTENSION
        .iter()
        .find(|(known, _)| *known == extension)
        .map_or(BINARY, |(_, mime)| mime)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nothing_a_browser_runs_is_ever_sent() {
        // fs.md's table of types, and nothing else.
        let specified = [
            "image/png",
            "image/jpeg",
            "image/gif",
            "image/webp",
            "image/heic",
            "image/heif",
            "image/avif",
            "image/bmp",
            "image/x-icon",
            "image/svg+xml",
            "video/mp4",
            "video/quicktime",
            "audio/mpeg",
            "audio/mp4",
            "audio/wav",
            MARKDOWN,
            TEXT,
            "application/pdf",
        ];
        for (extension, mime) in BY_EXTENSION {
            assert!(specified.contains(mime), "{extension} → {mime}");
        }
        for name in [
            "a.html", "a.HTM", "a.xhtml", "a.js", "a.mjs", "a.css", "a.xml",
        ] {
            assert_eq!(for_name(name), TEXT, "{name}");
        }
        assert_eq!(for_name("logo.svg"), "image/svg+xml");
    }

    #[test]
    fn types_come_from_the_lowercased_extension_or_the_whole_name() {
        assert_eq!(for_name("clip.MOV"), "video/quicktime");
        assert_eq!(for_name("clip.m4v"), "video/mp4");
        assert_eq!(for_name("IMG_0001.HEIC"), "image/heic");
        assert_eq!(for_name("README.md"), MARKDOWN);
        assert_eq!(for_name("Makefile"), TEXT);
        assert_eq!(for_name("LICENSE"), TEXT);
        assert_eq!(for_name(".gitignore"), TEXT);
        assert_eq!(for_name("main.rs"), TEXT);
        assert_eq!(for_name("archive.tar.gz"), BINARY);
        assert_eq!(for_name("noextension"), BINARY);
        assert_eq!(for_name(".hidden"), BINARY);
        assert_eq!(for_name("trailing."), BINARY);
    }
}
