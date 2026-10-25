// The path field's completion model (browser-behaviors.md "Files"), apart from the DOM and the
// network: typed text and the folder listings held so far in, rows and what each key does out.
// `folders.ts` holds and fetches the listings; the screen draws what this returns.
import type { HttpRefusal } from "../net/http";
import { join, within } from "./paths";
import { shorten } from "./format";

/** What completion knows of the host's folders: `$HOME` and the canonical roots, uploads included. */
export interface Where {
  home: string;
  scope: string[];
}

/** One folder's subfolder names as the daemon sorted them, and whether the scan stopped short. */
export interface FolderNames {
  names: string[];
  /** Past the page limit or the daemon's scan cap: more folders may exist than are listed. */
  capped: boolean;
}

export type FolderState = { status: "loading" } | { status: "error"; error: HttpRefusal } | ({ status: "ready" } & FolderNames);

/** The cache key of one listing; `hidden` listings are kept apart (`hidden=1` is a different scan). */
export const folderKey = (path: string, hidden: boolean): string => `${hidden ? "1" : "0"}${path}`;

/** Typed text split at its last `/`. */
export interface Typed {
  /** The text through the last `/` as typed (`~/re` → `~/`), which an accepted name is appended to. */
  prefix: string;
  /** What follows the last `/`: the name being completed. */
  segment: string;
  /** The folder holding the segment, `.` and `..` resolved. */
  parent: string;
  /** The path the whole text names. */
  named: string;
}

/** `~`, `~/x` and `/x` are paths; anything else is not. `..` stops at `/`. */
export function parseTyped(text: string, home: string): Typed | null {
  const homed = text === "~" || text.startsWith("~/");
  if (!homed && !text.startsWith("/")) return null;
  const cut = text.lastIndexOf("/");
  const prefix = cut < 0 ? "~/" : text.slice(0, cut + 1);
  const resolve = (typed: string): string => {
    const stack = homed ? home.split("/").filter(Boolean) : [];
    for (const part of typed.slice(homed ? 1 : 0).split("/")) {
      if (part === "..") stack.pop();
      else if (part !== "" && part !== ".") stack.push(part);
    }
    return `/${stack.join("/")}`;
  };
  return { prefix, segment: cut < 0 ? "" : text.slice(cut + 1), parent: resolve(prefix), named: resolve(text) };
}

/** How a folder is listed: inside a root with `/fs/list`, elsewhere under `$HOME` with `/fs/dirs`, above the roots from the roots themselves, else not at all. */
export type FolderScope = "list" | "dirs" | "roots" | "outside";

export function scopeOf(path: string, where: Where): FolderScope {
  if (where.scope.some((root) => within(path, root))) return "list";
  if (within(path, where.home)) return "dirs";
  return where.scope.some((root) => within(root, path)) ? "roots" : "outside";
}

export interface CompletionRow {
  name: string;
  path: string;
  /** False for a folder under `$HOME` in none of the roots: opening it shows its subfolders and offers to add it. */
  added: boolean;
}

export interface Completion {
  /** Null while the text is not a path. */
  typed: Typed | null;
  /** What the list says instead of rows: the start of a path, or a folder tether does not reach. */
  note: "start" | "outside" | null;
  /** The listing of the typed parent. Rows exist only when it is ready. */
  folder: FolderState | null;
  /** The listing to ask for once typing settles (`Folders.ask` skips one it holds); null when none is needed. */
  ask: { path: string; hidden: boolean } | null;
  rows: CompletionRow[];
  /** The first row, once a character of the segment is typed. */
  predicted: CompletionRow | null;
  /** The rest of the prediction, shown after the caret: `ther/` for `te` → `tether`. */
  ghost: string;
  capped: boolean;
}

/** Matches as the daemon sorts: ASCII letters folded, nothing else. */
const fold = (s: string): string => s.replace(/[A-Z]/g, (c) => c.toLowerCase());

export interface CompleteContext {
  where: Where;
  /** The hidden-files toggle. */
  showHidden: boolean;
  folder: (key: string) => FolderState | undefined;
}

export function complete(text: string, ctx: CompleteContext): Completion {
  const { where } = ctx;
  const typed = parseTyped(text, where.home);
  const scope = typed && scopeOf(typed.parent, where);
  if (!typed || scope === "outside") return { typed, note: typed ? "outside" : "start", folder: null, ask: null, rows: [], predicted: null, ghost: "", capped: false };
  const hidden = ctx.showHidden || typed.segment.startsWith(".");
  const key = folderKey(typed.parent, hidden);
  const folder: FolderState | undefined = scope === "roots" ? { status: "ready", names: rootNames(typed.parent, where), capped: false } : ctx.folder(key);
  const names = folder?.status === "ready" ? folder.names : [];
  const wanted = fold(typed.segment);
  const rows = names
    .filter((name) => fold(name).startsWith(wanted))
    .map((name) => {
      const path = join(typed.parent, name);
      // A row above the roots is a step toward one, not a folder to add.
      return { name, path, added: scope === "roots" || where.scope.some((root) => within(path, root)) };
    });
  const predicted = typed.segment === "" ? null : (rows[0] ?? null);
  return {
    typed,
    note: null,
    folder: folder ?? null,
    ask: scope === "roots" ? null : { path: typed.parent, hidden },
    rows,
    predicted,
    ghost: predicted ? `${predicted.name.slice(typed.segment.length)}/` : "",
    capped: folder?.status === "ready" && folder.capped,
  };
}

/** The next segment of every root path below `parent`: what an ancestor of the roots holds. */
function rootNames(parent: string, where: Where): string[] {
  const below = parent === "/" ? "/" : `${parent}/`;
  const names = where.scope.filter((root) => root.startsWith(below)).map((root) => root.slice(below.length).split("/")[0] ?? "");
  return [...new Set(names)].sort();
}

/** The text with `name` accepted: its full path and a `/`. */
export const accept = (typed: Typed, name: string): string => `${typed.prefix}${name}/`;

/**
 * `/` typed after a partial name accepts the prediction in its place ("rep" + "/" becomes
 * "repos/"). After an exact folder name, or with nothing predicted, the `/` is just a `/`.
 * `before` is the text without the `/`; returns the text to show, or null to keep the `/`.
 */
export function slashAccepts(before: string, ctx: CompleteContext): string | null {
  const c = complete(before, ctx);
  if (!c.typed || !c.predicted) return null;
  // `.` and `..` name real folders: the `/` after them is a `/`.
  if (c.typed.segment === "." || c.typed.segment === "..") return null;
  return c.rows.some((row) => row.name === c.typed?.segment) ? null : accept(c.typed, c.predicted.name);
}

/** What Go does: open a folder, say why not (null: the list already shows the refusal), or wait for the typed parent's listing (never for a folder named whole, which opening lists). */
export type Go = { open: string } | { say: string | null } | { wait: true };

/**
 * Go opens the highlighted row, or with none the folder the text names. The listing of the
 * typed parent decides whether that folder exists, so it must have arrived (`wait`).
 */
export function go(text: string, highlighted: CompletionRow | null, ctx: CompleteContext): Go {
  if (highlighted) return reachable(highlighted.path, ctx.where);
  const c = complete(text, ctx);
  const { typed, folder } = c;
  if (!typed) return { say: "Start with ~ or /" };
  if (c.note === "outside") return { say: "Outside your folders" };
  // A trailing `.` or `..` names a folder that exists; any other segment must be one in the listing, exactly.
  if (typed.segment === "." || typed.segment === "..") return reachable(typed.named, ctx.where);
  if (!folder || folder.status === "loading") {
    // A trailing `/` names the folder itself, whose own listing opening it fetches: nothing to wait for.
    return typed.segment === "" ? reachable(typed.named, ctx.where) : { wait: true };
  }
  if (folder.status === "error") return { say: folder.error.code === "not_found" || folder.error.code === "not_a_directory" ? `No folder ${shorten(typed.named, ctx.where.home)}` : null };
  // Past the cap the folder may exist unlisted: its own listing decides.
  if (typed.segment !== "" && !folder.names.includes(typed.segment) && !folder.capped) return { say: `No folder ${shorten(typed.named, ctx.where.home)}` };
  return reachable(typed.named, ctx.where);
}

const reachable = (path: string, where: Where): Go => {
  const scope = scopeOf(path, where);
  return scope === "list" || scope === "dirs" ? { open: path } : { say: "Outside your folders" };
};
