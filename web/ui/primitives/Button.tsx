import type { ComponentChildren, ButtonHTMLAttributes } from "preact";
import { useId } from "preact/hooks";
import { cx } from "../cx";
import { useFocusRef, type FocusTarget } from "../focus";
import { Icon, type IconName } from "./Icon";
import styles from "./Button.module.css";

export interface ButtonProps extends Omit<ButtonHTMLAttributes, "icon"> {
  variant?: "primary" | "secondary" | "quiet";
  icon?: IconName;
  /** Why the button can't be used now. Disabled controls say why: the button stays focusable and does nothing, and the reason is shown beside it, where a touch user sees it, and is its description. */
  disabledReason?: string | undefined;
  /** Registers the button with the focus controller under this name. */
  focusTarget?: FocusTarget;
  children?: ComponentChildren;
}

export function Button({ variant = "secondary", icon, disabledReason, focusTarget, class: className, onClick, children, ...rest }: ButtonProps) {
  const reasonId = useId();
  const focusRef = useFocusRef(focusTarget);
  const blocked = disabledReason !== undefined;
  return (
    <>
      <button
        type="button"
        {...rest}
        ref={focusRef}
        class={cx(styles.button, styles[variant], className as string | undefined)}
        aria-disabled={blocked || undefined}
        aria-describedby={blocked ? reasonId : undefined}
        // A blocked button must not submit its form either: swallow the click's default.
        onClick={blocked ? (e) => { e.preventDefault(); } : onClick}
      >
        {icon && <Icon name={icon} size={16} />}
        {children}
      </button>
      {blocked && <span id={reasonId} class={styles.reason}>{disabledReason}</span>}
    </>
  );
}
