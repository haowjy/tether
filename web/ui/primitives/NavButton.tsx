import { Icon, type IconName } from "./Icon";
import styles from "./NavButton.module.css";

interface NavButtonProps {
  icon: IconName;
  /** A small caption: the destination's name. */
  label: string;
  current: boolean;
  onClick: () => void;
}

/** A destination in a bottom bar: a glyph over a caption, marked with `aria-current`. */
export function NavButton({ icon, label, current, onClick }: NavButtonProps) {
  return (
    <button type="button" class={styles.item} aria-current={current ? "page" : undefined} onClick={onClick}>
      <Icon name={icon} size={24} />
      <span>{label}</span>
    </button>
  );
}
