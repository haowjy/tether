import type { ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { cx } from "../cx";
import { useFocus, type FocusTarget } from "../focus";
import { useCloseByTap } from "./DialogBars";
import styles from "./Dialog.module.css";

/**
 * A dialog placed against a control, over the page with no scrim: a press outside closes it. It
 * hangs under `to` (an element or a registered focus target) with left edges aligned, above it
 * when there is more room there, kept inside the window and re-placed when the window resizes. With
 * no `to` on screen it sits centred. `popover` is wide, for a search and a list; `menu` fits its buttons.
 */
export interface Anchored {
  kind: "popover" | "menu";
  to: HTMLElement | FocusTarget | null;
}

interface DialogProps {
  open: boolean;
  /** Escape, the backdrop, the close button. The parent decides what closing means (usually the router's Back). */
  onClose: () => void;
  title: string;
  /** Where it sits: centred (`dialog`), as a tall bottom sheet with safe-area padding, filling the screen (`page`), or against a control. What its top row holds is `header`'s. */
  variant?: "dialog" | "sheet" | "page" | Anchored;
  /** Where focus returns on close: an element or a registered name. Default: the control `app.openOverlay` was given, else the one focused at opening. A field marked `data-initial-focus=""` takes focus on opening with a fine pointer. */
  returnFocusTo?: HTMLElement | FocusTarget | null;
  /** The top row: a `TitleBar`, `ToolBar` or `PageBar`, or null for none. `title` is the dialog's accessible name. */
  header: ComponentChildren;
  /** Pinned under the scrolling body, safe-area padded (the sessions sheet's tabs). */
  footer?: ComponentChildren;
  children: ComponentChildren;
}

/** Space between a popover and its anchor, and between it and the window's edge. */
const GAP_PX = 8;

/** Puts an open anchored dialog next to `anchor`, as tall as the window on that side allows (its body scrolls). */
function place(dialog: HTMLDialogElement, anchor: HTMLElement): void {
  dialog.style.top = dialog.style.bottom = dialog.style.maxHeight = "";
  const rect = anchor.getBoundingClientRect();
  const { clientWidth, clientHeight } = document.documentElement;
  const below = clientHeight - rect.bottom - 2 * GAP_PX;
  const above = rect.top - 2 * GAP_PX;
  const up = dialog.offsetHeight > below && above > below;
  dialog.style.maxHeight = `${String(up ? above : below)}px`;
  if (up) dialog.style.bottom = `${String(clientHeight - rect.top + GAP_PX)}px`;
  else dialog.style.top = `${String(rect.bottom + GAP_PX)}px`;
  dialog.style.left = `${String(Math.max(GAP_PX, Math.min(rect.left, clientWidth - dialog.offsetWidth - GAP_PX)))}px`;
}

/** `<dialog>.showModal()`: top layer, modal focus containment, Escape. Safari lacks `closedby`, so Escape and the backdrop are handled here. */
export function Dialog({ open, onClose, title, variant = "dialog", returnFocusTo, header, footer, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const focus = useFocus();
  const closeByTap = useCloseByTap(onClose);

  const anchored = typeof variant === "object" ? variant : null;
  const anchorElement = (): HTMLElement | null => (typeof anchored?.to === "string" ? focus.elementOf(anchored.to) : (anchored?.to ?? null));

  // A layout effect: the dialog opens in the commit of the change that asked, not a frame later
  // (after a paint of the page behind it, and after a tap on its backdrop could land elsewhere).
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      focus.openDialog(dialog);
      const target = anchorElement();
      if (target) place(dialog, target);
    } else if (!open && dialog.open) focus.closeDialog(dialog, returnFocusTo ?? null);
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!open || !anchored || !dialog) return;
    const replace = (): void => {
      const target = anchorElement();
      if (target && dialog.open) place(dialog, target);
    };
    addEventListener("resize", replace);
    return () => { removeEventListener("resize", replace); };
  }, [open]);

  // A dialog unmounted while open must not leave the page inert.
  useEffect(() => () => {
    const dialog = ref.current;
    if (dialog?.open) dialog.close();
  }, []);

  const placement = typeof variant === "object" ? variant.kind : variant;
  return (
    <dialog
      ref={ref}
      class={cx(styles.dialog, placement !== "dialog" && styles[placement])}
      aria-label={title}
      tabIndex={-1}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === e.currentTarget) closeByTap(e.currentTarget); }}
    >
      <div class={styles.panel}>
        {header}
        <div class={styles.body}>{children}</div>
        {footer && <footer class={styles.footer}>{footer}</footer>}
      </div>
    </dialog>
  );
}
