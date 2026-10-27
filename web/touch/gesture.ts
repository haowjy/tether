// The touch gesture owner (client-architecture.md §7.6): a sans-IO recognizer. Pointer
// events and the clock go in; what the gesture resolved to comes out. Nothing here knows
// about the terminal: the shell (`screens/terminal/touchControl.ts`) decides what a tap, a
// scroll or a selection means for the screen it is on. No remote mouse-down is ever
// implied by touch start: a press is only a tap once it ends, unmoved, before the long-press.

export type GestureAction =
  /** A short press, released where it began. */
  | { type: "tap"; x: number; y: number }
  /** The finger moved `dy` px vertically since the last event; `velocity` is px/s, positive downward. */
  | { type: "scroll"; dy: number; velocity: number }
  /** The scrolling finger lifted, moving at `velocity` px/s (0 when it had stopped). */
  | { type: "scrollEnd"; velocity: number }
  /** The press was held still: haptic now, and the word under the finger is selected. */
  | { type: "longPress"; x: number; y: number }
  /** The held finger moved: the selection follows it. */
  | { type: "selectMove"; x: number; y: number }
  /** The held finger lifted: the selection is final. */
  | { type: "selectEnd" }
  /** A system gesture or a second finger took the touch: send nothing. */
  | { type: "cancel" };

export interface GestureConfig {
  /** Movement beyond this before the long-press fires is a scroll (vertical) or nothing (horizontal). */
  slop: number;
  longPressMs: number;
  /** A scroll's release velocity counts only if the finger moved this recently, and over this window. */
  flingFreshMs: number;
  velocityWindowMs: number;
}

export const DEFAULT_GESTURE: GestureConfig = {
  slop: 10,
  longPressMs: 380,
  flingFreshMs: 80,
  velocityWindowMs: 100,
};

type State =
  | { kind: "idle" }
  | { kind: "pending"; id: number; x: number; y: number; t: number }
  | { kind: "scrolling"; id: number; y: number; samples: Sample[] }
  | { kind: "held"; id: number }
  /** Horizontal travel, a second finger or a cancelled touch: nothing resolves until every finger lifts. */
  | { kind: "ignored"; down: Set<number> };

interface Sample {
  y: number;
  t: number;
}

export class GestureRecognizer {
  private state: State = { kind: "idle" };

  constructor(private readonly config: GestureConfig = DEFAULT_GESTURE) {}

  /** When {@link advance} next has work (the long-press), or null. */
  get deadline(): number | null {
    const s = this.state;
    if (s.kind === "pending") return s.t + this.config.longPressMs;
    return null;
  }

  down(id: number, x: number, y: number, t: number): GestureAction[] {
    const s = this.state;
    if (s.kind === "idle") {
      this.state = { kind: "pending", id, x, y, t };
      return [];
    }
    // A second finger: whatever the first was becoming is not that any more.
    if (s.kind === "ignored") {
      s.down.add(id);
      return [];
    }
    this.state = { kind: "ignored", down: new Set([s.id, id]) };
    return this.ended(s, [{ type: "cancel" }]);
  }

  move(id: number, x: number, y: number, t: number): GestureAction[] {
    const s = this.state;
    const { config } = this;
    switch (s.kind) {
      case "pending": {
        if (s.id !== id) return [];
        const dx = x - s.x;
        const dy = y - s.y;
        if (Math.hypot(dx, dy) <= config.slop) return [];
        if (Math.abs(dy) < Math.abs(dx)) {
          this.state = { kind: "ignored", down: new Set([id]) };
          return [];
        }
        // Scrolling starts from where the slop was crossed, so the content does not jump.
        this.state = { kind: "scrolling", id, y, samples: [{ y, t }] };
        return [];
      }
      case "scrolling": {
        if (s.id !== id) return [];
        const dy = y - s.y;
        s.y = y;
        s.samples.push({ y, t });
        while (s.samples.length > 2 && t - (s.samples[0]?.t ?? t) > config.velocityWindowMs) s.samples.shift();
        return dy === 0 ? [] : [{ type: "scroll", dy, velocity: velocityOf(s.samples) }];
      }
      case "held":
        return s.id === id ? [{ type: "selectMove", x, y }] : [];
      default:
        return [];
    }
  }

  up(id: number, t: number): GestureAction[] {
    const s = this.state;
    switch (s.kind) {
      case "pending":
        if (s.id !== id) return [];
        this.state = { kind: "idle" };
        return [{ type: "tap", x: s.x, y: s.y }];
      case "scrolling": {
        if (s.id !== id) return [];
        this.state = { kind: "idle" };
        const last = s.samples[s.samples.length - 1];
        const fresh = last !== undefined && t - last.t <= this.config.flingFreshMs;
        return [{ type: "scrollEnd", velocity: fresh ? velocityOf(s.samples) : 0 }];
      }
      case "held":
        if (s.id !== id) return [];
        this.state = { kind: "idle" };
        return [{ type: "selectEnd" }];
      case "ignored":
        s.down.delete(id);
        if (s.down.size === 0) this.state = { kind: "idle" };
        return [];
      default:
        return [];
    }
  }

  /** `pointercancel`: a system gesture owns the touch. Nothing is sent. */
  cancel(): GestureAction[] {
    const s = this.state;
    this.state = { kind: "idle" };
    return s.kind === "idle" || s.kind === "ignored" ? [] : this.ended(s, [{ type: "cancel" }]);
  }

  /** The clock reached {@link deadline}: the long-press fires. */
  advance(t: number): GestureAction[] {
    const s = this.state;
    if (s.kind === "pending" && t >= s.t + this.config.longPressMs) {
      this.state = { kind: "held", id: s.id };
      return [{ type: "longPress", x: s.x, y: s.y }];
    }
    return [];
  }

  /** What the shell must undo when a gesture dies: a scroll ends at rest. */
  private ended(s: State, out: GestureAction[]): GestureAction[] {
    return s.kind === "scrolling" ? [{ type: "scrollEnd", velocity: 0 }, ...out] : out;
  }
}

function velocityOf(samples: Sample[]): number {
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (!first || !last || last.t <= first.t) return 0;
  return ((last.y - first.y) / (last.t - first.t)) * 1000;
}
