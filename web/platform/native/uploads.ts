// Native's picker and uploader run outside the page. The page names each upload with an id
// it chooses (`pickMedia`, `readPasteboard`), and every `upload` event carries that id back,
// so a stream is just the events with its id. A pick's stream ends with the upload, or with
// native's `cancelled` event when the user dismisses the picker.
import type { UploadEvent, Uploads } from "../types";
import type { Bridge, UploadMsg } from "./bridge";

export interface NativeUploads extends Uploads {
  receive(msg: UploadMsg): void;
  follow(id: string, signal: AbortSignal): AsyncIterable<UploadEvent>;
}

interface Stream {
  push(event: UploadEvent): void;
  end(): void;
}

function toEvent(msg: UploadMsg): UploadEvent | null {
  if (msg.cancelled) return null;
  if (msg.error !== undefined) return { id: msg.id, error: msg.error };
  if (msg.path !== undefined) return { id: msg.id, path: msg.path };
  return { id: msg.id, progress: msg.progress };
}

export function createNativeUploads(bridge: Bridge): NativeUploads {
  const streams = new Map<string, Stream>();

  const open = (id: string, signal: AbortSignal): AsyncIterable<UploadEvent> => {
    const queue: UploadEvent[] = [];
    let wake: (() => void) | null = null;
    let ended = false;
    const stream: Stream = {
      push: (event) => { queue.push(event); wake?.(); },
      end: () => {
        ended = true;
        if (streams.get(id) === stream) streams.delete(id);
        wake?.();
      },
    };
    streams.set(id, stream);
    signal.addEventListener("abort", () => { stream.end(); }, { once: true });
    return {
      async *[Symbol.asyncIterator]() {
        for (;;) {
          const next = queue.shift();
          if (next) yield next;
          else if (ended) return;
          else await new Promise<void>((resolve) => { wake = resolve; });
        }
      },
    };
  };

  return {
    pick(handle, signal) {
      const id = crypto.randomUUID();
      const events = open(id, signal);
      bridge.pickMedia(id, handle); // synchronously, inside the tap
      return events;
    },
    follow: open,
    receive(msg) {
      const stream = streams.get(msg.id);
      if (!stream) return;
      const event = toEvent(msg);
      if (event) stream.push(event);
      if (msg.cancelled || msg.path !== undefined || msg.error !== undefined) stream.end();
    },
  };
}
