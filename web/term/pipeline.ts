/** The slice of a terminal emulator the pipeline drives (xterm.js and @xterm/headless both fit). */
export interface Engine {
  write(data: Uint8Array | string, callback?: () => void): void;
  reset(): void;
  resize(cols: number, rows: number): void;
}

export interface Snapshot {
  cols: number;
  rows: number;
  restore: Uint8Array;
}

type Op =
  | { kind: "output"; bytes: Uint8Array }
  | { kind: "snapshot"; snapshot: Snapshot; done: () => void };

/**
 * One serialized write pipeline per terminal (daemon-core.md §5.4).
 *
 * `Engine.write` is asynchronous: bytes sit in the emulator's queue until parsed. A
 * snapshot's `reset()` would not clear them, so they would parse into the restored
 * screen and could switch on a mode (insert, say) the restore never switches off. With
 * queued insert mode, a naive reset/resize/restore/write leaves `XABC` instead of
 * `XBC`. A snapshot runs only once every earlier write's callback has fired, and
 * everything after it waits behind it.
 */
export class WritePipeline {
  private readonly engine: Engine;
  private readonly queue: Op[] = [];
  private inflight = 0;

  constructor(engine: Engine) {
    this.engine = engine;
  }

  output(bytes: Uint8Array): void {
    this.queue.push({ kind: "output", bytes });
    this.pump();
  }

  /** Resolves once the restore bytes have been parsed. */
  snapshot(snapshot: Snapshot): Promise<void> {
    return new Promise((done) => {
      this.queue.push({ kind: "snapshot", snapshot, done });
      this.pump();
    });
  }

  private pump(): void {
    for (let op = this.queue[0]; op; op = this.queue[0]) {
      if (op.kind === "snapshot" && this.inflight > 0) return; // a write callback re-enters
      this.queue.shift();
      if (op.kind === "output") {
        this.write(op.bytes);
      } else {
        const { cols, rows, restore } = op.snapshot;
        this.engine.reset();
        this.engine.resize(cols, rows);
        this.write(restore, op.done);
      }
    }
  }

  private write(bytes: Uint8Array, after?: () => void): void {
    this.inflight++;
    this.engine.write(bytes, () => {
      this.inflight--;
      after?.();
      this.pump();
    });
  }
}
