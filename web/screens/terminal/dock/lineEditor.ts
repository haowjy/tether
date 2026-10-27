// What the compose box does for keys routed to it (`routeKey`'s "line" and "caret"). The editor that
// holds the text and caret decides how: the app's native field takes UIKit's positions (marked text
// included); the browser's textarea steps by grapheme.
import type { Platform } from "../../../platform/types";
import { stepGrapheme } from "./caret";

export interface LineEditor {
  /** Insert a character at the caret. */
  insert: (text: string) => void;
  /** Move the caret one character. */
  step: (step: -1 | 1) => void;
}

export function nativeLineEditor(platform: Platform): LineEditor {
  return {
    insert: (text) => { platform.input.insertLine(text); },
    step: (step) => { platform.input.stepLineCaret(step); },
  };
}

/** The browser's editor over `field`; `composing` is the IME flag the textarea's events keep. */
export function browserLineEditor(field: { current: HTMLTextAreaElement | null }, composing: { current: boolean }): LineEditor {
  return {
    insert: (text) => {
      const el = field.current;
      if (!el) return;
      el.setRangeText(text, el.selectionStart, el.selectionEnd, "end");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    step: (step) => {
      const el = field.current;
      // Moving the selection mid-composition commits or garbles it: the keyboard's until it commits, as in native.
      if (!el || composing.current) return;
      const { selectionStart: start, selectionEnd: end, value } = el;
      const to = start !== end ? (step < 0 ? start : end) : stepGrapheme(value, start, step);
      el.setSelectionRange(to, to);
    },
  };
}
