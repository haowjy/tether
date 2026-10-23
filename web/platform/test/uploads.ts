// Uploads a spec drives event by event: the test platform's `uploads.pick` follows this
// script, so Files shows exactly the progress, path or error the spec pushes.
import type { UploadEvent } from "../types";

/** An upload stream a spec drives: `push` an event, `end` the pick. */
export class UploadScript {
  picks = 0;
  private buffered: UploadEvent[] = [];
  private waiting: ((r: IteratorResult<UploadEvent>) => void) | null = null;
  private ended = false;

  pick(): AsyncIterable<UploadEvent> {
    this.picks++;
    this.buffered = [];
    this.ended = false;
    return {
      [Symbol.asyncIterator]: () => ({
        next: () => {
          const event = this.buffered.shift();
          if (event) return Promise.resolve({ done: false, value: event });
          if (this.ended) return Promise.resolve({ done: true, value: undefined });
          return new Promise((resolve) => { this.waiting = resolve; });
        },
      }),
    };
  }

  push(event: UploadEvent): void {
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve({ done: false, value: event });
    } else {
      this.buffered.push(event);
    }
  }

  end(): void {
    this.ended = true;
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve({ done: true, value: undefined });
    }
  }
}
