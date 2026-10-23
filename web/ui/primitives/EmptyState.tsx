import type { ComponentChildren } from "preact";
import { Icon, type IconName } from "./Icon";
import styles from "./EmptyState.module.css";

interface EmptyStateProps {
  icon?: IconName;
  title: string;
  children?: ComponentChildren;
  /** An action such as Retry or Open a window. */
  action?: ComponentChildren;
}

/** No tabs, no matches, an empty folder, an error that is not an empty list. */
export function EmptyState({ icon, title, children, action }: EmptyStateProps) {
  return (
    <div class={styles.empty}>
      {icon && <Icon name={icon} size={24} class={styles.glyph} />}
      <p class={styles.title}>{title}</p>
      {children && <p class={styles.detail}>{children}</p>}
      {action}
    </div>
  );
}
