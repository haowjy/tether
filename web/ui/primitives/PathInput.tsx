import type { Ref, TargetedFocusEvent, TargetedKeyboardEvent } from "preact";
import { useCallback, useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { cx } from "../cx";
import { useFocusRef, type FocusTarget } from "../focus";
import styles from "./PathInput.module.css";

interface PathInputProps {
  /** The accessible name: the field has a placeholder, not a visible label. */
  label: string;
  value: string;
  /** The prediction's remaining letters, drawn after the typed text. */
  ghost: string;
  /** The new text, and the element, so the caller can read the caret. */
  onInput: (value: string, el: HTMLInputElement) => void;
  onFocus?: (e: TargetedFocusEvent<HTMLInputElement>) => void;
  onBlur?: (e: TargetedFocusEvent<HTMLInputElement>) => void;
  onKeyDown?: (e: TargetedKeyboardEvent<HTMLInputElement>) => void;
  inputRef?: Ref<HTMLInputElement>;
  placeholder?: string;
  /** The list this field completes into (when it has rows), and its highlighted row, for assistive technology. */
  listId?: string | undefined;
  activeId?: string | undefined;
  /** The name the app moves focus to this field by. */
  focusTarget?: FocusTarget;
  class?: string;
}

/**
 * A path typed with completion (Files' path field). The ordinary text keyboard, since the URL
 * keyboard has no space bar and folder names hold spaces, with a Go key, and no autocorrect,
 * capitals or spellcheck: a path is not prose. The ghost sits behind the input at the same
 * metrics, after an invisible copy of the text, so it lines up with the caret at the end; it
 * is shifted by the input's scroll, so it stays at the caret when the path is wider than the field.
 */
export function PathInput({ label, value, ghost, onInput, inputRef, listId, activeId, focusTarget, class: className, ...rest }: PathInputProps) {
  const registered = useFocusRef(focusTarget);
  const field = useRef<HTMLInputElement | null>(null);
  const track = useRef<HTMLSpanElement>(null);
  // The input scrolls to keep the caret in view (typing, a caret moved by touch); the ghost follows.
  const follow = useCallback(() => {
    if (track.current && field.current) track.current.style.transform = `translateX(${String(-field.current.scrollLeft)}px)`;
  }, []);
  useLayoutEffect(follow, [follow, value, ghost]);
  // Moving the caret scrolls the input without any event of ours; WebKit sends no `scroll` for it.
  useEffect(() => {
    document.addEventListener("selectionchange", follow);
    return () => { document.removeEventListener("selectionchange", follow); };
  }, [follow]);
  // Stable: a new ref callback each render would withdraw and register the field every time.
  const attach = useCallback(
    (el: HTMLInputElement | null) => {
      registered(el);
      field.current = el;
      if (typeof inputRef === "function") inputRef(el);
      else if (inputRef) inputRef.current = el;
    },
    [registered, inputRef],
  );
  return (
    <div class={cx(styles.field, className)}>
      <div class={styles.ghost} aria-hidden="true">
        <div class={styles.clip}>
          <span ref={track} class={styles.track}><span class={styles.typed}>{value}</span>{ghost}</span>
        </div>
      </div>
      <input
        type="text"
        inputmode="text"
        enterkeyhint="go"
        autocapitalize="off"
        autocomplete="off"
        autocorrect="off"
        spellcheck={false}
        aria-autocomplete="both"
        aria-controls={listId}
        aria-activedescendant={activeId}
        {...rest}
        value={value}
        onInput={(e) => { onInput(e.currentTarget.value, e.currentTarget); }}
        aria-label={label}
        class={styles.input}
        onScroll={follow}
        ref={attach}
      />
    </div>
  );
}
