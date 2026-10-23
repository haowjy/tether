import type { ButtonHTMLAttributes } from "preact";
import { cx } from "../cx";
import { useFocusRef, type FocusTarget } from "../focus";
import { Icon, type IconName } from "./Icon";
import { Tooltip } from "./Tooltip";
import styles from "./IconButton.module.css";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes, "icon" | "label"> {
  icon: IconName;
  /** The accessible name, and the tooltip's text. Required: an icon button has no other name. */
  label: string;
  placement?: "top" | "bottom" | "right";
  /** Pressed state, for toggles such as the rail's current destination (`aria-current`). */
  current?: boolean;
  /** Registers the button with the focus controller under this name. */
  focusTarget?: FocusTarget;
}

export function IconButton({ icon, label, placement = "bottom", current, focusTarget, class: className, ...rest }: IconButtonProps) {
  const focusRef = useFocusRef(focusTarget);
  return (
    <Tooltip label={label} placement={placement}>
      <button
        type="button"
        {...rest}
        class={cx(styles.button, className as string | undefined)}
        aria-label={label}
        aria-current={current ? "page" : undefined}
        ref={focusRef}
      >
        <Icon name={icon} size={20} />
      </button>
    </Tooltip>
  );
}
