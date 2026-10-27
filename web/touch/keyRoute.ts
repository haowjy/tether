// Where a key-row key goes (terminal-interaction-design.md "The dock", the routing table). One
// pure rule for both line editors: the browser's textarea and the app's native field take the same
// decision. The key row also reads it to show which keys act on the box. No Preact, no window.
import type { Owner } from "../app/focus";
import type { InputEvent } from "../platform/types";
import { apply, type Armed } from "./modifiers";

/** A key-row key that is not a modifier: a named tmux key, or a character. */
export type RowKey = { name: string } | { text: string };

export type Route =
  /** Input for the terminal; the armed modifier applies to it as to any touch input. */
  | { to: "terminal"; events: InputEvent[] }
  /** The box's caret moves one character. */
  | { to: "caret"; step: -1 | 1 }
  /** Typing returns from the box to the terminal; the keyboard stays up. */
  | { to: "focusTerminal" }
  /** A character goes into the box at its caret. */
  | { to: "line"; text: string };

export function routeKey(key: RowKey, owner: Owner, armed: Armed): Route {
  if ("text" in key) {
    const events: InputEvent[] = [{ text: key.text }];
    // An armed modifier makes a chord for tmux, wherever typing goes; a character with no chord is typed unmodified.
    if (owner !== "line" || apply(armed, events).events !== events) return { to: "terminal", events };
    return { to: "line", text: key.text };
  }
  // Only an unmodified key acts on the box: armed, ← is the chord for tmux.
  if (owner === "line" && armed === null) {
    if (key.name === "Left") return { to: "caret", step: -1 };
    if (key.name === "Right") return { to: "caret", step: 1 };
    if (key.name === "Escape") return { to: "focusTerminal" };
  }
  return { to: "terminal", events: [{ key: key.name }] };
}
