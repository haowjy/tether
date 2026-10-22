// The only place the web UI talks to native (ios-shell.md "The bridge"). Types here are
// written twice, with ios/TetherKit/.../Bridge.swift.

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
  name: string;
  enrolled: boolean;
}

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
  | { type: "saveTabs"; tabs: unknown }
  | { type: "focus"; mode: "terminal" | "hidden" | "webText" | "select" }
  | { type: "haptic"; kind: string }
  | { type: "prompt"; title: string; message: string; initial: string }
  | { type: "pickMedia" }
  | { type: "playVideo"; host: string; path: string }
  | { type: "openURL"; url: string }
  | { type: "ack"; id: number };

/** Sends one message and resolves with native's reply (`undefined` when it has none). */
export type Post = (msg: WebMsg) => Promise<unknown>;

/** The `tether` WKScriptMessageHandlerWithReply. */
export const webkitPost: Post = (msg) => {
  const w = window as unknown as { webkit?: { messageHandlers?: { tether?: { postMessage(m: unknown): Promise<unknown> } } } };
  const handler = w.webkit?.messageHandlers?.tether;
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

  request(msg: WebMsg): Promise<unknown> {
    return this.post(msg);
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
