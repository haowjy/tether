// Which viewer opens a file (plan.md "File manager"), and the code viewer's language
// allowlist. The type comes from the daemon's table (fs.md "Content types"); the language
// goes by extension, as fs.md says.

export type ViewerKind = "code" | "markdown" | "image" | "media" | "binary";

export function viewerFor(mime: string | null): ViewerKind {
  const type = (mime ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (type === "text/markdown") return "markdown";
  if (type.startsWith("text/")) return "code";
  if (type.startsWith("image/")) return "image";
  // The native player takes audio as well as video.
  if (type.startsWith("video/") || type.startsWith("audio/")) return "media";
  // An empty file has no type: show it as (empty) text.
  if (mime === null) return "code";
  return "binary";
}

/**
 * Shiki grammars the viewer loads, one chunk each, on demand: the allowlist of
 * client-architecture.md §8.4, matching `GRAMMARS` in vite.config.ts. Anything else shows as
 * plain text, since each grammar is bundled into the app.
 */
export const LANGUAGES = {
  bash: () => import("shiki/langs/bash.mjs"),
  c: () => import("shiki/langs/c.mjs"),
  diff: () => import("shiki/langs/diff.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  swift: () => import("shiki/langs/swift.mjs"),
  toml: () => import("shiki/langs/toml.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  typescript: () => import("shiki/langs/typescript.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
} as const;

export type Language = keyof typeof LANGUAGES;

const BY_EXTENSION: Record<string, Language> = {
  sh: "bash", bash: "bash", zsh: "bash",
  c: "c", h: "c",
  diff: "diff", patch: "diff",
  go: "go",
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript",
  json: "json", jsonc: "json", json5: "json",
  md: "markdown", markdown: "markdown",
  py: "python", pyi: "python",
  rs: "rust",
  swift: "swift",
  toml: "toml",
  ts: "typescript", mts: "typescript", cts: "typescript", tsx: "tsx",
  yaml: "yaml", yml: "yaml",
};

const BY_NAME: Record<string, Language> = {
  ".bashrc": "bash", ".zshrc": "bash", ".profile": "bash",
};

export function languageFor(name: string): Language | null {
  const lower = name.toLowerCase();
  const byName = BY_NAME[lower];
  if (byName) return byName;
  const dot = lower.lastIndexOf(".");
  return dot > 0 ? (BY_EXTENSION[lower.slice(dot + 1)] ?? null) : null;
}
