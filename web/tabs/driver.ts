import type { ClientMsg, ServerMsg, Size, WindowRef } from "../proto/generated/messages";
import type { Frame } from "../proto/frames";
import type { Host, TabPort } from "../net/host";
import type { TerminalRenderer } from "../term";
import { initialState, reduce, type ConnectionEvent, type ConnectionState } from "./connection";
import type { InputEvent } from "../native/bridge";
import { shellQuote, toMessages } from "./input";
import { sameWindow } from "../proto/window";

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
  private readonly pendingInserts: string[] = [];

  /** What the host calls; the tab's public methods are for the UI. */
  private readonly port: TabPort = {
    linkUp: () => {
      this.dispatch({ type: "linkUp" });
      this.watchIfReady();
    },
    linkLost: ({ retryInMs, halt }) => {
      this.watchId = null;
      this.dispatch({ type: "linkLost", retryInMs, ...(halt && { halt }) });
    },
    paused: () => {
      this.watchId = null;
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
    this.watchId = null;
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
   * row. A chunk may hold fewer rows than asked, so this follows its true start; an empty
   * chunk can advance to tmux's top before the range ends. Rejects when the watch goes away.
   */
  async history(start: number, end: number): Promise<Uint8Array[]> {
    const watch = this.watchId;
    const rows: Uint8Array[] = [];
    for (let next = start; next <= end; ) {
      if (!this.bound || watch === null || this.watchId !== watch) throw new Error("watch ended");
      const from = next;
      const chunk = await this.opts.host.request(
        (req) => ({ type: "history", data: { req, watch, start: from, end } }),
        (reply) => (reply.type === "historyChunk" && reply.data.watch === watch ? reply.data : undefined),
      );
      if (chunk.lines.length === 0) {
        if (chunk.start <= from) break;
        next = chunk.start;
        continue;
      }
      rows.push(...chunk.lines.map(decodeBase64));
      const after = chunk.start + chunk.lines.length;
      // tmux can move a request up to the oldest retained row; follow it, but never retry
      // a chunk that made no progress.
      if (after <= from) break;
      next = after;
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
        this.watchId = null;
        // With the socket down, the host is the one retrying; this timer is for a failed watch.
        if (next.retryInMs !== null && this.opts.host.ready) this.retryTimer = setTimeout(() => { this.dispatch({ type: "retry" }); }, next.retryInMs);
        break;
      case "closed":
        this.watchId = null;
        this.opts.host.leave(this.port);
        for (const path of this.pendingInserts.splice(0)) this.dropInsert(path);
        break;
      case "live":
        break;
    }
  }

  private watchIfReady(): void {
    if (this.state.kind !== "connecting" || !this.opts.host.ready || this.covered || this.watchId !== null) return;
    this.watchId = this.opts.host.nextWatch();
    this.send({ type: "watch", data: { watch: this.watchId, window: this.opts.window, size: this.opts.size() } });
  }

  private onMessage(msg: ServerMsg): void {
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
        this.watchId = null;
        this.dispatch({ type: "watchEnded", reason: msg.data.reason, jitter: this.jitter() });
        break;
      case "windowClosed":
        if (sameWindow(msg.data.window, this.opts.window)) this.dispatch({ type: "windowClosed" });
        break;
      case "serverExited":
        if (msg.data.server === this.opts.window.server) this.dispatch({ type: "serverExited" });
        break;
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
