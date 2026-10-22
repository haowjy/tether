import type { ComponentChildren } from "preact";
import { ChevronLeft, Close } from "./icons";
import { Tappable } from "./Tappable";

/**
 * An overlay in the page: a scrim and a panel rising from the bottom. `tall` holds the
 * panel at its full height, so it doesn't jump as its content changes; `full` fills the screen.
 */
export function Sheet({ onClose, full = false, tall = false, label, children }: { onClose: () => void; full?: boolean; tall?: boolean; label: string; children: ComponentChildren }) {
  return (
    <div class={`sheet-layer${full ? " sheet-layer-full" : ""}`}>
      <Tappable class="scrim" label="Close" onTap={onClose} />
      <div class={`sheet${tall ? " sheet-tall" : ""}`} role="dialog" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

export function SheetHeader({ title, sub, onBack, actions }: { title: string; sub?: string | null | undefined; onBack?: (() => void) | undefined; actions: ComponentChildren }) {
  return (
    <div class="sheet-head">
      {onBack && (
        <Tappable class="icon-tap" label="Back" onTap={onBack}>
          <ChevronLeft />
        </Tappable>
      )}
      <div class="sheet-title">
        <div class="sheet-title-main">{title}</div>
        {sub && <div class="sheet-title-sub">{sub}</div>}
      </div>
      {actions}
    </div>
  );
}

export function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <Tappable class="icon-tap" label="Close" onTap={onClose}>
      <Close />
    </Tappable>
  );
}

/** A full-width message for a list with nothing to show. */
export function Empty({ title, hint, children }: { title: string; hint?: string | undefined; children?: ComponentChildren }) {
  return (
    <div class="empty">
      <div class="empty-title">{title}</div>
      {hint && <div class="empty-hint">{hint}</div>}
      {children}
    </div>
  );
}
