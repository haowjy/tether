import type { ComponentChildren } from "preact";
import { useEffect, useId, useLayoutEffect, useRef } from "preact/hooks";
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
  /** Where focus returns on close: an element or a registered name. Default: the control `app.openOverlay` was given, else the one focused at opening. A field marked `data-initial-focus=""` takes focus on opening with a fine pointer. */
  returnFocusTo?: HTMLElement | FocusTarget | null;
  /** The top row in place of the title and close button (the sessions sheet's Home and search); `title` stays as the dialog's accessible name. */
  header?: ComponentChildren;
  /** Pinned under the scrolling body, safe-area padded (the sessions sheet's tabs). */
  footer?: ComponentChildren;
  children: ComponentChildren;
}

/** `<dialog>.showModal()`: top layer, modal focus containment, Escape. Safari lacks `closedby`, so Escape and the backdrop are handled here. */
export function Dialog({ open, onClose, title, variant = "dialog", returnFocusTo, header, footer, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const focus = useFocus();
  // A tap that closes (the close icon, the backdrop) is the moment a keyboard that was up can come back.
  const closeByTap = (from: Element): void => {
    focus.returnKeyboardInTap(from);
    onClose();
  };

  // A layout effect: the dialog opens in the commit of the change that asked, not a frame later
  // (after a paint of the page behind it, and after a tap on its backdrop could land elsewhere).
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) focus.openDialog(dialog);
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
      onClick={(e) => { if (e.target === e.currentTarget) closeByTap(e.currentTarget); }}
    >
      <div class={styles.panel}>
        {header ? (
          <>
            <h2 id={titleId} class="sr-only">{title}</h2>
            <header class={styles.top}>{header}</header>
          </>
        ) : (
          <header class={styles.header}>
            <h2 id={titleId} class={styles.title}>{title}</h2>
            <IconButton icon="close" label="Close" data-initial-focus="touch" onClick={(e) => { closeByTap(e.currentTarget); }} />
          </header>
        )}
        <div class={styles.body}>{children}</div>
        {footer && <footer class={styles.footer}>{footer}</footer>}
      </div>
    </dialog>
  );
}
