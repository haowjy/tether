import type { ComponentChildren, ButtonHTMLAttributes } from "preact";
import { cx } from "../cx";
import { Icon, type IconName } from "./Icon";
import styles from "./Row.module.css";

export interface RowProps extends Omit<ButtonHTMLAttributes, "icon" | "label"> {
  /** The leading glyph: a session, a terminal window, a folder, a file. */
  icon: IconName;
  label: ComponentChildren;
  /** A sign that must stay visible when the label ellipsizes: the bell dot. */
  mark?: ComponentChildren;
  /** Quiet text after the label: a count, a size, "Open". */
  meta?: ComponentChildren;
  /** The trailing glyph, usually a chevron. Window rows have none. */
  trailing?: IconName;
  /** An open tab, a selected file: marked by fill, not hue. */
  selected?: boolean;
  /** Joins the arrow-key roving of the surrounding `RovingList`. */
  roving?: boolean;
}

/** One list row with fixed slots, so session, window, folder, file and tab rows line up. */
export function Row({ icon, label, mark, meta, trailing, selected, roving, class: className, ...rest }: RowProps) {
  return (
    <button type="button" data-roving={roving ? "" : undefined} {...rest} class={cx(styles.row, selected && styles.selected, className as string | undefined)}>
      <span class={styles.leading}><Icon name={icon} size={20} /></span>
      <span class={styles.label}>{label}</span>
      {mark !== undefined && <span class={styles.mark}>{mark}</span>}
      {meta !== undefined && <span class={styles.meta}>{meta}</span>}
      {trailing && <Icon name={trailing} size={16} class={styles.trailing} />}
    </button>
  );
}
