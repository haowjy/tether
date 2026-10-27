import type { ClientMsg, ServerMsg, SessionRef, ShownWindow, Size } from "../proto/generated/messages";
import type { Frame } from "../proto/frames";
import type { Host, PasteResult, TabPort } from "../net/host";
import type { TerminalRenderer } from "../term";
import { acceptsInsert, initialState, reduce, type ConnectionEvent, type ConnectionState } from "./connection";
import type { InputEvent } from "../platform/types";
import { cannotInsert, shellQuote, toMessages } from "./input";

/** What became of a path: typed now, waiting for the watch, or refused (the tab can't take it, and nothing was kept). */
export type InsertResult = "typed" | "queued" | "refused";

/** One physical row of scrollback as `capture-pane -e` printed it. */
export interface HistoryRow {
  bytes: Uint8Array;
  /** The next row continues this one: a soft wrap. */
  continues: boolean;
}

type Watching = Extract<ServerMsg, { type: "watching" }>["data"];

/** The wait before the band says the window is sized for another terminal, at least: a claim's resize is on its way over until then. */
const BAND_MIN_WAIT_MS = 1000;
/** Added to the last ping round trip when that is the longer wait. */
const BAND_RTT_MARGIN_MS = 500;

export interface TabOptions {
  session: SessionRef;
  renderer: Pick<TerminalRenderer, "output" | "snapshot">;
  /** The host's shared socket. */
  host: Host;
  /** The terminal's size right now, in cells. */
  size(): Size;
  /** Start without a watch, for a tab that is not on screen. */
  covered?: boolean;
  onState(state: ConnectionState): void;
  /**
   * The window's size has differed from the size this tab sent for longer than the wait, larger or
   * smaller (another terminal holds the window), or stopped differing. Called only on a change.
   */
  onSizedForOther?(sizedForOther: boolean): void;
  /** Bound, and again whenever the shown window, its name or size, the pane or the cwd changes. */
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
  /** The session's current window as the last `watching` said; it outlives a watch, as the content on screen does. */
  private shown: ShownWindow | null = null;
  /** The pane of the last `watching`: a history chunk from any other pane is dropped. */
  private pane: number | null = null;
  private sizedForOther = false;
  private bandTimer: ReturnType<typeof setTimeout> | undefined;
  /**
   * The user brought the tab on screen and no watch has bound since, so the next `watch` claims
   * the window. Any other watch is the client's own doing and claims only a window the tab held.
   */
  private claimNext = true;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  /** A path waits with the window it was meant for, null until the tab knows one. */
  private readonly pendingInserts: { path: string; window: number | null }[] = [];

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
      // Backgrounded: returning to the app is the user bringing the tab forward.
      this.claimNext = true;
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
    this.claimNext = true;
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

  /** The Fit tap: sends the size again, which claims the window for this tab. */
  fit(): void {
    if (!this.bound) return;
    this.claiming();
    this.sendSize(this.opts.size(), true);
  }

  /** The window the tab shows now, null until its first `watching`. A caller that batches input captures this when the keys are typed. */
  get windowId(): number | null {
    return this.shown?.id ?? null;
  }

  /** Input goes only to a bound watch, to `window` (default: the one shown now); otherwise it is dropped and `false` returned. */
  input(events: InputEvent[], window = this.windowId): boolean {
    if (!this.bound || this.watchId === null || window === null) return false;
    this.claiming();
    this.sendAll(toMessages(this.watchId, window, events, () => this.opts.host.nextReq()));
    return true;
  }

  /** Sends one paste for a live watch and returns its `req`, which its answer names; null when the tab isn't live. Enter, when requested, stays in the same tmux group. */
  paste(text: string, enter = false, window = this.windowId): number | null {
    if (!this.bound || this.watchId === null || window === null) return null;
    this.claiming();
    const req = this.opts.host.nextReq();
    this.send({ type: "paste", data: { req, watch: this.watchId, window, text, ...(enter ? { enter: true } : {}) } });
    return req;
  }

  /**
   * Types the path, quoted and without Enter, into `window` (default: the one shown now): now if
   * bound, else at the next `watching`. A path still waiting when the tab loses its connection or
   * closes is dropped with a notice; one refused here is the caller's to report.
   */
  insertPath(path: string, window = this.windowId): InsertResult {
    if (!acceptsInsert(this.state)) return "refused";
    this.pendingInserts.push({ path, window });
    this.flushInserts();
    return this.pendingInserts.length === 0 ? "typed" : "queued";
  }

  /** Makes `window` the session's current window; the tab follows with the `watching` that answers. False when the tab isn't live. A refusal arrives as `onNotice`. */
  selectWindow(window: number): boolean {
    if (!this.bound || this.watchId === null) return false;
    this.claiming();
    this.send({ type: "selectWindow", data: { req: this.opts.host.nextReq(), watch: this.watchId, window } });
    return true;
  }

  /**
   * Scrollback rows `start..=end` (tmux line numbers, negative is history), one entry per
   * physical row, in order, each saying whether the next row continues it (a soft wrap). A
   * chunk may hold fewer rows than asked, so this follows its true start; an empty chunk can
   * advance to tmux's top before the range ends, and fewer rows than the range means the top
   * was reached. A gap or a change of tmux's history size breaks the continuation. Rejects
   * when the watch goes away.
   */
  async history(start: number, end: number): Promise<HistoryRow[]> {
    const watch = this.watchId;
    // One pane for the whole call: the watch outlives a window change, and chunks of two panes must not join.
    const pane = this.pane;
    const rows: HistoryRow[] = [];
    let historySize: number | undefined;
    for (let next = start; next <= end; ) {
      if (!this.bound || watch === null || this.watchId !== watch) throw new Error("watch ended");
      const from = next;
      const chunk = await this.opts.host.request(
        (req) => ({ type: "history", data: { req, watch, start: from, end } }),
        (reply) => (reply.type === "historyChunk" && reply.data.watch === watch ? reply.data : undefined),
      );
      // The tab followed its session to another window's pane while the rows were on their way: they sit above the wrong screen.
      if (chunk.pane !== pane || this.pane !== pane) throw new Error("pane changed");
      let broken = chunk.start !== from;
      if (chunk.historySize !== undefined) {
        broken ||= historySize !== undefined && chunk.historySize !== historySize;
        historySize = chunk.historySize;
      }
      const last = rows[rows.length - 1];
      if (broken && last) last.continues = false;
      const wraps = decodeBase64(chunk.wraps);
      chunk.lines.forEach((line, index) => {
        rows.push({ bytes: decodeBase64(line), continues: ((wraps[index >> 3] ?? 0) & (1 << (index & 7))) !== 0 });
      });
      const after = chunk.start + chunk.lines.length;
      // tmux can move a request up to the oldest retained row. Follow that true
      // position, including an empty range above the top, but never retry no progress.
      if (after <= from) break;
      next = after;
    }
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
        this.stopBandWait();
        this.dropInserts("the tab lost its connection");
        // With the socket down, the host is the one retrying; this timer is for a failed watch.
        if (next.retryInMs !== null && this.opts.host.ready) this.retryTimer = setTimeout(() => { this.dispatch({ type: "retry" }); }, next.retryInMs);
        break;
      case "limited":
        this.watchId = null;
        this.stopBandWait();
        this.dropInserts("the tab couldn't connect");
        this.retryTimer = setTimeout(() => { this.dispatch({ type: "retry" }); }, next.retryInMs);
        break;
      case "closed":
        // Every way a tab ends comes through here: the daemon must hear it, or the watch and its tmux client leak.
        if (this.watchId !== null) this.send({ type: "unwatch", data: { watch: this.watchId } });
        this.watchId = null;
        this.stopBandWait();
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
    // Without `claim: false` the daemon sizes the window to this tab, so a reconnect would take it from the laptop.
    // A re-watch claims only a window whose size, as the last `watching` reported it, is still the one this tab sent.
    // Decided before the new size is recorded. Before any `watching` the tab has held nothing, but `claimNext` is set then.
    const claim = this.claimNext || this.holdsWindow();
    if (claim) this.claiming();
    const size = this.opts.size();
    this.sentSize = size;
    this.send({ type: "watch", data: { watch: this.watchId, session: this.opts.session, size, ...(claim ? {} : { claim: false }) } });
  }

  private onMessage(msg: ServerMsg): void {
    switch (msg.type) {
      case "incompatible":
        break; // the 4001 close follows and carries the halt
      case "watching":
        if (msg.data.watch !== this.watchId) break;
        this.claimNext = false;
        this.shown = msg.data.window;
        this.pane = msg.data.pane;
        this.dispatch({ type: "bound" });
        // The terminal may have changed size while the watch was in flight.
        this.sendSize(this.opts.size());
        this.checkBand(false);
        this.opts.onWatching?.(msg.data);
        this.flushInserts();
        break;
      case "watchEnded":
        if (msg.data.watch !== this.watchId) break;
        this.watchId = null;
        this.dispatch({ type: "watchEnded", reason: msg.data.reason, ...(msg.data.message !== undefined && { message: msg.data.message }), jitter: this.jitter() });
        break;
      case "sessionClosed":
        if (msg.data.session.server === this.opts.session.server && msg.data.session.session === this.opts.session.session) this.dispatch({ type: "sessionClosed" });
        break;
      case "serverExited":
        if (msg.data.server === this.opts.session.server) this.dispatch({ type: "serverExited" });
        break;
      case "error":
        this.opts.onNotice(`Not sent: ${msg.data.message}`);
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
    for (const { path, window } of this.pendingInserts.splice(0)) {
      const target = window ?? this.windowId;
      if (target === null) continue;
      this.claiming();
      this.sendAll(toMessages(this.watchId, target, [{ text: shellQuote(path) }], () => this.opts.host.nextReq()));
    }
  }

  private sendSize(size: Size, force = false): void {
    if (this.watchId === null || (!force && this.sentSize?.cols === size.cols && this.sentSize.rows === size.rows)) return;
    this.sentSize = size;
    this.claiming();
    this.send({ type: "resize", data: { watch: this.watchId, size } });
  }

  /** The window's size, as the last `watching` said, is the size this tab sent: nobody has taken it since. */
  private holdsWindow(): boolean {
    const { shown, sentSize } = this;
    return shown !== null && sentSize !== null && shown.size.cols === sentSize.cols && shown.size.rows === sentSize.rows;
  }

  /** A claim is going out: the band restarts, so only a `watching` that arrives after the wait can raise it. */
  private claiming(): void {
    this.checkBand(true);
  }

  /**
   * Whether the window's size has differed from the size this tab sent for longer than the wait
   * (daemon-core.md §3.6): either direction. `restart` is a claiming send, which clears the band
   * and starts the wait afresh; otherwise a running wait is left alone and a match ends everything.
   */
  private checkBand(restart: boolean): void {
    const differs = this.shown !== null && this.sentSize !== null && !this.holdsWindow();
    if (!differs) {
      this.stopBandWait();
      this.setSizedForOther(false);
      return;
    }
    if (restart) {
      this.stopBandWait();
      this.setSizedForOther(false);
    }
    if (this.sizedForOther || this.bandTimer !== undefined) return;
    const wait = Math.max(BAND_MIN_WAIT_MS, this.opts.host.rtt + BAND_RTT_MARGIN_MS);
    this.bandTimer = setTimeout(() => {
      this.bandTimer = undefined;
      this.setSizedForOther(true);
    }, wait);
  }

  /** Without a live watch no wait runs; the next `watching` starts one if the sizes still differ. */
  private stopBandWait(): void {
    clearTimeout(this.bandTimer);
    this.bandTimer = undefined;
  }

  private setSizedForOther(sizedForOther: boolean): void {
    if (sizedForOther === this.sizedForOther) return;
    this.sizedForOther = sizedForOther;
    this.opts.onSizedForOther?.(sizedForOther);
  }

  private dropInserts(why: string): void {
    for (const { path } of this.pendingInserts.splice(0)) this.opts.onNotice(cannotInsert(path, why));
  }

  private jitter(): number {
    return (this.opts.random ?? Math.random)();
  }
}
