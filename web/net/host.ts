import type { Frame } from "../proto/frames";
import type { LinkClose, LinkHandlers } from "../proto/link";
import type { ClientMsg, ServerMsg } from "../proto/generated/messages";
import { CloseCode } from "../proto/generated/messages";
import { backoffMs, type Halt } from "../tabs/connection";

/** What a host needs of its socket; `HostLink` fits. */
export interface Link {
  readonly ready: boolean;
  send(msg: ClientMsg): void;
  close(): void;
}

/** A tab's side of the host: what the host calls. */
export interface TabPort {
  /** The socket is welcomed: watches can be sent. */
  linkUp(): void;
  /** The socket is gone. `retryInMs` is when the host tries again, null if it waits for a tap. */
  linkLost(info: { retryInMs: number | null; halt?: Halt }): void;
  /** The app went to the background and the host closed the socket on purpose. */
  paused(): void;
  message(msg: ServerMsg): void;
  frame(frame: Frame): void;
}

export interface HostOptions {
  /** Opens a socket; called again after every loss. */
  open(handlers: LinkHandlers): Link;
  /** The daemon closed with 4401: native marks the host "not enrolled". */
  onRejected(): void;
  /** Two sockets in a row stuck in CONNECTING: reload the web view. */
  onStuck(): void;
  random?: () => number;
}

type Status = "idle" | "connecting" | "open" | "waiting" | "halted" | "background";

/**
 * One host's WebSocket, shared by all its tabs (plan.md "Reconnect"). It owns the link's
 * life (backoff, 4401, the connect timeout, the background) and routes what arrives to
 * the tab that asked, by watch id or request id. Ids are host-wide because they share
 * one socket.
 */
export class Host {
  private readonly opts: HostOptions;
  private readonly tabs = new Set<TabPort>();
  private readonly watchRoutes = new Map<number, TabPort>();
  /** Requests awaiting an answer; `watch` is null for those that name none (listings, creates). */
  private readonly reqRoutes = new Map<number, { tab: TabPort; watch: number | null }>();
  private status: Status = "idle";
  private link: Link | null = null;
  private attempt = 0;
  private stuck = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private lastWatch = 0;
  private lastReq = 0;

  constructor(opts: HostOptions) {
    this.opts = opts;
  }

  get ready(): boolean {
    return this.status === "open" && this.link?.ready === true;
  }

  nextWatch(): number {
    return ++this.lastWatch;
  }

  nextReq(): number {
    return ++this.lastReq;
  }

  join(tab: TabPort): void {
    this.tabs.add(tab);
    if (this.status === "idle") this.connect();
  }

  /** The last tab leaving closes the socket: nothing is held for a host nobody views. */
  leave(tab: TabPort): void {
    this.tabs.delete(tab);
    for (const [watch, owner] of this.watchRoutes) if (owner === tab) this.watchRoutes.delete(watch);
    for (const [req, route] of this.reqRoutes) if (route.tab === tab) this.reqRoutes.delete(req);
    if (this.tabs.size === 0 && this.status !== "background") this.stop("idle");
  }

  /** Sends for `tab`, remembering which tab owns the watch or request it names. */
  send(tab: TabPort, msg: ClientMsg): void {
    switch (msg.type) {
      case "watch":
        this.watchRoutes.set(msg.data.watch, tab);
        break;
      case "unwatch":
        this.watchRoutes.delete(msg.data.watch);
        this.dropReqs(msg.data.watch);
        break;
      case "history":
        this.reqRoutes.set(msg.data.req, { tab, watch: msg.data.watch });
        break;
      case "listSessions":
      case "newWindow":
      case "newSession":
        // Their answers are broadcast (every tab prunes on a listing); only an error is routed.
        this.reqRoutes.set(msg.data.req, { tab, watch: null });
        break;
      default:
        break;
    }
    this.link?.send(msg);
  }

  /** A tab's watch ended on the daemon's word: forget its routes. */
  release(watch: number): void {
    this.watchRoutes.delete(watch);
    this.dropReqs(watch);
  }

  /** Visible, back online, or a pill tapped: reconnect now unless the socket is up. */
  nudge(): void {
    if (this.tabs.size === 0 || this.status === "background" || this.status === "open" || this.status === "connecting") return;
    this.attempt = 0;
    this.connect();
  }

  /** `lifecycle background`: close cleanly so the daemon frees the window at once. */
  background(): void {
    if (this.status === "background") return;
    const wasUp = this.status === "open" || this.status === "connecting";
    this.stop("background");
    if (wasUp) for (const tab of this.tabs) tab.paused();
  }

  /** `lifecycle active`: reconnect at once; tabs watch again on welcome. */
  foreground(): void {
    if (this.status !== "background") return;
    this.status = "idle";
    this.attempt = 0;
    this.stuck = 0;
    if (this.tabs.size > 0) this.connect();
  }

  private connect(): void {
    clearTimeout(this.retryTimer);
    this.status = "connecting";
    const link: Link = this.opts.open({
      welcome: () => { if (this.link === link) this.onWelcome(); },
      message: (msg) => { if (this.link === link) this.onMessage(msg); },
      frame: (frame) => { if (this.link === link) this.onFrame(frame); },
      close: (close) => { if (this.link === link) this.onClose(close); },
    });
    this.link = link;
  }

  /** Closes the socket without telling anyone it was lost. */
  private stop(status: "idle" | "background"): void {
    clearTimeout(this.retryTimer);
    const link = this.link;
    this.link = null;
    this.status = status;
    this.watchRoutes.clear();
    this.reqRoutes.clear();
    link?.close();
  }

  private onWelcome(): void {
    this.status = "open";
    this.attempt = 0;
    this.stuck = 0;
    for (const tab of this.tabs) tab.linkUp();
  }

  private onClose(close: LinkClose): void {
    this.link = null;
    this.watchRoutes.clear();
    this.reqRoutes.clear();
    if (close.code === CloseCode.BadToken) this.opts.onRejected();
    const halt: Halt | undefined =
      close.code === CloseCode.BadToken ? "unauthorized" : close.code === CloseCode.Incompatible ? "incompatible" : undefined;
    if (halt) {
      this.status = "halted";
      this.notifyLost(null, halt);
      return;
    }
    if (close.cause === "connectTimeout") {
      // One new socket at once; if that sticks too, only a fresh web view helps.
      if (++this.stuck >= 2) {
        this.status = "halted";
        this.notifyLost(null);
        this.opts.onStuck();
        return;
      }
      this.status = "waiting";
      this.notifyLost(0);
      this.connect();
      return;
    }
    this.stuck = 0;
    const retryInMs = backoffMs(this.attempt++, (this.opts.random ?? Math.random)());
    this.status = "waiting";
    this.notifyLost(retryInMs);
    this.retryTimer = setTimeout(() => { this.connect(); }, retryInMs);
  }

  private notifyLost(retryInMs: number | null, halt?: Halt): void {
    for (const tab of this.tabs) tab.linkLost({ retryInMs, ...(halt && { halt }) });
  }

  private onFrame(frame: Frame): void {
    this.watchRoutes.get(frame.watch)?.frame(frame);
  }

  private onMessage(msg: ServerMsg): void {
    switch (msg.type) {
      case "watching":
        this.watchRoutes.get(msg.data.watch)?.message(msg);
        break;
      case "watchEnded": {
        const tab = this.watchRoutes.get(msg.data.watch);
        this.release(msg.data.watch);
        tab?.message(msg);
        break;
      }
      case "historyChunk": {
        const route = this.reqRoutes.get(msg.data.req);
        this.reqRoutes.delete(msg.data.req);
        route?.tab.message(msg);
        break;
      }
      case "error": {
        const { req, watch } = msg.data;
        const route = req === undefined ? undefined : this.reqRoutes.get(req);
        if (req !== undefined) this.reqRoutes.delete(req);
        const target = route?.tab ?? (watch === undefined ? undefined : this.watchRoutes.get(watch));
        if (target) target.message(msg);
        else if (req === undefined && watch === undefined) this.broadcast(msg);
        break;
      }
      case "sessions":
      case "created":
        this.reqRoutes.delete(msg.data.req);
        this.broadcast(msg);
        break;
      case "pong":
      case "welcome":
        break;
      default:
        this.broadcast(msg); // window and server events, listings: every tab decides
        break;
    }
  }

  private broadcast(msg: ServerMsg): void {
    for (const tab of [...this.tabs]) tab.message(msg);
  }

  private dropReqs(watch: number): void {
    for (const [req, route] of this.reqRoutes) if (route.watch === watch) this.reqRoutes.delete(req);
  }
}
