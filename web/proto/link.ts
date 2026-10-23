import { decodeFrame, type Frame } from "./frames";
import { CloseCode, PROTOCOL_VERSION, type ClientMsg, type ServerMsg } from "./generated/messages";

/** Timings, daemon-core.md §6 and plan.md "Reconnect". */
const PING_INTERVAL_MS = 10_000;
const IDLE_TIMEOUT_MS = 25_000; // same threshold the daemon applies to us
const CONNECT_TIMEOUT_MS = 5_000; // iOS 26 can leave a new socket in CONNECTING

export type WelcomeMsg = Extract<ServerMsg, { type: "welcome" }>["data"];

export interface LinkClose {
  code: number;
  /** `false` for 4001 (incompatible) and 4401 (bad token): retrying cannot help. */
  retry: boolean;
  /** Set when the client gave up itself rather than the daemon closing. */
  cause?: "connectTimeout" | "idle" | "protocol";
}

export interface LinkHandlers {
  welcome(welcome: WelcomeMsg): void;
  message(msg: ServerMsg): void;
  frame(frame: Frame): void;
  /** Once, whatever the cause; the link is then dead and a reconnect makes a new one. */
  close(close: LinkClose): void;
}

export interface LinkOptions {
  /** `ws(s)://host/ws` */
  url: string;
  /** Native's device token; the browser holds none and offers `tether.v1` alone. */
  token?: string;
  build: string;
  kind: "ios" | "web";
  /** Injectable for tests. */
  createSocket?: (url: string, protocols: string[]) => WebSocket;
}

/**
 * One WebSocket to one host: handshake, binary frames, JSON control, heartbeat. A link is
 * single-use; reconnecting means a new link, decided by the tab state machine.
 */
export class HostLink {
  private readonly ws: WebSocket;
  private readonly handlers: LinkHandlers;
  private welcomed = false;
  private closed = false;
  private lastRecv = Date.now();
  private connectTimer: ReturnType<typeof setTimeout> | undefined;
  private pingTimer: ReturnType<typeof setInterval> | undefined;

  constructor(opts: LinkOptions, handlers: LinkHandlers) {
    this.handlers = handlers;
    const create = opts.createSocket ?? ((u, p) => new WebSocket(u, p));
    this.ws = create(opts.url, opts.token ? ["tether.v1", `tether.auth.${opts.token}`] : ["tether.v1"]);
    this.ws.binaryType = "arraybuffer";
    this.ws.onopen = () => {
      this.send({
        type: "hello",
        data: { protocol: PROTOCOL_VERSION, client: { kind: opts.kind, build: opts.build } },
      });
    };
    this.ws.onmessage = (ev: MessageEvent<unknown>) => { this.receive(ev.data); };
    this.ws.onclose = (ev) => {
      this.finish({ code: ev.code, retry: ev.code !== CloseCode.Incompatible && ev.code !== CloseCode.BadToken });
    };
    // onerror is always followed by onclose; nothing to add.
    this.connectTimer = setTimeout(() => { this.giveUp("connectTimeout"); }, CONNECT_TIMEOUT_MS);
  }

  /** Dropped silently before `welcome`: only `hello` is accepted until then. */
  send(msg: ClientMsg): void {
    if (this.closed || this.ws.readyState !== WebSocket.OPEN) return;
    if (!this.welcomed && msg.type !== "hello") return;
    this.ws.send(JSON.stringify(msg));
  }

  get ready(): boolean {
    return this.welcomed && !this.closed;
  }

  close(): void {
    if (this.closed) return;
    this.ws.close(1000);
    this.finish({ code: 1000, retry: false });
  }

  private receive(data: unknown): void {
    this.lastRecv = Date.now();
    try {
      if (typeof data === "string") {
        const msg = JSON.parse(data) as ServerMsg;
        if (msg.type === "welcome") {
          this.welcomed = true;
          clearTimeout(this.connectTimer);
          this.pingTimer = setInterval(() => { this.heartbeat(); }, PING_INTERVAL_MS);
          this.handlers.welcome(msg.data);
        } else if (this.welcomed) {
          this.handlers.message(msg); // unknown types are the caller's to ignore and log
        } else if (msg.type !== "incompatible") {
          throw new Error(`${msg.type} before welcome`);
        } else {
          this.handlers.message(msg); // the 4001 close follows
        }
      } else if (data instanceof ArrayBuffer) {
        if (!this.welcomed) throw new Error("frame before welcome");
        this.handlers.frame(decodeFrame(data));
      }
    } catch {
      this.giveUp("protocol");
    }
  }

  private heartbeat(): void {
    if (Date.now() - this.lastRecv > IDLE_TIMEOUT_MS) {
      this.giveUp("idle");
      return;
    }
    this.send({ type: "ping", data: { t: Date.now() } });
  }

  private giveUp(cause: NonNullable<LinkClose["cause"]>): void {
    if (this.closed) return;
    this.ws.close(cause === "protocol" ? 4003 : 1000);
    this.finish({ code: cause === "protocol" ? 4003 : 1006, retry: true, cause });
  }

  private finish(close: LinkClose): void {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.connectTimer);
    clearInterval(this.pingTimer);
    this.ws.onopen = this.ws.onmessage = this.ws.onclose = null;
    this.handlers.close(close);
  }
}
