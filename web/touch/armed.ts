// The key row's armed ctrl or alt (client-architecture.md §7.4), as state the dock reads:
// the pure rule is `modifiers.ts`. Every touch source (the owned input, the key row, the line
// field's chords) types through here, so an armed modifier applies to the next thing typed
// from any of them.
import { Store } from "../ui/store";
import type { InputEvent } from "../platform/types";
import { apply, toggle, type Armed } from "./modifiers";

export class ArmedModifiers extends Store<{ armed: Armed }> {
  /** `type` sends events to the tab on screen. */
  constructor(private readonly type: (events: InputEvent[]) => void) {
    super({ armed: null });
  }

  /** Typing from a touch source: an armed ctrl or alt applies, then it goes to the tab on screen. */
  input(events: InputEvent[]): void {
    const result = apply(this.snapshot.armed, events);
    if (result.armed !== this.snapshot.armed) this.update({ armed: result.armed });
    this.type(result.events);
  }

  /** Whether an armed modifier takes this one typed character (the line field cancels the edit and the chord goes to the terminal). Anything else typed disarms. */
  chord(text: string): boolean {
    const { armed } = this.snapshot;
    if (armed === null) return false;
    const result = apply(armed, [{ text }]);
    this.update({ armed: null });
    const chorded = result.events[0] !== undefined && "key" in result.events[0];
    if (chorded) this.type(result.events);
    return chorded;
  }

  /** A modifier key's tap. */
  toggle(key: "ctrl" | "alt"): void {
    this.update({ armed: toggle(this.snapshot.armed, key) });
  }

  /** An IME started composing: an armed modifier has nothing to apply to. */
  disarm(): void {
    this.update({ armed: null });
  }
}
