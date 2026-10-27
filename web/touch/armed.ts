// The key row's armed ctrl or alt (client-architecture.md §7.4), as state the dock reads:
// the pure rule is `modifiers.ts`. Terminal-targeted input uses `input`; the dock's keys and
// line-editing sources use `route`, which decides where the key goes and commits the modifier.
import { Store } from "../ui/store";
import type { InputEvent } from "../platform/types";
import { routeKey, type KeyOwner, type Route, type RowKey } from "./keyRoute";
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

  /**
   * A key-row key, a typed character or a hardware key while the dock has the keyboard: decide where
   * it goes against the live armed state (never a render's copy), commit the modifier it uses, and
   * send it to the tab if it is for tmux. The caller carries out the other routes.
   */
  route(key: RowKey, owner: KeyOwner): Route {
    const { route, armed } = routeKey(key, owner, this.snapshot.armed);
    if (armed !== this.snapshot.armed) this.update({ armed });
    if (route.to === "terminal") this.type(route.events);
    return route;
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
