// Uploads in the browser (client-architecture.md §5.7): a hidden file input for `pick`, and
// the page's one upload queue for both `pick` and `send`. This file holds the raw <input>
// that lint rule 1 allows here.
//
// The daemon takes one upload at a time (fs.md "Constants"), so the page sends one file at a
// time and holds at most four, the one in flight included. A fifth is refused.
import type { UploadEvent, Uploads } from "../types";

export const QUEUE_LIMIT = 4;
export const QUEUE_FULL = "Wait for the current uploads to finish";

/** The daemon's per-file limit (fs.md "Constants"): a larger file is refused before a byte is sent. */
const MAX_BYTES = 128 * 1024 * 1024;

/** `busy` means another upload holds the daemon's slot; a couple of retries ride out a short one. */
const BUSY_RETRIES = 3;

const REFUSALS: Record<string, string> = {
  too_large: "That file is over the 128 MiB limit",
  busy: "The server is busy. Try again in a moment",
  no_space: "The server is out of disk space",
  not_a_directory: "The uploads folder isn't usable. Check uploads_dir in config.toml",
  memory_backed: "The uploads folder is on memory-backed storage",
  outside_roots: "The uploads folder is outside your folders",
};

/** A stream that events are pushed into and a consumer iterates; ends when told to. */
class Channel implements AsyncIterable<UploadEvent> {
  private readonly buffered: UploadEvent[] = [];
  private waiting: ((r: IteratorResult<UploadEvent>) => void) | null = null;
  private ended = false;

  push(event: UploadEvent): void {
    if (this.ended) return;
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

  [Symbol.asyncIterator](): AsyncIterator<UploadEvent> {
    return {
      next: () => {
        const event = this.buffered.shift();
        if (event) return Promise.resolve({ done: false, value: event });
        if (this.ended) return Promise.resolve({ done: true, value: undefined });
        return new Promise((resolve) => { this.waiting = resolve; });
      },
    };
  }
}

interface Job {
  id: string;
  file: File;
  channel: Channel;
  /** Set while the request is in flight. */
  abort: (() => void) | null;
  /** The pick or paste this file belongs to, which ends when its last file does. */
  group: Group;
}

interface Group {
  channel: Channel;
  open: number;
}

export function createBrowserUploads(): Uploads {
  /** Queued and in flight, in order; the head is in flight. */
  const jobs: Job[] = [];
  let counter = 0;

  const finish = (job: Job, event: UploadEvent): void => {
    job.channel.push(event);
    jobs.splice(jobs.indexOf(job), 1);
    if (--job.group.open === 0) job.group.channel.end();
    pump();
  };

  const attempt = (job: Job, retries: number): void => {
    const xhr = new XMLHttpRequest();
    job.abort = () => { xhr.abort(); };
    xhr.open("POST", `/fs/upload?name=${encodeURIComponent(job.file.name)}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) job.channel.push({ id: job.id, progress: e.total === 0 ? 1 : e.loaded / e.total });
    };
    xhr.onload = () => {
      const body = parse(xhr.responseText);
      if (xhr.status === 201 && typeof body["path"] === "string") {
        finish(job, { id: job.id, path: body["path"] });
      } else if (xhr.status === 503 && body["error"] === "busy" && retries > 0) {
        setTimeout(() => { if (jobs.includes(job)) attempt(job, retries - 1); }, 1000);
      } else {
        const code = typeof body["error"] === "string" ? body["error"] : `http_${String(xhr.status)}`;
        finish(job, { id: job.id, error: REFUSALS[code] ?? `Upload failed (${code})` });
      }
    };
    xhr.onerror = () => { finish(job, { id: job.id, error: "Couldn't reach the server" }); };
    xhr.onabort = () => {
      if (jobs.includes(job)) finish(job, { id: job.id, error: "Upload cancelled" });
    };
    xhr.send(job.file);
  };

  const pump = (): void => {
    const head = jobs[0];
    if (head && !head.abort) attempt(head, BUSY_RETRIES);
  };

  /** Queues `files` into `group`; a file past the limit is refused at once. */
  const enqueue = (files: File[], group: Group): void => {
    for (const file of files) {
      const id = `u${String(++counter)}`;
      group.open++;
      if (file.size > MAX_BYTES || jobs.length >= QUEUE_LIMIT) {
        group.channel.push({ id, error: file.size > MAX_BYTES ? (REFUSALS["too_large"] ?? "") : QUEUE_FULL });
        if (--group.open === 0) group.channel.end();
        continue;
      }
      jobs.push({ id, file, channel: group.channel, abort: null, group });
      group.channel.push({ id, progress: 0 });
    }
    pump();
  };

  /** The group's files stop when its consumer gives up. */
  const cancelOn = (signal: AbortSignal, group: Group): void => {
    signal.addEventListener("abort", () => {
      for (const job of [...jobs]) {
        if (job.group !== group) continue;
        job.abort?.();
        // A request in flight finishes the job from its abort event; a queued one, or one waiting to retry, does not.
        if (jobs.includes(job)) finish(job, { id: job.id, error: "Upload cancelled" });
      }
      group.channel.end();
    }, { once: true });
  };

  let input: HTMLInputElement | null = null;
  /** A picker opened and not yet answered: a new pick supersedes it. */
  let awaiting: { group: Group; stop(): void } | null = null;

  return {
    pick(_handle, signal) {
      const group: Group = { channel: new Channel(), open: 0 };
      // The superseded pick's listeners come off the shared input too, or its files would upload twice.
      awaiting?.stop();
      awaiting?.group.channel.end();
      input ??= Object.assign(document.createElement("input"), { type: "file", multiple: true, hidden: true });
      if (!input.isConnected) document.body.append(input);
      const el = input;
      el.value = "";
      const stop = (): void => {
        if (awaiting?.group === group) awaiting = null;
        el.removeEventListener("change", onChange);
        el.removeEventListener("cancel", onCancel);
      };
      const onChange = (): void => {
        stop();
        const files = [...(el.files ?? [])];
        if (files.length === 0) group.channel.end();
        else enqueue(files, group);
      };
      const onCancel = (): void => {
        stop();
        group.channel.end();
      };
      awaiting = { group, stop };
      el.addEventListener("change", onChange);
      el.addEventListener("cancel", onCancel);
      signal.addEventListener("abort", stop, { once: true });
      cancelOn(signal, group);
      // Inside the tap: the browser opens the picker only for a user gesture.
      el.click();
      return group.channel;
    },

    send(_handle, file, signal) {
      const group: Group = { channel: new Channel(), open: 0 };
      cancelOn(signal, group);
      enqueue([file], group);
      return group.channel;
    },
  };
}

function parse(text: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
