// Where a key-row key goes (terminal-interaction-design.md "The dock", the routing table). One
// pure rule for both line editors: the browser's textarea and the app's native field take the same
// decision. The key row also reads it to show which keys act on the box. No Preact, no window.
import type { Owner } from "../app/focus";
import type { InputEvent } from "../platform/types";
import { apply, type Armed } from "./modifiers";

/** A key-row key that is not a modifier: a named tmux key, or a character. */
export type RowKey = { name: string } | { text: string };

export type Route =
  /** Input for the terminal, the armed modifier already applied. */
  | { to: "terminal"; events: InputEvent[] }
  /** The box's caret moves one character. */
  | { to: "caret"; step: -1 | 1 }
  /** Typing returns from the box to the terminal; the keyboard stays up. */
  | { to: "focusTerminal" }
  /** A character goes into the box at its caret. */
  | { to: "line"; text: string };

/** Who types: the key row and the native text path exist only while one of these holds the keyboard. */
export type KeyOwner = Exclude<Owner, "none">;

/**
 * The route for `key` and the armed state after it. A route is decided and the modifier it uses up
 * is committed together (`ArmedModifiers.route`), so a caller cannot route and forget to disarm.
 */
export function routeKey(key: RowKey, owner: KeyOwner, armed: Armed): { route: Route; armed: Armed } {
  if ("text" in key) {
    const applied = apply(armed, [{ text: key.text }]);
    // An armed modifier makes a chord for tmux wherever typing goes; a character with no chord is typed unmodified, which still uses the modifier up.
    if (owner === "line" && applied.events[0] && "text" in applied.events[0]) return { route: { to: "line", text: key.text }, armed: applied.armed };
    return { route: { to: "terminal", events: applied.events }, armed: applied.armed };
  }
  // Only an unmodified key acts on the box: armed, ← is the chord for tmux.
  if (owner === "line" && armed === null) {
    if (key.name === "Left") return { route: { to: "caret", step: -1 }, armed };
    if (key.name === "Right") return { route: { to: "caret", step: 1 }, armed };
    if (key.name === "Escape") return { route: { to: "focusTerminal" }, armed };
  }
  const applied = apply(armed, [{ key: key.name }]);
  return { route: { to: "terminal", events: applied.events }, armed: applied.armed };
}
