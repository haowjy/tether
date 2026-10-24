import { cx } from "../cx";
import { Button } from "./Button";
import styles from "./StatusBand.module.css";

interface StatusBandProps {
  tone: "reconnecting" | "error" | "notice";
  text: string;
  hint?: string | null | undefined;
  action?: { label: string; onAction: () => void } | null | undefined;
}

/**
 * A compact band on the terminal's top edge for reconnecting, limited and failed tabs, with
 * Retry, and for a window sized for another terminal, with Fit. It floats and reserves no space, so showing it never resizes tmux.
 */
export function StatusBand({ tone, text, hint, action }: StatusBandProps) {
  return (
    <div class={cx(styles.band, styles[tone])} role="status">
      <div class={styles.text}>
        <p class={styles.title}>{text}</p>
        {hint && <p class={styles.hint}>{hint}</p>}
      </div>
      {action && <Button variant="secondary" onClick={action.onAction}>{action.label}</Button>}
    </div>
  );
}
