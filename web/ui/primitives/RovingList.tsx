import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { useFocus } from "../focus";

interface RovingListProps {
  label: string;
  /** `menu` for a popup menu whose rows are `menuitem`s. */
  role?: "group" | "menu";
  class?: string | undefined;
  children: ComponentChildren;
}

/**
 * A list with arrow-key roving focus: one item is tabbable, and ArrowUp, ArrowDown, Home
 * and End move among the visible `data-roving` items inside. The `tabindex` bookkeeping is
 * done on the DOM after each render, so rows and disclosures stay plain primitives.
 */
export function RovingList({ label, role = "group", class: className, children }: RovingListProps) {
  const root = useRef<HTMLDivElement>(null);
  const current = useRef<HTMLElement | null>(null);
  const focus = useFocus();

  const items = (): HTMLElement[] =>
    [...(root.current?.querySelectorAll<HTMLElement>("[data-roving]") ?? [])].filter((el) => el.offsetParent !== null);

  // Exactly one visible item is in the tab order: the last focused, else the first.
  useEffect(() => {
    const all = items();
    const keep = current.current && all.includes(current.current) ? current.current : all[0];
    for (const el of root.current?.querySelectorAll<HTMLElement>("[data-roving]") ?? []) el.tabIndex = el === keep ? 0 : -1;
  });

  const onKeyDown = (e: KeyboardEvent): void => {
    const all = items();
    const at = all.findIndex((el) => el === document.activeElement);
    if (at < 0) return;
    const to = e.key === "ArrowDown" ? at + 1 : e.key === "ArrowUp" ? at - 1 : e.key === "Home" ? 0 : e.key === "End" ? all.length - 1 : null;
    const next = to === null ? undefined : all[Math.max(0, Math.min(all.length - 1, to))];
    if (!next) return;
    e.preventDefault();
    focus.focusElement(next);
  };

  return (
    <div
      ref={root}
      role={role}
      aria-label={label}
      class={className}
      onKeyDown={onKeyDown}
      onFocusIn={(e) => { if (e.target instanceof HTMLElement && e.target.hasAttribute("data-roving")) current.current = e.target; }}
    >
      {children}
    </div>
  );
}
