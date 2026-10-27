import { cx } from "../cx";
import styles from "./BellDot.module.css";

/** A bell rang in this session since this device last showed it (browser-behaviors.md). Not a connection status: it has its own colour and a name. */
export function BellDot({ class: className }: { class?: string | undefined }) {
  return <span class={cx(styles.dot, className)} role="img" aria-label="Bell rang" />;
}
