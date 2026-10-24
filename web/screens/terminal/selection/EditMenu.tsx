import { Button } from "../../../ui/primitives/Button";
import type { MenuState } from "./control";
import styles from "./EditMenu.module.css";

interface EditMenuProps {
  menu: MenuState;
  onCopy: () => void;
  onPaste: () => void;
}

/**
 * tether's own edit menu over the terminal: Copy when there is a selection, and Paste. A
 * press on it must not move focus or clear the selection, so `pointerdown` is cancelled; the
 * action runs in the tap, where Safari allows the clipboard.
 */
export function EditMenu({ menu, onCopy, onPaste }: EditMenuProps) {
  const keep = (e: PointerEvent): void => { e.preventDefault(); };
  return (
    <div class={styles.menu} role="menu" aria-label="Edit" style={{ left: `clamp(var(--edit-menu-half), ${String(menu.x)}px, calc(100% - var(--edit-menu-half)))`, top: `${String(menu.below ? menu.bottom : menu.top)}px` }} data-below={menu.below ? "" : undefined}>
      {menu.selection && <Button variant="quiet" role="menuitem" onPointerDown={keep} onClick={onCopy}>Copy</Button>}
      <Button variant="quiet" role="menuitem" onPointerDown={keep} onClick={onPaste}>Paste</Button>
    </div>
  );
}
