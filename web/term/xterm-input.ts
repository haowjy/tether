import type { Terminal } from "@xterm/xterm";
import type { InputEvent } from "../platform/types";
import { decideKey } from "../tabs/keymap";

/** Where desktop keystrokes go: the tab key active when the event arrived. */
export interface InputSink {
  input(events: InputEvent[]): void;
  /** Ctrl+Shift+C: the selection's logical text is already known to the caller. */
  copy(): void;
  /** Ctrl+Shift+F: the keyboard user leaves the terminal. */
  leave(): void;
}

/**
 * The desktop direct-input source (client-architecture.md §7.2): xterm's own textarea, which
 * already handles layouts, dead keys, Option on macOS and IME composition, under a strict
 * key-handler contract.
 *
 * - During composition the handler does nothing, so the IME keeps its arrows, Enter and Escape.
 * - A routed key (arrows, navigation, F-keys, Escape, Tab) goes by tmux name: `keydown` is
 *   cancelled, which suppresses `keypress` and `input`, and the handler returns false for
 *   that key's `keypress` and `keyup` as well. tmux then encodes it for the pane's real modes,
 *   which xterm may have rebuilt incompletely after a snapshot.
 * - Cmd combinations and F5, F6, F11, F12 stay the browser's; xterm never sees them.
 * - Everything else reaches xterm, and its `onData` and `onBinary` become `text` and `bytes`.
 *
 * Returns the function that points the source at a sink, or at none (stdin off).
 */
export function createDesktopInput(term: Terminal): (sink: InputSink | null) => void {
  let current: InputSink | null = null;

  term.attachCustomKeyEventHandler((event) => {
    const sink = current;
    if (!sink) return false;
    const decision = decideKey(event, "xterm");
    switch (decision.kind) {
      case "composing":
      case "default":
        return true;
      case "browser":
        return false;
      case "key":
      case "bytes":
      case "copy":
      case "leave":
        if (event.type === "keydown") {
          event.preventDefault();
          if (decision.kind === "key") sink.input([{ key: decision.name }]);
          else if (decision.kind === "bytes") sink.input([{ bytes: decision.bytes }]);
          else if (decision.kind === "copy") sink.copy();
          else sink.leave();
        }
        return false;
    }
  });
  term.onData((data) => { current?.input([{ text: data }]); });
  // Mouse reports past column 223 arrive as a binary string: one byte per character.
  term.onBinary((data) => { current?.input([{ bytes: btoa(data) }]); });

  return (sink) => {
    current = sink;
    term.options.disableStdin = sink === null;
    const helper = term.textarea;
    if (helper) {
      helper.tabIndex = sink ? 0 : -1;
      helper.inert = sink === null;
    }
  };
}
