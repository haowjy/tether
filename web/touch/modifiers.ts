// Armed ctrl and alt (client-architecture.md §7.4): a pure rule for what an armed modifier does
// to the next thing typed from any touch source (the owned input, the line field, the key row).
// Events in; the events to send and the new armed state out. No Preact, no window, no document.
import type { InputEvent } from "../platform/types";

export type Armed = "ctrl" | "alt" | null;

/** Tapping an armed key disarms it; tapping the other switches to it. */
export function toggle(armed: Armed, key: "ctrl" | "alt"): Armed {
  return armed === key ? null : key;
}

/** Keys tmux names that take a C- or M- prefix (the daemon's allowlist, `is_key_name`). */
const PREFIXABLE = /^(?:Enter|Escape|Tab|BSpace|Space|Up|Down|Left|Right|Home|End|PageUp|PageDown|IC|DC)$/;

function chordName(armed: "ctrl" | "alt", text: string): string | null {
  const prefix = armed === "ctrl" ? "C-" : "M-";
  if (text === " ") return `${prefix}Space`;
  if (!/^[A-Za-z0-9]$/.test(text)) return null;
  // Ctrl+Shift+A is Ctrl+A to a terminal; Alt keeps the case.
  return prefix + (armed === "ctrl" ? text.toLowerCase() : text);
}

/**
 * Applies `armed` to `events`, the next input from a touch source. A single character or a
 * named key becomes its chord; anything else (a multi-character insert, a paste, bytes)
 * just disarms. `events` is returned as is when nothing changed, so a caller can tell.
 */
export function apply(armed: Armed, events: InputEvent[]): { events: InputEvent[]; armed: Armed } {
  const first = events[0];
  if (armed === null || first === undefined) return { events, armed };
  let name: string | null = null;
  if ("text" in first) name = chordName(armed, first.text);
  else if ("key" in first && PREFIXABLE.test(first.key)) name = `${armed === "ctrl" ? "C-" : "M-"}${first.key}`;
  return { events: name === null ? events : [{ key: name }, ...events.slice(1)], armed: null };
}
