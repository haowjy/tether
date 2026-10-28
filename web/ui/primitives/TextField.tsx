import type { RefObject, TargetedKeyboardEvent } from "preact";
import { useCallback, useId } from "preact/hooks";
import { cx } from "../cx";
import { useFocusRef, type FocusTarget } from "../focus";
import { Icon } from "./Icon";
import styles from "./TextField.module.css";

interface FieldProps {
  label: string;
  value: string;
  /** Called with the new text on every edit. */
  onInput: (value: string) => void;
  placeholder?: string;
  name?: string;
  inputMode?: "text" | "numeric" | "url";
  /** Starts the shift key on for the whole field; off unless a field's values are uppercase. */
  autocapitalize?: "off" | "characters";
  disabled?: boolean;
  hint?: string | undefined;
  /** Shown under the field and announced; also marks the field invalid. */
  error?: string | null | undefined;
  /** Registers the input with the focus controller under this name. */
  focusTarget?: FocusTarget;
  class?: string | undefined;
}

/** A labelled single-line field. With SearchField, the only place an `<input>` lives for screens (lint rule 1). */
export function TextField({ label, value, onInput, hint, error, focusTarget, autocapitalize = "off", class: className, ...rest }: FieldProps) {
  const id = useId();
  const focusRef = useFocusRef(focusTarget);
  const note = error ?? hint;
  return (
    <div class={cx(styles.field, className)}>
      <label for={id} class={styles.label}>{label}</label>
      <input
        type="text"
        autocapitalize={autocapitalize}
        autocomplete="off"
        spellcheck={false}
        {...rest}
        id={id}
        value={value}
        onInput={(e) => { onInput(e.currentTarget.value); }}
        class={styles.input}
        aria-invalid={error ? true : undefined}
        aria-describedby={note ? `${id}-note` : undefined}
        ref={focusRef}
      />
      {note && <p id={`${id}-note`} class={cx(styles.note, error && styles.error)} role={error ? "alert" : undefined}>{note}</p>}
    </div>
  );
}

type SearchProps = Pick<FieldProps, "label" | "placeholder" | "focusTarget" | "class"> & {
  value: string;
  /** The new text, and the element, so an owner that completes paths can read the caret. */
  onInput: (value: string, el?: HTMLInputElement) => void;
  /** Keys the owner handles first (a search that also completes paths); Escape still empties the field. */
  onKeyDown?: (e: TargetedKeyboardEvent<HTMLInputElement>) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
  /** The list this field completes into (when it has rows), and its highlighted row, for assistive technology. */
  listId?: string | undefined;
  activeId?: string | undefined;
};

/** A field that filters a list: a search glyph, and Escape empties it before it closes anything else. */
export function SearchField({ label, value, onInput, placeholder, focusTarget, onKeyDown, inputRef, listId, activeId, class: className, ...rest }: SearchProps) {
  const focusRef = useFocusRef(focusTarget);
  const attach = useCallback((el: HTMLInputElement | null) => {
    focusRef(el);
    if (inputRef) inputRef.current = el;
  }, [focusRef, inputRef]);
  return (
    <div class={cx(styles.search, className)}>
      <Icon name="search" size={16} class={styles.glyph} />
      <input
        type="text"
        role="searchbox"
        autocapitalize="off"
        autocomplete="off"
        spellcheck={false}
        {...rest}
        {...(placeholder !== undefined && { placeholder })}
        aria-controls={listId}
        aria-activedescendant={activeId}
        value={value}
        onInput={(e) => { onInput(e.currentTarget.value, e.currentTarget); }}
        aria-label={label}
        class={styles.searchInput}
        ref={attach}
        onKeyDown={(e) => {
          onKeyDown?.(e);
          if (e.key === "Escape" && value !== "") {
            e.preventDefault(); // a dialog around the field would otherwise close
            e.stopPropagation();
            onInput("");
          }
        }}
      />
    </div>
  );
}
