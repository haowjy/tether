import type { ComponentChildren } from "preact";

interface TappableProps {
  label: string;
  onTap: () => void;
  class?: string;
  /** Shown, announced as unavailable, and inert. */
  disabled?: boolean;
  children?: ComponentChildren;
}

// WebKit applies :active on touch only once a touchstart listener exists somewhere.
if (typeof document !== "undefined") document.addEventListener("touchstart", () => undefined, { passive: true });

/**
 * The one tappable component. Not a <button>: nothing in the web UI may take focus, because
 * the native keyboard owner decides who has it (plan.md "Standards"). Keep every tap here.
 */
export function Tappable({ label, onTap, class: className, disabled = false, children }: TappableProps) {
  return (
    <div
      role="button"
      aria-label={label}
      aria-disabled={disabled || undefined}
      class={className ? `tappable ${className}` : "tappable"}
      onPointerDown={(e) => { e.preventDefault(); }} // no focus change on tap
      onClick={disabled ? undefined : onTap}
    >
      {children}
    </div>
  );
}
