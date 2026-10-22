// TODO: hand-written stand-in for the ts-rs output of src/proto/ (daemon-core.md §5.5,
// which targets web/src/proto/generated/). Replace this file when the generator lands;
// shapes follow §5.3 exactly, camelCase.

export const PROTOCOL_VERSION = 1;

export interface WindowRef { server: string; window: number }
export interface SessionRef { server: string; session: number }
export interface Size { cols: number; rows: number }

export type InputItem = { text: string } | { key: string } | { bytes: string /* base64 */ };

type Msg<T extends string, D = undefined> = D extends undefined ? { type: T } : { type: T; data: D };

export type ClientMessage =
  | Msg<"hello", { protocol: number; client: { kind: "ios" | "web"; build: string } }>
  | Msg<"ping", { t: number }>
  | Msg<"watch", { watch: number; window: WindowRef; size: Size }>
  | Msg<"unwatch", { watch: number }>
  | Msg<"resize", { watch: number; size: Size }>
  | Msg<"resync", { watch: number }>
  | Msg<"input", { watch: number; items: InputItem[] }>
  | Msg<"paste", { watch: number; text: string }>
  | Msg<"history", { req: number; watch: number; start: number; end: number }>
  | Msg<"listSessions", { req: number }>
  | Msg<"newWindow", { req: number; session: SessionRef; name?: string; dir?: string }>
  | Msg<"newSession", { req: number; name?: string; dir?: string; scratch?: boolean }>;

export interface SessionListing {
  id: number;
  name: string;
  attachedElsewhere: boolean;
  windows: { id: number; index: number; name: string; active: boolean; activity: number }[];
}

export type ErrorCode = "badRequest" | "noServer" | "tooManySessions" | "inputTooLarge" | "busy" | "tmux";

export type ServerMessage =
  | Msg<"welcome", { protocol: number; daemon: { version: string }; host: { id: string; name: string } }>
  | Msg<"incompatible", { min: number; max: number; daemonVersion: string }>
  | Msg<"pong", { t: number }>
  | Msg<"watching", { watch: number; window: WindowRef; session: SessionRef; pane: number; cwd: string | null }>
  | Msg<"watchEnded", { watch: number; reason: "detached" | "error"; message?: string }>
  | Msg<"windowClosed", { window: WindowRef }>
  | Msg<"sessionClosed", { session: SessionRef }>
  | Msg<"serverExited", { server: string }>
  | Msg<"windowRenamed", { window: WindowRef; name: string }>
  | Msg<"sessionsChanged">
  | Msg<"sessions", {
      req: number;
      tmux: "notRunning" | { server: string; version: string; sessions: SessionListing[] };
    }>
  | Msg<"historyChunk", { req: number; watch: number; start: number; lines: string[] }>
  | Msg<"created", { req: number; window: WindowRef; session: SessionRef }>
  | Msg<"error", { req?: number; watch?: number; code: ErrorCode; message: string }>;

/** Close codes, daemon-core.md §5.2. */
export const CloseCode = {
  Idle: 4000,
  Incompatible: 4001,
  Wedged: 4002,
  ProtocolViolation: 4003,
  Shutdown: 4004,
  OverCap: 4005,
  TooLarge: 4009,
  BadToken: 4401,
} as const;
