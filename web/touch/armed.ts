// The key row's armed ctrl or alt (client-architecture.md §7.4), as state the dock reads:
// the pure rule is `modifiers.ts`. Terminal-targeted input uses `input`; line-editing sources
// use `chord` so an unchordable insert can stay local.
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

  /** Applies an armed modifier only when the web rule makes a chord; otherwise the caller keeps the input local. */
  chord(events: InputEvent[]): boolean {
    const armed = this.snapshot.armed;
    if (!armed) return false;
    const result = apply(armed, events);
    this.update({ armed: null });
    if (result.events === events) return false;
    this.type(result.events);
    return true;
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
