import { useId } from "preact/hooks";
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
  disabled?: boolean;
  hint?: string | undefined;
  /** Shown under the field and announced; also marks the field invalid. */
  error?: string | null | undefined;
  /** Registers the input with the focus controller under this name. */
  focusTarget?: FocusTarget;
  class?: string | undefined;
}

/** A labelled single-line field. With SearchField, the only place an `<input>` lives for screens (lint rule 1). */
export function TextField({ label, value, onInput, hint, error, focusTarget, class: className, ...rest }: FieldProps) {
  const id = useId();
  const focusRef = useFocusRef(focusTarget);
  const note = error ?? hint;
  return (
    <div class={cx(styles.field, className)}>
      <label for={id} class={styles.label}>{label}</label>
      <input
        type="text"
        autocapitalize="off"
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

type SearchProps = Pick<FieldProps, "label" | "value" | "onInput" | "placeholder" | "focusTarget" | "class">;

/** A field that filters a list: a search glyph, and Escape empties it before it closes anything else. */
export function SearchField({ label, value, onInput, placeholder, focusTarget, class: className, ...rest }: SearchProps) {
  const focusRef = useFocusRef(focusTarget);
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
        value={value}
        onInput={(e) => { onInput(e.currentTarget.value); }}
        aria-label={label}
        class={styles.searchInput}
        ref={focusRef}
        onKeyDown={(e) => {
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
