import type { ComponentChildren } from "preact";
import { cx } from "../cx";
import { Button } from "./Button";
import { IconButton } from "./IconButton";
import { Icon } from "./Icon";
import styles from "./Banner.module.css";

interface BannerProps {
  tone?: "info" | "warning" | "error";
  title: string;
  children?: ComponentChildren;
  /** The one thing to do about it: Retry, Update, Reload. */
  action?: { label: string; onAction: () => void };
  /** For a notice that can be put away for good. */
  onDismiss?: () => void;
}

/** A status region for host problems, offline and "Update ready". Never over the terminal. */
export function Banner({ tone = "info", title, children, action, onDismiss }: BannerProps) {
  return (
    <div class={cx(styles.banner, styles[tone])} role="status">
      <Icon name={tone === "info" ? "refresh" : "alert"} size={20} class={styles.glyph} />
      <div class={styles.text}>
        <p class={styles.title}>{title}</p>
        {children && <p class={styles.detail}>{children}</p>}
      </div>
      {action && <Button variant="secondary" onClick={action.onAction}>{action.label}</Button>}
      {onDismiss && <IconButton icon="close" label="Dismiss" onClick={onDismiss} />}
    </div>
  );
}
