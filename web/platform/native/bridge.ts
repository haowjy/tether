// The only place the web UI talks to native (ios-shell.md "The bridge"). One method per
// web → native request, each returning what native replies; `parseEvent` checks what native
// sends. The shapes are pinned against ios/TetherKit/Tests/Fixtures/bridge/ by bridge.test.ts.
import type { DraftRecord, FocusMode, HostEntry, InputEvent, Lifecycle, NativeLineSnapshot, Preferences, SavedWorkspace, TabKey, TextRange, Viewport } from "../types";

/** Bumped with every incompatible change here and in ios/TetherKit/.../Bridge.swift. */
export const BRIDGE_VERSION = 7;

export interface Boot {
  bridgeVersion: number;
  hosts: HostEntry[];
  workspace: unknown;
  viewport: Viewport;
  preferences: Preferences;
  lifecycle: Lifecycle;
  focusMode: FocusMode;
  lineSnapshot: NativeLineSnapshot | null;
}

/** The reply to `socket`. The token never leaves the Link that asked. */
export type SocketReply = { url: string; token: string } | { locked: true } | { notEnrolled: true };

export type LineRange = TextRange;
export type PasteboardReply = { text: string } | { uploading: string } | "empty" | "denied";

/** `id` is the one the page sent with `pickMedia` or `readPasteboard`. `cancelled` ends a pick whose picker was dismissed. */
export interface UploadMsg {
  id: string;
  progress: number;
  path?: string;
  error?: string;
  cancelled?: true;
}

export type NativeMsg =
  | { type: "input"; tab: TabKey; events: InputEvent[] }
  | { type: "lineEdit"; gen: number; text: string; tab: TabKey; selection: LineRange; marked: LineRange | null }
  | { type: "lineReturn"; gen: number; text: string; tab: TabKey }
  | { type: "viewport"; viewport: Viewport }
  | { type: "lifecycle"; lifecycle: Lifecycle }
  | { type: "hosts"; hosts: HostEntry[] }
  | ({ type: "upload" } & UploadMsg);

const EVENT_TYPES: readonly string[] = ["input", "lineEdit", "lineReturn", "viewport", "lifecycle", "hosts", "upload"];

/** Native's events are first-party, but the page is the trust boundary: an unknown or malformed one is dropped. */
export function parseEvent(raw: unknown): NativeMsg | null {
  if (typeof raw !== "object" || raw === null) return null;
  const msg = raw as Record<string, unknown>;
  if (typeof msg["type"] !== "string" || !EVENT_TYPES.includes(msg["type"])) return null;
  const has = (...fields: string[]): boolean => fields.every((f) => typeof msg[f] === "object" && msg[f] !== null);
  switch (msg["type"]) {
    case "input": return has("tab") && Array.isArray(msg["events"]) ? (raw as NativeMsg) : null;
    case "lineEdit": {
      const range = (value: unknown): value is LineRange => typeof value === "object" && value !== null &&
        Number.isSafeInteger((value as Record<string, unknown>)["start"]) && Number.isSafeInteger((value as Record<string, unknown>)["end"]);
      if (!Number.isSafeInteger(msg["gen"]) || (msg["gen"] as number) < 0 || typeof msg["text"] !== "string" || !range(msg["selection"])) return null;
      const selection = msg["selection"];
      if (selection.start < 0 || selection.end < selection.start || selection.end > msg["text"].length) return null;
      if (msg["marked"] !== null) {
        if (!range(msg["marked"]) || msg["marked"].start < 0 || msg["marked"].end < msg["marked"].start || msg["marked"].end > msg["text"].length) return null;
      }
      if (!has("tab")) return null;
      return raw as NativeMsg;
    }
    case "lineReturn": return Number.isSafeInteger(msg["gen"]) && (msg["gen"] as number) >= 0 && typeof msg["text"] === "string" && has("tab") ? (raw as NativeMsg) : null;
    case "viewport": return has("viewport") ? (raw as NativeMsg) : null;
    case "lifecycle": return has("lifecycle") ? (raw as NativeMsg) : null;
    case "hosts": return Array.isArray(msg["hosts"]) ? (raw as NativeMsg) : null;
    default: return typeof msg["id"] === "string" && typeof msg["progress"] === "number" ? (raw as NativeMsg) : null;
  }
}

/** Sends one flat message and resolves with native's reply. */
export type Post = (msg: Record<string, unknown>) => Promise<unknown>;

interface WebkitHandler {
  postMessage(m: unknown): Promise<unknown>;
}

function handler(): WebkitHandler | undefined {
  const w = window as unknown as { webkit?: { messageHandlers?: { tether?: WebkitHandler } } };
  return w.webkit?.messageHandlers?.tether;
}

/** False in a browser, where main.tsx picks the browser adapter. */
export const hasNativeBridge = (): boolean => handler() !== undefined;

/** The `tether` WKScriptMessageHandlerWithReply. */
export const webkitPost: Post = (msg) => {
  const h = handler();
  return h ? h.postMessage(msg) : Promise.reject(new Error("no native bridge"));
};

/** Registers `window.__tether.receive`, which native calls with arrays of events. Call before `ready`. */
export function installReceiver(onEvent: (msg: NativeMsg) => void): void {
  (window as unknown as { __tether: unknown }).__tether = {
    receive: (messages: unknown[]) => {
      for (const raw of messages) {
        const msg = parseEvent(raw);
        if (msg) onEvent(msg);
      }
    },
  };
}

export class Bridge {
  constructor(private readonly post: Post) {}

  async ready(): Promise<Boot> {
    const boot = (await this.post({ type: "ready" })) as Boot;
    if (boot.bridgeVersion !== BRIDGE_VERSION) throw new Error(`native speaks bridge ${String(boot.bridgeVersion)}, this build ${String(BRIDGE_VERSION)}`);
    return boot;
  }

  /** Immediately before each socket opens. */
  socket(host: string): Promise<SocketReply> {
    return this.post({ type: "socket", host }) as Promise<SocketReply>;
  }

  /** The socket presenting exactly `token` was refused with 4401: native deletes it if it is still the stored one. */
  hostRejected(host: string, token: string): void {
    this.fire({ type: "hostRejected", host, token });
  }

  recreateWebView(): void {
    this.fire({ type: "recreateWebView" });
  }

  saveWorkspace(workspace: SavedWorkspace): void {
    this.fire({ type: "saveWorkspace", workspace });
  }

  setFocus(mode: FocusMode): void {
    this.fire({ type: "focus", mode });
  }

  setLine(text: string, caret: number, tab: TabKey): Promise<number> {
    return this.post({ type: "lineSet", text, caret, tab }) as Promise<number>;
  }

  lineCaret(index: number): void {
    this.fire({ type: "lineCaret", index });
  }

  lineCaretStep(step: -1 | 1): void {
    this.fire({ type: "lineCaretStep", step });
  }

  lineInsert(text: string): void {
    this.fire({ type: "lineInsert", text });
  }

  lineSubmit(): void {
    this.fire({ type: "lineSubmit" });
  }

  lineSelectAll(): void {
    this.fire({ type: "lineSelectAll" });
  }

  modifiers(armed: "ctrl" | "alt" | null): void {
    this.fire({ type: "modifiers", armed });
  }

  activeTab(tab: TabKey | null): void {
    this.fire({ type: "activeTab", tab });
  }

  draftGet(key: TabKey): Promise<DraftRecord | null> {
    return this.post({ type: "draftGet", key }) as Promise<DraftRecord | null>;
  }

  draftPut(record: DraftRecord, baseRevision: number): Promise<"ok" | "conflict" | "failed"> {
    return this.post({ type: "draftPut", record, baseRevision }) as Promise<"ok" | "conflict" | "failed">;
  }

  async draftDelete(key: TabKey): Promise<void> {
    await this.post({ type: "draftDelete", key });
  }

  draftList(): Promise<DraftRecord[]> {
    return this.post({ type: "draftList" }) as Promise<DraftRecord[]>;
  }

  /** User-initiated Copy only; native always writes the pasteboard. */
  copy(text: string): Promise<"ok"> {
    return this.post({ type: "copy", text }) as Promise<"ok">;
  }

  /** A pasted image uploads under `id`, to the tab's host; native reports it with `upload` events. */
  readPasteboard(tab: TabKey, id: string): Promise<PasteboardReply> {
    return this.post({ type: "readPasteboard", tab, id }) as Promise<PasteboardReply>;
  }

  haptic(kind: string): void {
    this.fire({ type: "haptic", kind });
  }

  /** Synchronously inside the tap: native presents its picker and uploads the pick to `host`, reporting it under `id`. */
  pickMedia(id: string, host: string): void {
    this.fire({ type: "pickMedia", id, host });
  }

  playVideo(host: string, path: string): void {
    this.fire({ type: "playVideo", host, path });
  }

  /** Native keeps the choice, applies it (appearance to its own chrome, relock to its lock) and answers with every preference. */
  setPreference<K extends keyof Preferences>(name: K, value: Preferences[K]): Promise<Preferences> {
    return this.post({ type: "setPreference", name, value }) as Promise<Preferences>;
  }

  manageHosts(): void {
    this.fire({ type: "manageHosts" });
  }

  openURL(url: string): void {
    this.fire({ type: "openURL", url });
  }

  private fire(msg: Record<string, unknown>): void {
    // A native refusal has no caller to inform.
    this.post(msg).catch(() => undefined);
  }
}
