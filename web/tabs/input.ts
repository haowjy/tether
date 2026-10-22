import type { ClientMsg, InputItem } from "../proto/generated/messages";

/** Native → web input, ios-shell.md "How input reaches the terminal". */
export type InputEvent = { text: string } | { key: string } | { bytes: string } | { paste: string };

/** The daemon refuses an `input` message over this many bytes (daemon-core.md §6). */
const MAX_INPUT_BYTES = 4 * 1024;

const encoder = new TextEncoder();

function base64Length(b64: string): number {
  return Math.floor((b64.replace(/=+$/, "").length * 3) / 4);
}

/** Cuts `text` into pieces of at most `limit` UTF-8 bytes, never inside a code point. */
function splitText(text: string, limit: number): string[] {
  const pieces: string[] = [];
  let piece = "";
  let size = 0;
  for (const ch of text) {
    const n = encoder.encode(ch).length;
    if (size + n > limit) {
      pieces.push(piece);
      piece = "";
      size = 0;
    }
    piece += ch;
    size += n;
  }
  if (piece) pieces.push(piece);
  return pieces;
}

/**
 * Events in order become `input` messages, each under the limit, with a `paste` message
 * wherever a paste event stands. Events that are not text are never reordered around it.
 */
export function toMessages(watch: number, events: InputEvent[]): ClientMsg[] {
  const out: ClientMsg[] = [];
  let items: InputItem[] = [];
  let size = 0;
  const flush = (): void => {
    if (items.length) out.push({ type: "input", data: { watch, items } });
    items = [];
    size = 0;
  };
  const add = (item: InputItem, n: number): void => {
    if (size + n > MAX_INPUT_BYTES) flush();
    items.push(item);
    size += n;
  };
  for (const event of events) {
    if ("paste" in event) {
      flush();
      out.push({ type: "paste", data: { watch, text: event.paste } });
    } else if ("text" in event) {
      for (const piece of splitText(event.text, MAX_INPUT_BYTES)) add({ text: piece }, encoder.encode(piece).length);
    } else if ("key" in event) {
      add({ key: event.key }, encoder.encode(event.key).length);
    } else {
      add({ bytes: event.bytes }, base64Length(event.bytes));
    }
  }
  flush();
  return out;
}

/** A path as one shell word: bare when it needs no quoting, else single-quoted. */
export function shellQuote(path: string): string {
  return /^[\w@%+=:,./-]+$/.test(path) ? path : `'${path.replaceAll("'", "'\\''")}'`;
}
