import type { ComponentChildren, ButtonHTMLAttributes } from "preact";
import { useId } from "preact/hooks";
import { cx } from "../cx";
import { Icon, type IconName } from "./Icon";
import styles from "./Button.module.css";

export interface ButtonProps extends Omit<ButtonHTMLAttributes, "icon"> {
  variant?: "primary" | "secondary" | "quiet";
  icon?: IconName;
  /** Why the button can't be used now. Disabled controls say why: the button stays focusable, does nothing, and describes itself. */
  disabledReason?: string | undefined;
  children?: ComponentChildren;
}

export function Button({ variant = "secondary", icon, disabledReason, class: className, onClick, children, ...rest }: ButtonProps) {
  const reasonId = useId();
  const blocked = disabledReason !== undefined;
  return (
    <>
      <button
        type="button"
        {...rest}
        class={cx(styles.button, styles[variant], className as string | undefined)}
        aria-disabled={blocked || undefined}
        aria-describedby={blocked ? reasonId : undefined}
        onClick={blocked ? undefined : onClick}
      >
        {icon && <Icon name={icon} size={16} />}
        {children}
      </button>
      {blocked && <span id={reasonId} class="sr-only">{disabledReason}</span>}
    </>
  );
}
