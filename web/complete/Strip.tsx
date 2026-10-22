import { useLayoutEffect, useRef } from "preact/hooks";
import type { App } from "../app/app";
import type { Chip } from "../proto/generated/messages";
import { Tappable } from "../ui/Tappable";
import { History } from "../ui/icons";

/**
 * The suggestion strip under the tab bar, right above native's key row (plan.md
 * "Suggestion strip"). It shows only while there are chips, and never counts toward the
 * tmux size: like the keyboard, it shortens the terminal's area and the terminal pans.
 */
export function Strip({ app, chips }: { app: App; chips: readonly Chip[] }) {
  const row = useRef<HTMLDivElement>(null);
  // A new set of chips starts from its best one.
  useLayoutEffect(() => {
    if (row.current) row.current.scrollLeft = 0;
  }, [chips]);
  return (
    <div class="chips" ref={row} role="toolbar" aria-label="Suggestions">
      {chips.map((chip) => (
        <Tappable
          key={chip.source + chip.label}
          class={`chip chip-${chip.source}`}
          label={`${chip.label}${chip.description ? `, ${chip.description}` : ""}${chip.source === "history" ? ", from history" : ""}`}
          onTap={() => { app.typeChip(chip); }}
        >
          {chip.source === "history" && <History />}
          <span class="chip-label mono">{chip.label}</span>
          {chip.description && <span class="chip-desc">{chip.description}</span>}
        </Tappable>
      ))}
    </div>
  );
}
