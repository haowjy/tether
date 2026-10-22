import type { ClientMsg, ServerMsg, Size, WindowRef } from "../proto/generated/messages";
import type { Frame } from "../proto/frames";
import type { Host, TabPort } from "../net/host";
import type { TerminalRenderer } from "../term";
import { initialState, reduce, type ConnectionEvent, type ConnectionState } from "./connection";
import type { InputEvent } from "../native/bridge";
import { shellQuote, toMessages } from "./input";

type Watching = Extract<ServerMsg, { type: "watching" }>["data"];

export interface TabOptions {
  window: WindowRef;
  renderer: Pick<TerminalRenderer, "output" | "snapshot">;
  /** The host's shared socket. */
  host: Host;
  /** The terminal's size right now, in cells. */
  size(): Size;
  /** Start without a watch, for a tab that is not on screen. */
  covered?: boolean;
  onState(state: ConnectionState): void;
  /** Bound, and again whenever the daemon reports a new session, pane or cwd. */
  onWatching?(watching: Watching): void;
  /** A message for the user, such as an upload that could not be inserted. */
  onNotice(text: string): void;
  random?: () => number;
}

interface PendingHistory {
  watch: number;
  resolve(rows: Uint8Array[]): void;
  reject(error: Error): void;
}

function decodeBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/**
 * One tab, end to end (daemon-core.md §5): its watch on the host's shared socket, the
 * connection reducer and the terminal pipeline. At most one `watch` is outstanding; each
 * gets a fresh host-wide id, so frames from an earlier watch are dropped on arrival.
 */
export class TabDriver {
  private readonly opts: TabOptions;
  private state: ConnectionState = initialState;
  private covered = false;
  private watchId: number | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly histories = new Map<number, PendingHistory>();
  private readonly pendingInserts: string[] = [];

  /** What the host calls; the tab's public methods are for the UI. */
  private readonly port: TabPort = {
    linkUp: () => {
      this.dispatch({ type: "linkUp" });
      this.watchIfReady();
    },
    linkLost: ({ retryInMs, halt }) => {
      this.unbind();
      this.dispatch({ type: "linkLost", retryInMs, ...(halt && { halt }) });
    },
    paused: () => {
      this.unbind();
      this.dispatch({ type: "rewatch" });
    },
    message: (msg) => { this.onMessage(msg); },
    frame: (frame) => { this.onFrame(frame); },
  };

  constructor(opts: TabOptions) {
    this.opts = opts;
    this.covered = opts.covered ?? false;
    opts.onState(this.state);
    opts.host.join(this.port);
    this.watchIfReady();
  }

  /** A native screen covers the terminal: stop watching, keep the socket. */
  cover(): void {
    if (this.covered) return;
    this.covered = true;
    if (this.watchId !== null) this.send({ type: "unwatch", data: { watch: this.watchId } });
    this.unbind();
  }

  /** The terminal is back: watch again and take a fresh snapshot. */
  uncover(): void {
    if (!this.covered) return;
    this.covered = false;
    this.dispatch({ type: "rewatch" });
    this.watchIfReady();
  }

  /** Visible, online, or the pill was tapped. */
  nudge(): void {
    this.dispatch({ type: "nudge" });
    this.opts.host.nudge();
  }

  /** Rotation or font change only. */
  resize(size: Size): void {
    if (this.bound) this.send({ type: "resize", data: { watch: this.watchId ?? 0, size } });
  }

  /** Input goes only to a bound watch; otherwise it is dropped and `false` returned. */
  input(events: InputEvent[]): boolean {
    if (!this.bound || this.watchId === null) return false;
    this.sendAll(toMessages(this.watchId, events));
    return true;
  }

  /** Types the path, quoted and without Enter: now if bound, else at the next `watching`. */
  insertPath(path: string): void {
    if (this.state.kind === "closed") {
      this.dropInsert(path);
      return;
    }
    this.pendingInserts.push(path);
    this.flushInserts();
  }

  /**
   * Scrollback rows `start..=end` (tmux line numbers, negative is history), one entry per
   * row. A chunk may hold fewer rows than asked, so this asks again from where it ended;
   * an empty chunk ends the range. Rejects when the watch goes away.
   */
  async history(start: number, end: number): Promise<Uint8Array[]> {
    const watch = this.watchId;
    const rows: Uint8Array[] = [];
    for (let next = start; next <= end; ) {
      if (!this.bound || watch === null || this.watchId !== watch) throw new Error("watch ended");
      const chunk = await this.requestChunk(watch, next, end);
      if (chunk.length === 0) break;
      rows.push(...chunk);
      next += chunk.length;
    }
    return rows;
  }

  /** The host's listing no longer has this tab's window. */
  windowGone(): void {
    this.dispatch({ type: "windowClosed" });
  }

  /** The user closed the tab. */
  close(): void {
    this.dispatch({ type: "userClosed" });
  }

  private get bound(): boolean {
    return this.state.kind === "live" && this.watchId !== null;
  }

  private requestChunk(watch: number, start: number, end: number): Promise<Uint8Array[]> {
    const req = this.opts.host.nextReq();
    return new Promise((resolve, reject) => {
      this.histories.set(req, { watch, resolve, reject });
      this.send({ type: "history", data: { req, watch, start, end } });
    });
  }

  private sendAll(msgs: ClientMsg[]): void {
    for (const msg of msgs) this.send(msg);
  }

  private send(msg: ClientMsg): void {
    this.opts.host.send(this.port, msg);
  }

  private dispatch(event: ConnectionEvent): void {
    const next = reduce(this.state, event);
    if (next === this.state) return;
    this.state = next;
    clearTimeout(this.retryTimer);
    this.opts.onState(next);
    switch (next.kind) {
      case "connecting":
        this.watchIfReady();
        break;
      case "reconnecting":
        this.unbind();
        // With the socket down, the host is the one retrying; this timer is for a failed watch.
        if (next.retryInMs !== null && this.opts.host.ready) this.retryTimer = setTimeout(() => { this.dispatch({ type: "retry" }); }, next.retryInMs);
        break;
      case "closed":
        this.unbind();
        this.opts.host.leave(this.port);
        for (const path of this.pendingInserts.splice(0)) this.dropInsert(path);
        break;
      case "live":
        break;
    }
  }

  /** Forget the current watch and fail what waits on it. */
  private unbind(): void {
    this.watchId = null;
    for (const h of this.histories.values()) h.reject(new Error("watch ended"));
    this.histories.clear();
  }

  private watchIfReady(): void {
    if (this.state.kind !== "connecting" || !this.opts.host.ready || this.covered || this.watchId !== null) return;
    this.watchId = this.opts.host.nextWatch();
    this.send({ type: "watch", data: { watch: this.watchId, window: this.opts.window, size: this.opts.size() } });
  }

  private onMessage(msg: ServerMsg): void {
    const same = (w: WindowRef): boolean => w.server === this.opts.window.server && w.window === this.opts.window.window;
    switch (msg.type) {
      case "incompatible":
        break; // the 4001 close follows and carries the halt
      case "watching":
        if (msg.data.watch !== this.watchId) break;
        this.dispatch({ type: "bound" });
        this.opts.onWatching?.(msg.data);
        this.flushInserts();
        break;
      case "watchEnded":
        if (msg.data.watch !== this.watchId) break;
        this.unbind();
        this.dispatch({ type: "watchEnded", reason: msg.data.reason, jitter: this.jitter() });
        break;
      case "windowClosed":
        if (same(msg.data.window)) this.dispatch({ type: "windowClosed" });
        break;
      case "serverExited":
        if (msg.data.server === this.opts.window.server) this.dispatch({ type: "serverExited" });
        break;
      case "historyChunk": {
        const pending = this.histories.get(msg.data.req);
        if (!pending || pending.watch !== msg.data.watch) break;
        this.histories.delete(msg.data.req);
        pending.resolve(msg.data.lines.map(decodeBase64));
        break;
      }
      case "error": {
        const pending = msg.data.req === undefined ? undefined : this.histories.get(msg.data.req);
        if (msg.data.req !== undefined && pending) {
          this.histories.delete(msg.data.req);
          pending.reject(new Error(`${msg.data.code}: ${msg.data.message}`));
        }
        break;
      }
      default:
        break; // sessions, renames and the rest belong to other screens
    }
  }

  private onFrame(frame: Frame): void {
    if (frame.watch !== this.watchId) return;
    if (frame.kind === "output") this.opts.renderer.output(frame.bytes);
    else void this.opts.renderer.snapshot(frame);
  }

  private flushInserts(): void {
    if (!this.bound || this.watchId === null) return;
    for (const path of this.pendingInserts.splice(0)) {
      this.sendAll(toMessages(this.watchId, [{ text: shellQuote(path) }]));
    }
  }

  private dropInsert(path: string): void {
    this.opts.onNotice(`Could not insert ${path.split("/").pop() ?? path}: the tab closed.`);
  }

  private jitter(): number {
    return (this.opts.random ?? Math.random)();
  }
}
