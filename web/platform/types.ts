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
   * the page the web can see; 0 with none. The dock, sheets and toasts rise by this much (CSS
   * reads it as `--keyboard-inset`). The app's shell moves its web view above a docked
   * keyboard instead, so it reports 0 and nothing rises. Smaller than the `keyboard` threshold
   * for the bar.
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
export type FocusMode = "terminal" | "line" | "hidden" | "webText" | "select";

/** UTF-16 offsets into a line, matching the native text field's NSRange. */
export interface TextRange { start: number; end: number }
/** Native's retained in-progress edit, adopted into `lineDrafts` after a web-content-process restart. */
export interface NativeLineSnapshot { tab: TabKey; gen: number; text: string; selection: TextRange; marked: TextRange | null }

/** Where a Files tab is: the folder list of its roots, a folder, or a file preview. */
export type FilesPlace = { kind: "roots" } | { kind: "dir"; path: string } | { kind: "file"; path: string };

export function samePlace(a: FilesPlace, b: FilesPlace): boolean {
  return a.kind === "roots" ? b.kind === "roots" : b.kind === a.kind && b.path === a.path;
}

/** One saved tab, in tab order. A Files tab's id is its own; a terminal tab's is `tabId(key)`. */
export type SavedTab =
  | { kind: "terminal"; key: TabKey; session: string; window: string }
  | { kind: "files"; id: string; host: string; place: FilesPlace };

/** What persists across a reload. `app/persist.ts` assembles it; `workspace/saved.ts` is the one parser. */
export interface SavedWorkspace {
  version: 3;
  /** Terminal tabs carry the last names of their session and window, so restored pills have them before the listing. */
  tabs: SavedTab[];
  /** The active tab's id. */
  active: string | null;
  /** Per host, the terminal tab last activated: where Insert path and uploads go. */
  lastTerminal: Record<string, string>;
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
  setFocus(mode: FocusMode): void;
  /** The native text field's editing copy of the active tab's draft. Other platforms own their input element. */
  /** Replace native's editing copy and bind it to a tab; native advances its own generation. */
  setLine(text: string, caret: number, tab: TabKey): Promise<number>;
  /** Move the native caret or selection to the mirror's UTF-16 offset. */
  setLineCaret(index: number): void;
  /** Insert one line at the native caret. */
  insertLine(text: string): void;
  /** Select the native editing copy's full text. */
  selectAllLine(): void;
  /** Keep the native responder in step with the web-owned armed modifier. */
  setArmedModifier(armed: "ctrl" | "alt" | null): void;
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

/**
 * `ready`: a new build waits for a tap. `reload`: another page applied an update, and this page keeps
 * running the previous build. `required`: this page asked for a file of its build and the daemon no
 * longer has it.
 */
export type UpdateState = "none" | "ready" | "reload" | "required";
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
  /** As stored, possibly by an older build: `workspace/saved.ts` parses it. */
  workspace: unknown;
  viewport: Viewport;
  lifecycle: Lifecycle;
  /** Native's focus target, retained if the web content process had to restart. */
  focusMode: FocusMode | null;
  /** Present only when native restored the `line` target; reconciled after draft storage loads. */
  lineSnapshot: NativeLineSnapshot | null;
}

/** The one change channel. The controller in app/ routes each event to its owner. */
export type PlatformEvent =
  | { type: "hosts"; hosts: HostEntry[] }
  | { type: "viewport"; viewport: Viewport }
  | { type: "lifecycle"; lifecycle: Lifecycle }
  | { type: "input"; tab: TabKey; events: InputEvent[] }
  | { type: "lineEdit"; gen: number; text: string; tab: TabKey; selection: TextRange; marked: TextRange | null }
  | { type: "lineReturn"; gen: number; text: string; tab: TabKey }
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
  /** http(s) and mailto: only. */
  openURL(url: string): void;
  playVideo(handle: string, path: string): "handled" | "inline";
  haptic(kind: HapticKind): void;
  restart(reason: "stuck" | "update"): void;
  /** Opens the platform's own screen for adding, pairing and removing servers. Native only. */
  manageHosts?: () => void;
  /** Hands a server's https origin, and the unspent enrolment code if the page holds one, to the tether app installed on this device. Offered only where the app can exist (iPhone, iPad) and this is not the app. */
  openInApp?: (origin: string, code: string | null) => void;
  updates?: Updates;
  install?: { installed(): boolean };
}
