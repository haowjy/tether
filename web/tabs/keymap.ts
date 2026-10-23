// KeyboardEvent to tmux key names (client-architecture.md §7.2, §7.3). Pure: the DOM
// handlers in term/xterm-input.ts and touch/owned-input.ts feed it plain facts, and it says
// what to do. Every name it can produce is in tests/fixtures/proto/keys.json, which the
// daemon's tests check against its allowlist regex (`is_key_name`).

/** The facts of a `KeyboardEvent` this decision reads. */
export interface KeyFacts {
  /** `keydown`, `keypress` or `keyup`: the same key is routed the same way on each. */
  type: string;
  key: string;
  /** The physical key (`KeyA`, `Digit1`), which names a letter even when Option or Alt changed `key`. */
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  isComposing: boolean;
  keyCode: number;
}

export type KeyDecision =
  /** An IME is composing: it keeps its arrows, Enter and Escape, so nothing is routed. */
  | { kind: "composing" }
  /** The browser's own: every Cmd combination, F5, F6, F11, F12, and Ctrl+Shift+V (paste). */
  | { kind: "browser" }
  /** Sent by tmux name; the event is cancelled. */
  | { kind: "key"; name: string }
  /** Sent as raw bytes (base64); the event is cancelled. Shift+Enter, which tmux 3.4 types as text. */
  | { kind: "bytes"; bytes: string }
  /** Ctrl+Shift+C: copy the selection. */
  | { kind: "copy" }
  /** Ctrl+Shift+F: leave the terminal for the tab strip. */
  | { kind: "leave" }
  /** Not routed here: xterm's own encoding in xterm mode, nothing in owned mode (the text arrives through `beforeinput`). */
  | { kind: "default" };

/** Which source is live: xterm's textarea, or tether's owned input on a phone. */
export type KeyMode = "xterm" | "owned";

const NAVIGATION: Record<string, string> = {
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  Insert: "IC",
  Delete: "DC",
};

/** F5, F6, F11 and F12 (reload, the address bar or next pane, full screen, devtools) stay the browser's. */
const FUNCTION = /^F(?:[1-4]|[7-9]|10)$/;
const BROWSER_FUNCTION = /^F(?:5|6|11|12)$/;
const SHIFT_ENTER_BYTES = btoa("\x1b[13;2u");

/** `C-`, `M-`, then `S-` where the daemon's allowlist takes it: before navigation and function keys only. */
function modified(e: KeyFacts, name: string, shiftable: boolean): string {
  return `${e.ctrlKey ? "C-" : ""}${e.altKey ? "M-" : ""}${shiftable && e.shiftKey ? "S-" : ""}${name}`;
}

/** The letter or digit a Ctrl or Alt chord means, from the physical key: Option on macOS changes `key`. */
function printable(e: KeyFacts): string | null {
  const letter = /^Key([A-Z])$/.exec(e.code)?.[1];
  if (letter) return e.shiftKey ? letter : letter.toLowerCase();
  const digit = /^Digit(\d)$/.exec(e.code)?.[1];
  if (digit) return digit;
  return /^[A-Za-z0-9]$/.test(e.key) ? e.key : null;
}

export function decideKey(e: KeyFacts, mode: KeyMode): KeyDecision {
  if (e.isComposing || e.keyCode === 229) return { kind: "composing" };
  // Cmd (and a Super key elsewhere) is never a terminal key: the browser's shortcuts keep their meaning.
  if (e.metaKey || BROWSER_FUNCTION.test(e.key)) return { kind: "browser" };
  if (e.ctrlKey && e.shiftKey && !e.altKey) {
    const key = printable(e)?.toLowerCase();
    if (key === "c") return { kind: "copy" };
    // No default Chrome, Firefox or Safari shortcut takes Ctrl+Shift+F on macOS, Linux or Windows, and a terminal cannot tell it from Ctrl+F.
    if (key === "f") return { kind: "leave" };
    if (key === "v") return { kind: "browser" };
  }
  const nav = NAVIGATION[e.key];
  if (nav) return { kind: "key", name: modified(e, nav, true) };
  if (FUNCTION.test(e.key)) return { kind: "key", name: modified(e, e.key, true) };
  if (e.key === "Escape") return { kind: "key", name: modified(e, "Escape", false) };
  if (e.key === "Tab") return { kind: "key", name: modified(e, e.shiftKey ? "BTab" : "Tab", false) };
  if (e.key === "Enter" && e.shiftKey && !e.ctrlKey && !e.altKey) return { kind: "bytes", bytes: SHIFT_ENTER_BYTES };
  if (mode === "owned") return decideOwned(e);
  return { kind: "default" };
}

/**
 * A hardware keyboard on a phone fires `keydown` and no `beforeinput` for Ctrl or Alt
 * chords, so those are named here: Ctrl+printable as `C-<key>` and Alt+printable as
 * `M-<key>`. Plain printable keys arrive once, through `beforeinput`.
 */
function decideOwned(e: KeyFacts): KeyDecision {
  if (!e.ctrlKey && !e.altKey) return { kind: "default" };
  switch (e.key) {
    case "Enter":
      return { kind: "key", name: modified(e, "Enter", false) };
    case "Backspace":
      return { kind: "key", name: modified(e, "BSpace", false) };
    case " ":
      return { kind: "key", name: modified(e, "Space", false) };
  }
  const key = printable(e);
  // Ctrl+Shift+A is Ctrl+A to a terminal, so the letter's case follows Shift only for Alt.
  return key ? { kind: "key", name: modified(e, e.ctrlKey ? key.toLowerCase() : key, false) } : { kind: "default" };
}
