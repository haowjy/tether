import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import styles from "./Tooltip.module.css";

interface TooltipProps {
  label: string;
  /** Which side of the control the label opens on. */
  placement?: "top" | "bottom" | "right";
  children: ComponentChildren;
}

/**
 * A label shown on hover and keyboard focus, hoverable and dismissed by Escape. It adds no
 * accessible name: the control carries its own `aria-label`. Hidden where there is no hover.
 */
export function Tooltip({ label, placement = "bottom", children }: TooltipProps) {
  const [dismissed, setDismissed] = useState(false);
  const reset = (): void => { setDismissed(false); };
  return (
    <span
      class={styles.root}
      data-dismissed={dismissed || undefined}
      onKeyDown={(e) => { if (e.key === "Escape") setDismissed(true); }}
      onPointerLeave={reset}
      onFocusOut={reset}
    >
      {children}
      <span class={styles.tip} data-placement={placement} role="tooltip" aria-hidden="true">{label}</span>
    </span>
  );
}
