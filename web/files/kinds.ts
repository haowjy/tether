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
 * Shiki grammars the viewer loads, one chunk each, on demand. Anything else shows as
 * plain text: each grammar is bundled into the app, so the list stays to what Jimmy's
 * repos hold.
 */
export const LANGUAGES = {
  bash: () => import("shiki/langs/bash.mjs"),
  c: () => import("shiki/langs/c.mjs"),
  cpp: () => import("shiki/langs/cpp.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  diff: () => import("shiki/langs/diff.mjs"),
  docker: () => import("shiki/langs/docker.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  ini: () => import("shiki/langs/ini.mjs"),
  java: () => import("shiki/langs/java.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  kotlin: () => import("shiki/langs/kotlin.mjs"),
  lua: () => import("shiki/langs/lua.mjs"),
  make: () => import("shiki/langs/make.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  nix: () => import("shiki/langs/nix.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  ruby: () => import("shiki/langs/ruby.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  swift: () => import("shiki/langs/swift.mjs"),
  toml: () => import("shiki/langs/toml.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  typescript: () => import("shiki/langs/typescript.mjs"),
  xml: () => import("shiki/langs/xml.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
} as const;

export type Language = keyof typeof LANGUAGES;

const BY_EXTENSION: Record<string, Language> = {
  sh: "bash", bash: "bash", zsh: "bash",
  c: "c", h: "c",
  cc: "cpp", cpp: "cpp", cxx: "cpp", hpp: "cpp", hh: "cpp",
  css: "css",
  diff: "diff", patch: "diff",
  go: "go",
  html: "html", htm: "html", xhtml: "html",
  ini: "ini", cfg: "ini", conf: "ini",
  java: "java",
  js: "javascript", mjs: "javascript", cjs: "javascript",
  json: "json", jsonc: "json", json5: "json",
  jsx: "jsx",
  kt: "kotlin", kts: "kotlin",
  lua: "lua",
  mk: "make",
  md: "markdown", markdown: "markdown",
  nix: "nix",
  py: "python", pyi: "python",
  rb: "ruby",
  rs: "rust",
  sql: "sql",
  swift: "swift",
  toml: "toml",
  tsx: "tsx",
  ts: "typescript", mts: "typescript", cts: "typescript",
  xml: "xml", svg: "xml", plist: "xml",
  yaml: "yaml", yml: "yaml",
};

const BY_NAME: Record<string, Language> = {
  makefile: "make", gnumakefile: "make",
  dockerfile: "docker", containerfile: "docker",
  ".bashrc": "bash", ".zshrc": "bash", ".profile": "bash",
};

export function languageFor(name: string): Language | null {
  const lower = name.toLowerCase();
  const byName = BY_NAME[lower];
  if (byName) return byName;
  const dot = lower.lastIndexOf(".");
  return dot > 0 ? (BY_EXTENSION[lower.slice(dot + 1)] ?? null) : null;
}
