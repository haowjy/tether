import type { ButtonHTMLAttributes, ComponentChildren } from "preact";
import { cx } from "../cx";
import styles from "./DockButton.module.css";

interface DockButtonProps extends Omit<ButtonHTMLAttributes, "icon"> {
  /** `key` is a terminal key (32 px, monospace); `control` a dock row control (34 px). */
  kind: "key" | "control";
  /** A held state: an armed modifier, the keyboard held up. */
  pressed?: boolean;
  children: ComponentChildren;
}

/**
 * A button of the phone dock. Its `pointerdown` is cancelled, so a tap on any dock control
 * never moves focus: the input holding the keyboard keeps it, or the toggle and the sessions sheet
 * decide what happens to it.
 */
export function DockButton({ kind, pressed, class: className, children, onPointerDown, ...rest }: DockButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      onPointerDown={(e) => {
        e.preventDefault();
        onPointerDown?.(e);
      }}
      data-kind={kind}
      data-pressed={pressed ? "" : undefined}
      class={cx(styles.button, className as string | undefined)}
    >
      {children}
    </button>
  );
}
