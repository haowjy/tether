// The Platform interface and every type it names (client-architecture.md §5). Types only:
// nothing here may import an implementation, and nothing here names an environment.
import type { LinkHandlers } from "../proto/link";
import type { WindowRef } from "../proto/generated/messages";
import type { Link } from "../net/host";

/** A tether tab's identity: the daemon's `hostId` and the tmux window (never a name or index). */
export interface TabKey {
  host: string;
  window: WindowRef;
}

/** Terminal input: text, a tmux key name, raw bytes (base64) or a paste. */
export type InputEvent = { text: string } | { key: string } | { bytes: string } | { paste: string };

export interface SafeArea {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Viewport {
  /** `phone` when `min(width, stableHeight) < 600` CSS px, else `desktop`. */
  layout: "desktop" | "phone";
  /** `touch` (44 px targets) for a coarse primary pointer, else `compact`. */
  density: "compact" | "touch";
  /** Which source feeds the terminal: xterm's textarea, tether's owned input, or native. */
  directInput: "xterm" | "owned" | "native";
  scheme: "light" | "dark";
  /** CSS px of the window or web view. */
  width: number;
  /** Its height with no software keyboard: tmux is sized from this alone. */
  stableHeight: number;
  /** On screen now. */
  visibleHeight: number;
  /** Of the keyboard-hidden layout. */
  safeArea: SafeArea;
  keyboard: boolean;
}

/** Browser: never locked. */
export interface Lifecycle {
  visible: boolean;
  online: boolean;
  locked: boolean;
}

export type Unsubscribe = () => void;
export type HapticKind = "selection" | "rigid";

/** The files place `FileBrowser` holds, as saved across reloads. */
export type FilesPlace = { kind: "roots" } | { kind: "dir"; path: string } | { kind: "file"; path: string };

/** What persists across a reload. `app/persist.ts` assembles it from each owner. */
export interface SavedWorkspace {
  version: 1;
  /** The last names of each tab, so restored pills have them before the listing. */
  tabs: { key: TabKey; session: string; window: string }[];
  /** The active tab's key string. */
  active: string | null;
  files: { hostId: string; place: FilesPlace } | null;
  /** Expanded session ids, by hostId. */
  expanded: Record<string, string[]>;
  /** The host's last known name: an offline launch cannot ask `/auth/info`, yet still says "Can't reach pop-os". */
  hostName?: string;
}

export interface DraftRecord {
  key: TabKey;
  text: string;
  revision: number;
  editedAt: number;
}

export type DraftStatus = "ok" | "tooLarge" | "full" | { conflict: { text: string; revision: number } };

export interface DraftStore {
  get(key: TabKey): Promise<DraftRecord | null>;
  put(record: DraftRecord, baseRevision: number): Promise<"ok" | "conflict" | "failed">;
  delete(key: TabKey): Promise<void>;
  list(): Promise<DraftRecord[]>;
}

export interface PlatformStorage {
  /** Coalesced; the latest wins. */
  saveWorkspace(ws: SavedWorkspace): void;
  drafts: DraftStore;
  clearLocalData(): Promise<void>;
}

export interface Transport {
  /** Returns a Link at once. A refusal arrives as a synthetic close, like 4401. */
  openSocket(handle: string, handlers: LinkHandlers): Link;
  /** Where every /auth, /fs and /complete URL starts. Browser: "" (same origin). */
  httpBase(handle: string): string;
}

export interface InputPlatform {
  /** The focus mode the screen needs. Native: bridge `focus`. Browser: a no-op, because app/focus.ts already moved DOM focus. */
  setFocus(mode: "terminal" | "hidden" | "webText" | "select"): void;
  /** Native compose: answer a composeEdit or composeInsert. Browser and test: no-op. */
  composeResult(id: string, status: DraftStatus): void;
  /** Native compose: show a draft changed elsewhere. */
  composeShow(tab: TabKey, text: string, revision: number): void;
}

export type UploadEvent =
  | { id: string; progress: number }
  | { id: string; path: string }
  | { id: string; error: string };

export interface Uploads {
  /** Call synchronously in the tap. Ends on completion, failure, or the picker's cancel. */
  pick(handle: string, signal: AbortSignal): AsyncIterable<UploadEvent>;
  /** One pasted image the page already holds. Present in the browser only. */
  send?(handle: string, file: File, signal: AbortSignal): AsyncIterable<UploadEvent>;
}

/** `ready`: a new build waits for a tap. `reload`: another page applied an update, and this page keeps running the previous build. */
export type UpdateState = "none" | "ready" | "reload";
export interface Updates {
  check(): Promise<void>;
  apply(): void;
}

export interface HostEntry {
  /** The adapter's handle for this endpoint; transport methods take it. */
  handle: string;
  /** The daemon's identity and name, when the adapter already knows them. */
  hostId: string | null;
  name: string | null;
  /** The page origin the daemon must name as `browserOrigin`; null when a native token admits the client. */
  pageOrigin: string | null;
}

export interface BootResult {
  hosts: HostEntry[];
  workspace: SavedWorkspace | null;
  viewport: Viewport;
  lifecycle: Lifecycle;
}

/** The one change channel. The controller in app/ routes each event to its owner. */
export type PlatformEvent =
  | { type: "hosts"; hosts: HostEntry[] }
  | { type: "viewport"; viewport: Viewport }
  | { type: "lifecycle"; lifecycle: Lifecycle }
  | { type: "input"; tab: TabKey; events: InputEvent[] }
  | { type: "composeEdit"; id: string; tab: TabKey; text: string; baseRevision: number }
  | { type: "composeInsert"; id: string; tab: TabKey; text: string; revision: number }
  | { type: "draftChanged"; key: TabKey }
  | { type: "storage"; state: "closing" | "closed" }
  | { type: "update"; state: UpdateState };

/** Optional members are capabilities only some environments have; the interface has no environment name. */
export interface Platform {
  boot(): Promise<BootResult>;
  subscribe(listener: (event: PlatformEvent) => void): Unsubscribe;
  transport: Transport;
  input: InputPlatform;
  storage: PlatformStorage;
  uploads: Uploads;
  clipboard: { writeText(text: string): Promise<"ok" | "denied"> };
  /** http(s) only. */
  openURL(url: string): void;
  playVideo(handle: string, path: string): "handled" | "inline";
  haptic(kind: HapticKind): void;
  restart(reason: "stuck" | "update"): void;
  updates?: Updates;
  install?: { installed(): boolean };
}
