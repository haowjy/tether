import type { ComponentChildren } from "preact";
import { useId } from "preact/hooks";
import { cx } from "../cx";
import { Icon, type IconName } from "./Icon";
import styles from "./Disclosure.module.css";

interface DisclosureProps {
  icon: IconName;
  label: ComponentChildren;
  meta?: ComponentChildren;
  /** Controlled, because search forces expansion without changing what the user chose. */
  expanded: boolean;
  onToggle: () => void;
  /** Joins the arrow-key roving of the surrounding `RovingList`. */
  roving?: boolean;
  children: ComponentChildren;
}

/** An accordion group: a row-shaped button with `aria-expanded`, and a region it controls. The chevron rotates down when expanded. */
export function Disclosure({ icon, label, meta, expanded, onToggle, roving, children }: DisclosureProps) {
  const region = useId();
  return (
    <div class={styles.group}>
      <button type="button" class={styles.summary} data-roving={roving ? "" : undefined} aria-expanded={expanded} aria-controls={region} onClick={onToggle}>
        <span class={styles.leading}><Icon name={icon} size={20} /></span>
        <span class={styles.label}>{label}</span>
        {meta !== undefined && <span class={styles.meta}>{meta}</span>}
        <Icon name="chevron" size={16} class={cx(styles.chevron, expanded && styles.open)} />
      </button>
      <div id={region} role="region" hidden={!expanded} class={styles.panel}>{children}</div>
    </div>
  );
}
