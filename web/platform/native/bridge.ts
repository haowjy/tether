// The only place the web UI talks to native (ios-shell.md "The bridge"). One method per
// web → native request, each returning what native replies; `parseEvent` checks what native
// sends. The shapes are pinned against ios/TetherKit/Tests/Fixtures/bridge/ by bridge.test.ts.
import type { DraftRecord, HostEntry, InputEvent, Lifecycle, SavedWorkspace, TabKey, Viewport } from "../types";

/** Bumped with every incompatible change here and in ios/TetherKit/.../Bridge.swift. */
export const BRIDGE_VERSION = 3;

export interface Boot {
  bridgeVersion: number;
  hosts: HostEntry[];
  workspace: SavedWorkspace | null;
  viewport: Viewport;
  lifecycle: Lifecycle;
}

/** The reply to `socket`. The token never leaves the Link that asked. */
export type SocketReply = { url: string; token: string } | { locked: true } | { notEnrolled: true };

export type FocusMode = "terminal" | "hidden" | "webText" | "select";
export type PasteboardReply = { text: string } | { uploading: string } | "empty" | "denied";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

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
  | { type: "viewport"; viewport: Viewport }
  | { type: "lifecycle"; lifecycle: Lifecycle }
  | { type: "hosts"; hosts: HostEntry[] }
  | ({ type: "upload" } & UploadMsg);

const EVENT_TYPES: readonly string[] = ["input", "viewport", "lifecycle", "hosts", "upload"];

/** Native's events are first-party, but the page is the trust boundary: an unknown or malformed one is dropped. */
export function parseEvent(raw: unknown): NativeMsg | null {
  if (typeof raw !== "object" || raw === null) return null;
  const msg = raw as Record<string, unknown>;
  if (typeof msg["type"] !== "string" || !EVENT_TYPES.includes(msg["type"])) return null;
  const has = (...fields: string[]): boolean => fields.every((f) => typeof msg[f] === "object" && msg[f] !== null);
  switch (msg["type"]) {
    case "input": return has("tab") && Array.isArray(msg["events"]) ? (raw as NativeMsg) : null;
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

  activeTab(tab: TabKey | null): void {
    this.fire({ type: "activeTab", tab });
  }

  /** The line field's rect in web-view coordinates, or null when it is unavailable or covered. */
  lineField(rect: Rect | null): void {
    this.fire({ type: "lineField", rect });
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
