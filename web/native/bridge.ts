// The only place the web UI talks to native (ios-shell.md "The bridge"). Types here are
// written twice, with ios/TetherKit/.../Bridge.swift.
import type { WindowRef } from "../proto/generated/messages";

/** Native → web input, ios-shell.md "How input reaches the terminal". */
export type InputEvent = { text: string } | { key: string } | { bytes: string } | { paste: string };

export interface SafeArea {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Viewport {
  width: number;
  height: number;
  safeArea: SafeArea;
  keyboard: boolean;
  /** The web view's height with the keyboard hidden, in the current orientation. */
  collapsedHeight: number;
  reason: "initial" | "keyboard" | "rotation";
}

export interface HostEntry {
  id: string;
  /** A label for the host list, never turned into a URL. */
  name: string;
  /** `https://<magicdns-name>`: the origin every socket and request for this host uses. */
  baseURL: string;
  enrolled: boolean;
}

/** A tab as native persists it (`saveTabs`) and returns it in `boot`. */
export interface SavedTab {
  id: string;
  host: string;
  window: WindowRef;
  name: string;
}

/** The reply to `ready`: everything the web needs to start. */
export interface Boot {
  bridgeVersion: number;
  hosts: HostEntry[];
  tabs: SavedTab[];
  /** The tab last on screen; null, or an id not in `tabs`, means the first tab. */
  active: string | null;
  settings: Record<string, unknown>;
  viewport: Viewport;
  locked: boolean;
}

/** The reply to `token { host }`. */
export type TokenReply = { token: string } | { locked: true } | { notEnrolled: true };

/** Bumped with every incompatible change to the messages here and in Bridge.swift. */
export const BRIDGE_VERSION = 1;

export type NativeMsg =
  | { type: "input"; events: InputEvent[] }
  | { type: "viewport" } & Viewport
  | { type: "lifecycle"; phase: "active" | "background" }
  | { type: "network"; reachable: boolean; interface: string }
  | { type: "lock"; locked: boolean }
  | { type: "hosts"; hosts: HostEntry[] }
  | { type: "upload"; id: string; host: string; tab: string; progress: number; path?: string; error?: string };

export type WebMsg =
  | { type: "ready" }
  | { type: "token"; host: string }
  | { type: "hostRejected"; host: string }
  | { type: "recreateWebView" }
  | { type: "saveTabs"; tabs: SavedTab[]; active: string | null }
  | { type: "focus"; mode: "terminal" | "hidden" | "webText" | "select" }
  | { type: "haptic"; kind: string }
  | { type: "prompt"; title: string; message: string; initial: string }
  | { type: "pickMedia" }
  | { type: "playVideo"; host: string; path: string }
  | { type: "openURL"; url: string }
  | { type: "ack"; id: number };

/** Sends one message and resolves with native's reply (`undefined` when it has none). */
export type Post = (msg: WebMsg) => Promise<unknown>;

interface WebkitHandler {
  postMessage(m: unknown): Promise<unknown>;
}

function webkitHandler(): WebkitHandler | undefined {
  const w = window as unknown as { webkit?: { messageHandlers?: { tether?: WebkitHandler } } };
  return w.webkit?.messageHandlers?.tether;
}

/** False in a desktop browser, where the dev shim stands in for native. */
export const hasNativeBridge = (): boolean => webkitHandler() !== undefined;

/** The `tether` WKScriptMessageHandlerWithReply. */
export const webkitPost: Post = (msg) => {
  const handler = webkitHandler();
  return handler ? handler.postMessage(msg) : Promise.reject(new Error("no native bridge"));
};

/** What the rest of the web UI calls; one method per message that has a caller. */
export class Native {
  constructor(private readonly post: Post) {}

  /** The host closed the socket with 4401: native marks it "not enrolled". */
  hostRejected(host: string): void {
    this.fire({ type: "hostRejected", host });
  }

  /** The connect timeout's last resort: reload the web view; all state is on the server. */
  recreateWebView(): void {
    this.fire({ type: "recreateWebView" });
  }

  /** Start-up: the saved tabs, the host list and the geometry. */
  async boot(): Promise<Boot> {
    return (await this.post({ type: "ready" })) as Boot;
  }

  /** A fresh token for `host`, or why there is none. */
  async token(host: string): Promise<TokenReply> {
    return (await this.post({ type: "token", host })) as TokenReply;
  }

  /** Persists the open-tab list and the tab on screen, so a restarted web view restores both. */
  saveTabs(tabs: SavedTab[], active: string | null): void {
    this.fire({ type: "saveTabs", tabs, active });
  }

  /** `[⌨]`: show the keyboard (`terminal`) or put it away (`hidden`). */
  focus(mode: "terminal" | "hidden"): void {
    this.fire({ type: "focus", mode });
  }

  /** A semantic haptic, ios-shell.md "Haptics". */
  haptic(kind: "selection"): void {
    this.fire({ type: "haptic", kind });
  }

  /** Short text entry: the web has no text fields. Null when cancelled. */
  async prompt(title: string, message: string, initial: string): Promise<string | null> {
    const reply = await this.post({ type: "prompt", title, message, initial });
    return typeof reply === "string" ? reply : null;
  }

  /** The file manager's upload button: native's photo menu, then an upload to the tab on screen. */
  pickMedia(): void {
    this.fire({ type: "pickMedia" });
  }

  /** Video and audio play in native's player, which fetches `/fs/raw` itself. */
  playVideo(host: string, path: string): void {
    this.fire({ type: "playVideo", host, path });
  }

  /** An `http`, `https` or `mailto` link: it leaves the app. */
  openURL(url: string): void {
    this.fire({ type: "openURL", url });
  }

  private fire(msg: WebMsg): void {
    // A missing bridge (desktop dev) or a native refusal has no caller to inform.
    this.post(msg).catch(() => undefined);
  }
}

/**
 * Registers `window.__tether`, which native calls (`callAsyncJavaScript`) with batches of
 * messages and to ask which tab is on screen.
 */
export function installReceiver(onMessage: (msg: NativeMsg) => void, activeTab: () => { host: string; tab: string }): void {
  (window as unknown as { __tether: unknown }).__tether = {
    receive: (messages: NativeMsg[]) => { for (const m of messages) onMessage(m); },
    activeTab,
  };
}
