import type { ClientMsg, ServerMsg, Size, WindowRef } from "../proto/generated/messages";
import type { Frame } from "../proto/frames";
import type { Host, PasteResult, TabPort } from "../net/host";
import type { TerminalRenderer } from "../term";
import { acceptsInsert, initialState, reduce, type ConnectionEvent, type ConnectionState } from "./connection";
import type { InputEvent } from "../platform/types";
import { cannotInsert, shellQuote, toMessages } from "./input";
import { sameWindow } from "../proto/window";

/** What became of a path: typed now, waiting for the watch, or refused (the tab can't take it, and nothing was kept). */
export type InsertResult = "typed" | "queued" | "refused";

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
  /** Paste replies are not retried; their result is shown by the terminal owner. */
  onPasteResult?(result: PasteResult): void;
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
  /** The size the daemon last heard for the current watch (in `watch`, or a `resize`). */
  private sentSize: Size | null = null;
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
    pasteResult: (result) => { this.opts.onPasteResult?.(result); },
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

  /** Rotation or font change only. A resize that finds the watch in flight is sent when it binds. */
  resize(size: Size): void {
    if (this.bound) this.sendSize(size);
  }

  /** Input goes only to a bound watch; otherwise it is dropped and `false` returned. */
  input(events: InputEvent[]): boolean {
    if (!this.bound || this.watchId === null) return false;
    this.sendAll(toMessages(this.watchId, events, () => this.opts.host.nextReq()));
    return true;
  }

  /** Sends one paste for a live watch; Enter, when requested, stays in the same tmux group. */
  paste(text: string, enter = false): boolean {
    if (!this.bound || this.watchId === null) return false;
    this.send({
      type: "paste",
      data: { req: this.opts.host.nextReq(), watch: this.watchId, text, ...(enter ? { enter: true } : {}) },
    });
    return true;
  }

  /**
   * Types the path, quoted and without Enter: now if bound, else at the next `watching`.
   * A path still waiting when the tab loses its connection or closes is dropped with a
   * notice; one refused here is the caller's to report.
   */
  insertPath(path: string): InsertResult {
    if (!acceptsInsert(this.state)) return "refused";
    this.pendingInserts.push(path);
    this.flushInserts();
    return this.pendingInserts.length === 0 ? "typed" : "queued";
  }

  /**
   * Scrollback rows `start..=end` (tmux line numbers, negative is history), one entry per
   * logical line. Wrapped physical rows are joined for copy. A chunk may hold fewer rows
   * than asked, so this follows its true start; an empty chunk can advance to tmux's top
   * before the range ends. Rejects when the watch goes away.
   */
  async history(start: number, end: number): Promise<Uint8Array[]> {
    const watch = this.watchId;
    const rows: Uint8Array[] = [];
    let parts: Uint8Array[] = [];
    let length = 0;
    let continues = false;
    let historySize: number | undefined;
    const finishLine = (): void => {
      if (parts.length === 0) return;
      const line = new Uint8Array(length);
      let offset = 0;
      for (const part of parts) {
        line.set(part, offset);
        offset += part.length;
      }
      rows.push(line);
      parts = [];
      length = 0;
    };
    for (let next = start; next <= end; ) {
      if (!this.bound || watch === null || this.watchId !== watch) throw new Error("watch ended");
      const from = next;
      const chunk = await this.opts.host.request(
        (req) => ({ type: "history", data: { req, watch, start: from, end } }),
        (reply) => (reply.type === "historyChunk" && reply.data.watch === watch ? reply.data : undefined),
      );
      if (chunk.historySize !== undefined) {
        if (historySize !== undefined && chunk.historySize !== historySize) {
          finishLine();
          continues = false;
        }
        historySize = chunk.historySize;
      }
      const lines = chunk.lines.map(decodeBase64);
      if (lines.length === 0) {
        if (chunk.start > from) {
          finishLine();
          continues = false;
        }
      } else {
        if (chunk.start !== from) {
          finishLine();
          continues = false;
        }
        const wraps = decodeBase64(chunk.wraps);
        lines.forEach((line, index) => {
          if (parts.length > 0 && !continues) finishLine();
          parts.push(line);
          length += line.length;
          continues = ((wraps[index >> 3] ?? 0) & (1 << (index & 7))) !== 0;
        });
      }
      const after = chunk.start + chunk.lines.length;
      // tmux can move a request up to the oldest retained row. Follow that true
      // position, including an empty range above the top, but never retry no progress.
      if (after <= from) break;
      next = after;
    }
    finishLine();
    return rows;
  }

  /** The user closed the tab. This ends its watch on the daemon, which caps watches per connection. */
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
        this.dropInserts("the tab lost its connection");
        // With the socket down, the host is the one retrying; this timer is for a failed watch.
        if (next.retryInMs !== null && this.opts.host.ready) this.retryTimer = setTimeout(() => { this.dispatch({ type: "retry" }); }, next.retryInMs);
        break;
      case "limited":
        this.watchId = null;
        this.dropInserts("the tab couldn't connect");
        this.retryTimer = setTimeout(() => { this.dispatch({ type: "retry" }); }, next.retryInMs);
        break;
      case "closed":
        // Every way a tab ends comes through here: the daemon must hear it, or the watch and its tmux client leak.
        if (this.watchId !== null) this.send({ type: "unwatch", data: { watch: this.watchId } });
        this.watchId = null;
        this.opts.host.leave(this.port);
        this.dropInserts("the tab closed");
        break;
      case "live":
        break;
    }
  }

  private watchIfReady(): void {
    if (this.state.kind !== "connecting" || !this.opts.host.ready || this.covered || this.watchId !== null) return;
    this.watchId = this.opts.host.nextWatch();
    this.sentSize = this.opts.size();
    this.send({ type: "watch", data: { watch: this.watchId, window: this.opts.window, size: this.sentSize } });
  }

  private onMessage(msg: ServerMsg): void {
    switch (msg.type) {
      case "incompatible":
        break; // the 4001 close follows and carries the halt
      case "watching":
        if (msg.data.watch !== this.watchId) break;
        this.dispatch({ type: "bound" });
        // The terminal may have changed size while the watch was in flight.
        this.sendSize(this.opts.size());
        this.opts.onWatching?.(msg.data);
        this.flushInserts();
        break;
      case "watchEnded":
        if (msg.data.watch !== this.watchId) break;
        this.watchId = null;
        this.dispatch({ type: "watchEnded", reason: msg.data.reason, ...(msg.data.message !== undefined && { message: msg.data.message }), jitter: this.jitter() });
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
      this.sendAll(toMessages(this.watchId, [{ text: shellQuote(path) }], () => this.opts.host.nextReq()));
    }
  }

  private sendSize(size: Size): void {
    if (this.watchId === null || (this.sentSize?.cols === size.cols && this.sentSize.rows === size.rows)) return;
    this.sentSize = size;
    this.send({ type: "resize", data: { watch: this.watchId, size } });
  }

  private dropInserts(why: string): void {
    for (const path of this.pendingInserts.splice(0)) this.opts.onNotice(cannotInsert(path, why));
  }

  private jitter(): number {
    return (this.opts.random ?? Math.random)();
  }
}
