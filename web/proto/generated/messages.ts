// Generated from src/proto by `UPDATE_PROTO_TYPES=1 cargo test --lib proto::typescript`. Do not edit.

/** The protocol this build speaks (daemon-core.md §5.2). */
export const PROTOCOL_VERSION = 2;

/** WebSocket close codes (daemon-core.md §5.2). */
export const CloseCode = {
  Idle: 4000,
  Incompatible: 4001,
  Wedged: 4002,
  ProtocolViolation: 4003,
  Shutdown: 4004,
  OverCap: 4005,
  TooLarge: 4009,
  BadToken: 4401,
  AuthUnavailable: 4503,
} as const;

export type ClientMsg = { "type": "hello", "data": { protocol: number, client: ClientInfo, } }
  | { "type": "ping", "data": { t: number, } }
  | { "type": "watch", "data": { watch: number, window: WindowRef, size: Size,
/**
 * Automatic re-watches don't claim the window again.
 */
claim?: boolean, } }
  | { "type": "unwatch", "data": { watch: number, } }
  | { "type": "resize", "data": { watch: number, size: Size, } }
  | { "type": "resync", "data": { watch: number, } }
  | { "type": "input", "data": { watch: number, items: Array<InputItem>, } }
  | { "type": "paste", "data": { req: number, watch: number, text: string,
/**
 * Run Enter after the paste in the same tmux command group.
 */
enter?: boolean, } }
  | { "type": "history", "data": { req: number, watch: number, start: number, end: number, } }
  | { "type": "listSessions", "data": { req: number, } }
  | { "type": "newWindow", "data": { req: number, session: SessionRef, name?: string,
/**
 * Absolute and a directory, checked by the connection (fs.md "Path
 * resolution"); not checked against the file roots.
 */
dir?: string, } }
  | { "type": "newSession", "data": { req: number, name?: string,
/**
 * As `newWindow`'s.
 */
dir?: string,
/**
 * A scratch shell (after the core MVP).
 */
scratch?: boolean, } };

export type ServerMsg = { "type": "welcome", "data": { protocol: number, daemon: DaemonInfo, host: HostInfo, } }
  | { "type": "incompatible", "data": { min: number, max: number, daemonVersion: string, } }
  | { "type": "pong", "data": { t: number, } }
  | { "type": "watching", "data": { watch: number, window: WindowRef, session: SessionRef, pane: number,
/**
 * Null until tmux first reports it.
 */
cwd: string | null, } }
  | { "type": "watchEnded", "data": { watch: number, reason: WatchEndReason, message?: string, } }
  | { "type": "windowClosed", "data": { window: WindowRef, } }
  | { "type": "sessionClosed", "data": { session: SessionRef, } }
  | { "type": "serverExited", "data": { server: string, } }
  | { "type": "windowRenamed", "data": { window: WindowRef, name: string, } }
  | { "type": "sessionsChanged" }
  | { "type": "sessions", "data": { req: number, tmux: TmuxListing | null, } }
  | { "type": "historyChunk", "data": { req: number, watch: number, start: number,
/**
 * Retained row count at capture time; optional for protocol v1 compatibility.
 */
historySize?: number, lines: Array<Base64>,
/**
 * Packed bits: line `i` wraps forward into line `i + 1`.
 */
wraps: Base64, } }
  | { "type": "created", "data": { req: number, window: WindowRef, session: SessionRef, } }
  | { "type": "pasted", "data": { req: number, watch: number, } }
  | { "type": "error", "data": { req?: number, watch?: number, code: ErrorCode, message: string, } };

/**
 * A window on one run of a tmux server. `server` is `"<endpoint>:<pid>-<start_time>"`,
 * so a tab saved before a tmux restart never binds to the new server's `@N`.
 */
export type WindowRef = { server: string,
/**
 * `@N`.
 */
window: number, };

export type SessionRef = { server: string,
/**
 * `$N`.
 */
session: number, };

/**
 * A terminal size; the daemon clamps what clients send (daemon-core.md §6).
 */
export type Size = { cols: number, rows: number, };

/**
 * Bytes carried in JSON as standard base64.
 */
export type Base64 = string;

export type ClientInfo = { kind: ClientKind, build: string, };

export type ClientKind = "ios" | "web";

/**
 * One input item: text and bytes go to the pane as they are, a key by its tmux name.
 */
export type InputItem = { "text": string } | { "key": string } | { "bytes": Base64 };

export type DaemonInfo = { version: string, completion: boolean, };

export type HostInfo = {
/**
 * The persistent host id (auth.md).
 */
id: string, name: string, };

export type WatchEndReason = "detached" | "error" | "limit";

export type TmuxListing = { server: string, version: string, sessions: Array<SessionListing>, };

export type SessionListing = {
/**
 * `$N`.
 */
id: number, name: string, windows: Array<WindowListing>, };

export type WindowListing = {
/**
 * `@N`.
 */
id: number, index: number, name: string,
/**
 * The session's current window.
 */
active: boolean,
/**
 * Last activity, in unix seconds.
 */
activity: number, };

export type ErrorCode = "badRequest" | "noServer" | "tooManySessions" | "inputTooLarge" | "busy" | "tmux";

export type ErrorNode = { name: string, };

/**
 * Every HTTP error body.
 */
export type ErrorBody = { error: HttpError,
/**
 * Present for `node_refused`, so the browser can explain the permanent refusal.
 */
reason?: string,
/**
 * Present for `not_enrolled`, so the browser can name the node to enrol.
 */
node?: ErrorNode, };

/**
 * Every code an HTTP route answers with. Each has one status (`src/http/error.rs`),
 * except `bad_request` for a body that isn't the route's JSON, which takes axum's.
 */
export type HttpError = "bad_request" | "auth_required" | "forbidden" | "bad_origin" | "node_refused" | "not_enrolled" | "bad_code" | "outside_roots" | "outside_home" | "denied" | "not_found" | "not_a_directory" | "not_a_file" | "memory_backed" | "config_read_only" | "too_large" | "bad_range" | "busy" | "auth_unavailable" | "identity_unavailable" | "config_unavailable" | "no_space" | "internal";

/**
 * `GET /fs/roots` and the answer to every Settings change.
 */
export type Roots = {
/**
 * The canonical `$HOME`: the picker starts here.
 */
home: string, roots: Array<RootStatus>, uploadsDir: RootStatus, };

export type RootStatus = {
/**
 * As stored in `config.toml`.
 */
path: string,
/**
 * Null when the entry is missing, isn't a directory, or isn't absolute or `~/`.
 */
canonical: string | null, ok: boolean, };

/**
 * The body of `POST /fs/roots/add`, `/fs/roots/remove` and `/fs/uploads-dir`.
 */
export type PathBody = { path: string, };

/**
 * `GET /fs/list/{*path}`, and the picker's `GET /fs/dirs/{*path}`.
 */
export type Listing = {
/**
 * Canonical.
 */
path: string,
/**
 * The root it is under (the longest match), or `$HOME` for the picker.
 */
root: string,
/**
 * Null when the parent is outside every root.
 */
parent: string | null,
/**
 * Entries scanned, after the hidden and directories-only filters.
 */
total: number, offset: number,
/**
 * The directory has more entries than one scan reads.
 */
truncated: boolean, entries: Array<Entry>, };

export type Entry = {
/**
 * U+FFFD in place of bytes that aren't UTF-8.
 */
name: string,
/**
 * After following a symlink.
 */
kind: EntryKind,
/**
 * The entry itself is a symlink.
 */
link: boolean,
/**
 * Files.
 */
size?: number,
/**
 * Unix seconds; absent for `broken` and in the picker.
 */
mtime?: number,
/**
 * Files: the type `/fs/raw` would send.
 */
mime?: string,
/**
 * `false` for a name that isn't UTF-8, which can't be opened; absent otherwise.
 */
utf8?: boolean, };

export type EntryKind = "dir" | "file" | "other" | "broken";

/**
 * `201` from `POST /fs/upload`. Swift mirrors it by hand.
 */
export type Uploaded = {
/**
 * Absolute and canonical: native types it, quoted, into the tab.
 */
path: string, size: number, };

export type CompleteRequest = {
/**
 * The input from its start to the cursor, as on screen.
 */
before: string,
/**
 * The input from the cursor to its end.
 */
after: string,
/**
 * Absolute; null while the tab's directory isn't known yet.
 */
cwd: string | null, };

export type Completion = {
/**
 * At most 20, history first.
 */
chips: Array<Chip>, };

export type Chip = {
/**
 * Typed at the cursor, verbatim: it only extends what is typed, and holds no
 * control character.
 */
insert: string,
/**
 * What the chip shows: the whole history line, the command, carapace's display,
 * or the file name with a `/` for a directory.
 */
label: string, source: ChipSource,
/**
 * At most 100 bytes.
 */
description?: string, };

export type ChipSource = "history" | "command" | "carapace" | "path";
