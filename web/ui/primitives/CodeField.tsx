import { useId, useRef, useState } from "preact/hooks";
import { cx } from "../cx";
import { useFocusRef, type FocusTarget } from "../focus";
import styles from "./CodeField.module.css";

const LENGTH = 8;
const GROUP = 4;

/** What the field keeps of typed or pasted text: letters and digits, uppercased. The dash in `7KQ4-XM2P` is drawn, never part of the value. */
const clean = (text: string): string => text.replace(/[^A-Za-z0-9]/g, "").toUpperCase();

interface CodeFieldProps {
  label: string;
  /** Up to eight characters, no separator. */
  value: string;
  onInput: (value: string) => void;
  focusTarget?: FocusTarget;
  class?: string | undefined;
}

/**
 * An eight-cell code, `▢▢▢▢ – ▢▢▢▢`. One real input sits transparent over drawn cells, so
 * typing, paste, selection, dictation and autofill are the platform's own and a screen reader
 * meets one field named by `label`. The cells show the value and the caret's place; the input
 * keeps only `[A-Z0-9]` and eight of them, and puts the caret back after the characters it
 * kept when it drops a dash or a space from the middle of an edit.
 */
export function CodeField({ label, value, onInput, focusTarget, class: className }: CodeFieldProps) {
  const id = useId();
  const focusRef = useFocusRef(focusTarget);
  const input = useRef<HTMLInputElement | null>(null);
  const cells = useRef<HTMLDivElement | null>(null);
  const [focused, setFocused] = useState(false);
  const [caret, setCaret] = useState(0);

  const sync = (el: HTMLInputElement): void => { setCaret(Math.min(el.selectionStart ?? 0, LENGTH - 1)); };

  return (
    <div class={cx(styles.field, className)}>
      <label for={id} class={styles.label}>{label}</label>
      <div
        class={styles.cells}
        ref={cells}
        // A tap lands on the nearest cell, or on the first empty one past the end of the text.
        onPointerUp={(e) => {
          const el = input.current;
          if (!el || !cells.current) return;
          const boxes = [...cells.current.querySelectorAll<HTMLElement>("[data-cell]")];
          let nearest = 0;
          let best = Infinity;
          boxes.forEach((box, i) => {
            const r = box.getBoundingClientRect();
            const d = Math.abs(e.clientX - (r.left + r.width / 2));
            if (d < best) { best = d; nearest = i; }
          });
          const at = Math.min(nearest, value.length);
          el.setSelectionRange(at, at);
          sync(el);
        }}
      >
        {Array.from({ length: LENGTH }, (_, i) => (
          <>
            {i === GROUP && <span class={styles.dash} aria-hidden="true" />}
            <span
              data-cell
              aria-hidden="true"
              class={cx(styles.cell, focused && i === caret && styles.active)}
            >{value[i] ?? ""}</span>
          </>
        ))}
        <input
          id={id}
          type="text"
          inputMode="text"
          autocapitalize="characters"
          autocomplete="off"
          autocorrect="off"
          spellcheck={false}
          enterkeyhint="next"
          class={styles.input}
          value={value}
          onInput={(e) => {
            const el = e.currentTarget;
            const next = clean(el.value).slice(0, LENGTH);
            // Characters kept before the caret decide where it goes in the cleaned text.
            const at = Math.min(clean(el.value.slice(0, el.selectionStart ?? el.value.length)).length, next.length);
            el.value = next;
            el.setSelectionRange(at, at);
            onInput(next);
            sync(el);
          }}
          onFocus={(e) => { setFocused(true); sync(e.currentTarget); }}
          onBlur={() => { setFocused(false); }}
          onKeyUp={(e) => { sync(e.currentTarget); }}
          onSelect={(e) => { sync(e.currentTarget); }}
          ref={(el) => { input.current = el; focusRef(el); }}
        />
      </div>
    </div>
  );
}
