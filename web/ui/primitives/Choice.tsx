import { cx } from "../cx";
import { useFocus } from "../focus";
import styles from "./Choice.module.css";

export interface ChoiceProps<T extends string> {
  /** The group's accessible name. */
  label: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  /** `tabs`: a tablist that swaps what is below it (one tab stop, arrows, Home and End move and select). Default: toggle buttons that each set a value. */
  as?: "toggle" | "tabs";
  /** With `as="tabs"`, the id prefix of the tabs and their panels: a tab has the id `${panel}-tab-${value}` and controls `${panel}-panel-${value}`. */
  panel?: string;
}

/** One of a few choices, all visible at once: a group of toggle buttons, each its own tab stop, or a tablist. */
export function Choice<T extends string>({ label, options, value, onChange, as = "toggle", panel }: ChoiceProps<T>) {
  const focus = useFocus();
  const tabs = as === "tabs";
  // Arrows, Home and End move among the tabs and select as they go; the selected tab alone is a tab stop.
  const onKeyDown = (e: KeyboardEvent): void => {
    const here = options.findIndex((o) => o.value === value);
    const at = e.key === "ArrowRight" ? here + 1 : e.key === "ArrowLeft" ? here - 1 : e.key === "Home" ? 0 : e.key === "End" ? options.length - 1 : here;
    const next = options[at];
    if (!tabs || at === here || !next) return;
    e.preventDefault();
    onChange(next.value);
    const to = e.currentTarget instanceof HTMLElement ? e.currentTarget.querySelectorAll("button")[at] : undefined;
    if (to) focus.focusElement(to);
  };
  return (
    <div role={tabs ? "tablist" : "group"} aria-label={label} class={styles.group} onKeyDown={onKeyDown}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          {...(tabs ? { role: "tab", id: `${panel ?? ""}-tab-${o.value}`, "aria-controls": `${panel ?? ""}-panel-${o.value}`, "aria-selected": o.value === value, tabIndex: o.value === value ? 0 : -1 } : { "aria-pressed": o.value === value })}
          class={cx(styles.option, o.value === value && styles.selected)}
          onClick={() => { if (o.value !== value) onChange(o.value); }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
