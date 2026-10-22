// Generated from src/proto by `UPDATE_PROTO_TYPES=1 cargo test --lib proto::typescript`. Do not edit.

/** The protocol this build speaks (daemon-core.md §5.2). */
export const PROTOCOL_VERSION = 1;

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
  | { "type": "watch", "data": { watch: number, window: WindowRef, size: Size, } }
  | { "type": "unwatch", "data": { watch: number, } }
  | { "type": "resize", "data": { watch: number, size: Size, } }
  | { "type": "resync", "data": { watch: number, } }
  | { "type": "input", "data": { watch: number, items: Array<InputItem>, } }
  | { "type": "paste", "data": { watch: number, text: string, } }
  | { "type": "history", "data": { req: number, watch: number, start: number, end: number, } }
  | { "type": "listSessions", "data": { req: number, } }
  | { "type": "newWindow", "data": { req: number, session: SessionRef, name?: string,
/**
 * Checked against the file roots by the connection.
 */
dir?: string, } }
  | { "type": "newSession", "data": { req: number, name?: string, dir?: string,
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
  | { "type": "historyChunk", "data": { req: number, watch: number, start: number, lines: Array<Base64>, } }
  | { "type": "created", "data": { req: number, window: WindowRef, session: SessionRef, } }
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

export type DaemonInfo = { version: string, };

export type HostInfo = {
/**
 * The persistent host id (auth.md).
 */
id: string, name: string, };

export type WatchEndReason = "detached" | "error";

export type TmuxListing = { server: string, version: string, sessions: Array<SessionListing>, };

export type SessionListing = {
/**
 * `$N`.
 */
id: number, name: string,
/**
 * A client that isn't a control client (someone's terminal) is attached.
 */
attachedElsewhere: boolean, windows: Array<WindowListing>, };

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
