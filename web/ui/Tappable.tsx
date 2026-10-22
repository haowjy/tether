import type { ComponentChildren } from "preact";

interface TappableProps {
  label: string;
  onTap: () => void;
  class?: string;
  children?: ComponentChildren;
}

/**
 * The one tappable component. Not a <button>: nothing in the web UI may take focus, because
 * the native keyboard owner decides who has it (plan.md "Standards"). Keep every tap here.
 */
export function Tappable({ label, onTap, class: className, children }: TappableProps) {
  return (
    <div
      role="button"
      aria-label={label}
      class={className}
      onPointerDown={(e) => { e.preventDefault(); }} // no focus change on tap
      onClick={onTap}
    >
      {children}
    </div>
  );
}
