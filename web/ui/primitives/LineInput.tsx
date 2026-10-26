import type { TargetedClipboardEvent, TargetedInputEvent, TargetedKeyboardEvent, TargetedEvent } from "preact";
import type { Ref } from "preact";
import { useCallback } from "preact/hooks";
import { cx } from "../cx";
import { useFocusRef, type FocusTarget } from "../focus";
import styles from "./LineInput.module.css";

interface LineInputProps {
  /** The accessible name: the field has a placeholder, not a visible label. */
  label: string;
  value: string;
  /** The new text, and the element, so a refused edit can put its text back. */
  onInput: (value: string, el: HTMLInputElement) => void;
  /** Registers the input with the focus controller under this name. */
  focusTarget?: FocusTarget;
  inputRef?: Ref<HTMLInputElement>;
  placeholder?: string;
  disabled?: boolean;
  class?: string;
  onKeyDown?: (e: TargetedKeyboardEvent<HTMLInputElement>) => void;
  onBeforeInput?: (e: TargetedInputEvent<HTMLInputElement>) => void;
  onCompositionStart?: (e: TargetedEvent<HTMLInputElement, CompositionEvent>) => void;
  onPaste?: (e: TargetedClipboardEvent<HTMLInputElement>) => void;
}

/**
 * The dock's one-line field: the platform's own editing and dictation, and a blue send key on
 * the keyboard (`enterkeyhint="send"`, the focus cue that says Return sends). Autocorrection
 * and spell checking are off, which is also what takes the predictive bar off the keyboard: a
 * line is a command or a prompt for a shell or an agent, not prose to be corrected. Its font
 * is 16 px, below which Safari zooms into a focused field. What Return and a paste mean is the
 * dock's (`screens/terminal/dock/`), not this element's.
 */
export function LineInput({ label, value, onInput, focusTarget, inputRef, class: className, ...rest }: LineInputProps) {
  const registered = useFocusRef(focusTarget);
  // Stable: a new ref callback each render would withdraw and register the field every time, and each registration is a focus-owner change that renders again.
  const attach = useCallback(
    (el: HTMLInputElement | null) => {
      registered(el);
      if (typeof inputRef === "function") inputRef(el);
      else if (inputRef) inputRef.current = el;
    },
    [registered, inputRef],
  );
  return (
    <input
      type="text"
      enterkeyhint="send"
      autocapitalize="off"
      autocomplete="off"
      autocorrect="off"
      spellcheck={false}
      {...rest}
      value={value}
      onInput={(e) => { onInput(e.currentTarget.value, e.currentTarget); }}
      aria-label={label}
      class={cx(styles.input, className)}
      ref={attach}
    />
  );
}
