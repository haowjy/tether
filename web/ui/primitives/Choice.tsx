import { cx } from "../cx";
import styles from "./Choice.module.css";

export interface ChoiceProps<T extends string> {
  /** The group's accessible name. */
  label: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}

/** One of a few settings, all visible at once: a group of toggle buttons, each its own tab stop. */
export function Choice<T extends string>({ label, options, value, onChange }: ChoiceProps<T>) {
  return (
    <div role="group" aria-label={label} class={styles.group}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          class={cx(styles.option, o.value === value && styles.selected)}
          onClick={() => { if (o.value !== value) onChange(o.value); }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
