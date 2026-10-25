// The Platform interface and every type it names (client-architecture.md §5). Types only:
// nothing here may import an implementation, and nothing here names an environment.
import type { LinkHandlers } from "../proto/link";
import type { SessionRef } from "../proto/generated/messages";
import type { Link } from "../net/host";

/** A tether tab's identity: the daemon's `hostId` and the tmux session it follows (never a name or an index). */
export interface TabKey {
  host: string;
  session: SessionRef;
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
  /**
   * How far the keyboard, or Safari's form bar with a hardware keyboard, covers the bottom of
   * the stable box; 0 with none. It is the one number the dock, sheets and toasts rise by
   * (CSS reads it as `--keyboard-inset`). Smaller than the `keyboard` threshold for the bar.
   */
  keyboardInset: number;
  /** Of the keyboard-hidden layout. */
  safeArea: SafeArea;
  keyboard: boolean;
}

/** Browser: never locked. */
export interface Lifecycle {
  visible: boolean;
  online: boolean;
  locked: boolean;
  /** A native screen covers Terminal; browsers always report false. */
  covered: boolean;
}

export type Unsubscribe = () => void;
export type HapticKind = "selection" | "rigid" | "key" | "modifier";

/** The files place `FileBrowser` holds, as saved across reloads. */
export type FilesPlace = { kind: "roots" } | { kind: "dir"; path: string } | { kind: "file"; path: string };

/** What persists across a reload. `app/persist.ts` assembles it from each owner. */
export interface SavedWorkspace {
  version: 2;
  /** The last names of each tab (its session, and the window it showed), so restored pills have them before the listing. */
  tabs: { key: TabKey; session: string; window: string }[];
  /** The active tab's key string. */
  active: string | null;
  files: { hostId: string; place: FilesPlace } | null;
  /** The host's last known name: an offline launch cannot ask `/auth/info`, yet still says "Can't reach pop-os". */
  hostName?: string;
}

export interface DraftRecord {
  key: TabKey;
  text: string;
  revision: number;
  editedAt: number;
}

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
  /** Where a touch may hand the keyboard to the line field (§7.4): its rect in page coordinates, or null when Terminal is covered. Native: bridge `lineField`. Browser and test: no-op. */
  setLineFieldRect(rect: DOMRectReadOnly | null): void;
  /** The tab that keyboard input batches target, whenever the active tab changes (null: none). Native: bridge `activeTab`. Browser: no-op. */
  setActiveTab(tab: TabKey | null): void;
}

export type UploadEvent =
  | { id: string; progress: number }
  | { id: string; path: string }
  | { id: string; error: string };

export interface Clipboard {
  writeText(text: string): Promise<"ok" | "denied">;
  /** Paste in the terminal's edit menu (§7.6). Call synchronously in its tap. */
  read(tab: TabKey): Promise<{ text: string } | { image: File } | { uploading: string } | "empty" | "denied">;
}

export interface Uploads {
  /** Call synchronously in the tap. Ends on completion, failure, or the picker's cancel. */
  pick(handle: string, signal: AbortSignal): AsyncIterable<UploadEvent>;
  /** One pasted image the page already holds. Present in the browser only. */
  send?(handle: string, file: File, signal: AbortSignal): AsyncIterable<UploadEvent>;
  /** An upload the platform started itself, by the id `clipboard.read` returned as `uploading`. Native only. */
  follow?(id: string, signal: AbortSignal): AsyncIterable<UploadEvent>;
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
  clipboard: Clipboard;
  /** http(s) only. */
  openURL(url: string): void;
  playVideo(handle: string, path: string): "handled" | "inline";
  haptic(kind: HapticKind): void;
  restart(reason: "stuck" | "update"): void;
  /** Opens the platform's own screen for adding, pairing and removing servers. Native only. */
  manageHosts?: () => void;
  updates?: Updates;
  install?: { installed(): boolean };
}
