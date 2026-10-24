import type { Frame } from "../proto/frames";
import type { LinkClose, LinkHandlers, WelcomeMsg } from "../proto/link";
import type { ClientMsg, ErrorCode, ServerMsg } from "../proto/generated/messages";
import { CloseCode } from "../proto/generated/messages";
import { backoffMs, type Halt } from "../tabs/connection";

/** How long a request waits for a socket to send it on. */
const SEND_TIMEOUT_MS = 5_000;
/**
 * How long a sent request waits for its reply. The daemon may already be acting on it (a
 * create), so giving up early on a slow link only invites a duplicate; a dead socket is the
 * link's to find (25 s silent) and fails the request as `lost`. This is the backstop for a
 * socket that is alive but a daemon that never answers.
 */
const REPLY_TIMEOUT_MS = 30_000;

/** Why a request got no answer: the daemon's refusal, the socket closing or halting, or no reply in time. */
export class RequestError extends Error {
  constructor(message: string, readonly reason: ErrorCode | Exclude<Halt, "detached"> | "lost" | "timeout" | "background") {
    super(message);
  }
}

interface Pending {
  msg: ClientMsg;
  /** Puts `msg` on the link, and from then on waits for the reply rather than for a socket. */
  transmit(link: Link): void;
  /** True when `reply` settled the request; an answer of the wrong kind is ignored. */
  answer(reply: ServerMsg): boolean;
  fail(error: RequestError): void;
}

/** The request id a daemon message answers, if it answers one. */
function replyTo(msg: ServerMsg): number | undefined {
  switch (msg.type) {
    case "sessions":
    case "created":
    case "historyChunk":
    case "error":
      return msg.data.req;
    default:
      return undefined;
  }
}

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
  /** The answer to a paste this tab sent, or a socket loss before its answer. */
  pasteResult?(result: PasteResult): void;
  frame(frame: Frame): void;
}

export type PasteResult = Extract<ServerMsg, { type: "pasted" | "error" }> | { type: "pasteLost"; req: number };

export interface HostOptions {
  /** Opens a socket; called again after every loss. */
  open(handlers: LinkHandlers): Link;
  /** The daemon closed with 4401 (not enrolled) or 4503 (cannot decide now): admission re-reads why. */
  onRefused(code: typeof CloseCode.BadToken | typeof CloseCode.AuthUnavailable): void;
  /** The socket is welcomed: the daemon's identity, for admission to check against its saved id. */
  onWelcome?(welcome: WelcomeMsg): void;
  /** The daemon refused the socket for its connection cap (4005), or accepted one again: a host problem, not a tab's. */
  onCapped?(capped: boolean): void;
  /** Two sockets in a row stuck in CONNECTING: reload the web view. */
  onStuck(): void;
  random?: () => number;
}

type Status = "idle" | "connecting" | "open" | "waiting" | "halted" | "background";

/**
 * One host's WebSocket, shared by all its tabs (plan.md "Reconnect"). It owns the link's
 * life (backoff, 4401, the connect timeout, the background) and routes what arrives to
 * the tab that owns the watch. Requests (`request`) are answered by id; an open request
 * keeps the socket up as a tab does. Ids are host-wide because they share one socket.
 */
export class Host {
  private readonly opts: HostOptions;
  private readonly tabs = new Set<TabPort>();
  private readonly watchRoutes = new Map<number, TabPort>();
  private readonly pending = new Map<number, Pending>();
  private readonly pastes = new Map<number, TabPort>();
  private status: Status = "idle";
  private capped = false;
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

  /** Request ids share one namespace across this host's tabs and non-tab requests. */
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
    for (const [req, owner] of this.pastes) if (owner === tab) this.pastes.delete(req);
    this.closeIfUnused();
  }

  /** Sends for `tab`, remembering which tab owns the watch it names. */
  send(tab: TabPort, msg: ClientMsg): void {
    if (msg.type === "watch") this.watchRoutes.set(msg.data.watch, tab);
    else if (msg.type === "unwatch") this.watchRoutes.delete(msg.data.watch);
    else if (msg.type === "paste") this.pastes.set(msg.data.req, tab);
    this.link?.send(msg);
  }

  /**
   * Sends `build(req)` once the socket is up and resolves with `match` of its answer. It
   * rejects on the daemon's `error`, when no socket takes it in 5 s or no reply follows in
   * 30 s, and when the socket closes or the app goes to the background: nothing is sent
   * twice. A halted host is tried again.
   */
  request<T>(build: (req: number) => ClientMsg, match: (reply: ServerMsg) => T | undefined): Promise<T> {
    return new Promise((resolve, reject) => {
      if (this.status === "background") {
        reject(new RequestError("app in background", "background"));
        return;
      }
      const req = this.nextReq();
      const expireIn = (ms: number): ReturnType<typeof setTimeout> => setTimeout(() => {
        this.pending.delete(req);
        reject(new RequestError("timed out", "timeout"));
        this.closeIfUnused();
      }, ms);
      let timer = expireIn(SEND_TIMEOUT_MS);
      const pending: Pending = {
        msg: build(req),
        transmit: (link) => {
          clearTimeout(timer);
          timer = expireIn(REPLY_TIMEOUT_MS);
          link.send(pending.msg);
        },
        answer: (reply) => {
          if (reply.type === "error") {
            reject(new RequestError(reply.data.message, reply.data.code));
          } else {
            const value = match(reply);
            if (value === undefined) return false;
            resolve(value);
          }
          clearTimeout(timer);
          return true;
        },
        fail: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
      this.pending.set(req, pending);
      if (this.ready && this.link) pending.transmit(this.link);
      else if (this.status === "idle" || this.status === "halted") {
        this.attempt = 0;
        this.connect();
      }
    });
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
    this.stop("background");
    this.failPastes();
    this.failAll(new RequestError("app in background", "background"));
    for (const tab of this.tabs) tab.paused();
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
      welcome: (welcome) => { if (this.link === link) this.onWelcome(welcome); },
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
    this.setCapped(false); // nothing is trying, so nothing is refused
    link?.close();
  }

  private setCapped(capped: boolean): void {
    if (this.capped === capped) return;
    this.capped = capped;
    this.opts.onCapped?.(capped);
  }

  /** No tab and no request needs the socket: nothing is held for a host nobody views. */
  private closeIfUnused(): void {
    if (this.tabs.size === 0 && this.pending.size === 0 && this.status !== "background" && this.status !== "idle") this.stop("idle");
  }

  private failAll(error: RequestError): void {
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const p of pending) p.fail(error);
  }

  private onWelcome(welcome: WelcomeMsg): void {
    this.opts.onWelcome?.(welcome);
    this.setCapped(false);
    this.status = "open";
    this.attempt = 0;
    this.stuck = 0;
    if (this.link) for (const p of this.pending.values()) p.transmit(this.link);
    for (const tab of this.tabs) tab.linkUp();
  }

  private onClose(close: LinkClose): void {
    this.link = null;
    this.watchRoutes.clear();
    this.setCapped(close.code === CloseCode.OverCap);
    if (close.code === CloseCode.BadToken || close.code === CloseCode.AuthUnavailable) this.opts.onRefused(close.code);
    const halt =
      close.code === CloseCode.BadToken ? "unauthorized" : close.code === CloseCode.Incompatible ? "incompatible" : undefined;
    this.failPastes();
    this.failAll(new RequestError(halt ? `host halted: ${halt}` : "connection lost", halt ?? "lost"));
    if (this.tabs.size === 0) {
      this.stop("idle");
      return;
    }
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
    if (msg.type === "pasted") {
      const tab = this.pastes.get(msg.data.req);
      if (!tab) return;
      this.pastes.delete(msg.data.req);
      tab.pasteResult?.(msg);
      return;
    }
    if (msg.type === "error" && msg.data.req !== undefined) {
      const tab = this.pastes.get(msg.data.req);
      if (tab) {
        this.pastes.delete(msg.data.req);
        tab.pasteResult?.(msg);
        return;
      }
    }
    const req = replyTo(msg);
    if (req !== undefined) {
      if (this.pending.get(req)?.answer(msg)) {
        this.pending.delete(req);
        this.closeIfUnused();
      }
      return;
    }
    switch (msg.type) {
      case "watching":
        this.watchRoutes.get(msg.data.watch)?.message(msg);
        break;
      case "watchEnded": {
        const tab = this.watchRoutes.get(msg.data.watch);
        this.watchRoutes.delete(msg.data.watch);
        tab?.message(msg);
        break;
      }
      case "error": // one naming no request (a refused input) has nobody waiting on it
      case "pong":
      case "welcome":
        break;
      default:
        this.broadcast(msg); // window and server events, listings: every tab decides
        break;
    }
  }

  private failPastes(): void {
    for (const [req, tab] of this.pastes) tab.pasteResult?.({ type: "pasteLost", req });
    this.pastes.clear();
  }

  private broadcast(msg: ServerMsg): void {
    for (const tab of [...this.tabs]) tab.message(msg);
  }
}
