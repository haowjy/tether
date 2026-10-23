import type { ComponentChildren } from "preact";
import { useEffect, useId, useRef } from "preact/hooks";
import { cx } from "../cx";
import { useFocus, type FocusTarget } from "../focus";
import { IconButton } from "./IconButton";
import styles from "./Dialog.module.css";

interface DialogProps {
  open: boolean;
  /** Escape, the backdrop, the close button. The parent decides what closing means (usually the router's Back). */
  onClose: () => void;
  title: string;
  /** `sheet` is the same dialog styled as a tall bottom sheet with safe-area padding. */
  variant?: "dialog" | "sheet";
  /** Where focus returns on close: an element or a registered name. Default: the control that opened it. */
  returnFocusTo?: FocusTarget | null;
  /** The field a fine pointer starts in; in `touch` density focus never starts in a field. */
  initialFocus?: () => HTMLElement | null;
  children: ComponentChildren;
}

/** `<dialog>.showModal()`: top layer, modal focus containment, Escape. Safari lacks `closedby`, so Escape and the backdrop are handled here. */
export function Dialog({ open, onClose, title, variant = "dialog", returnFocusTo, initialFocus, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const focus = useFocus();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) focus.openDialog(dialog, initialFocus?.() ?? null);
    else if (!open && dialog.open) focus.closeDialog(dialog, returnFocusTo ?? null);
  }, [open]);

  // A dialog unmounted while open must not leave the page inert.
  useEffect(() => () => {
    const dialog = ref.current;
    if (dialog?.open) dialog.close();
  }, []);

  return (
    <dialog
      ref={ref}
      class={cx(styles.dialog, variant === "sheet" && styles.sheet)}
      aria-labelledby={titleId}
      tabIndex={-1}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div class={styles.panel}>
        <header class={styles.header}>
          <h2 id={titleId} class={styles.title}>{title}</h2>
          <IconButton icon="close" label="Close" data-initial-focus="touch" onClick={onClose} />
        </header>
        <div class={styles.body}>{children}</div>
      </div>
    </dialog>
  );
}
