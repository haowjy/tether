// Momentum for a released scroll: the speed decays exponentially, like iOS's normal
// deceleration (0.998 per millisecond, a time constant of about half a second), so a flick of
// 2000 px/s coasts about 1000 px. Pure: the shell feeds it frame times.

const TIME_CONSTANT_MS = 500;
/** Slower than this is at rest. */
const REST_PX_PER_S = 24;
/** A flick is not faster than this: a spurious sample must not throw the view across the history. */
export const MAX_FLING_PX_PER_S = 8000;

export class Momentum {
  private velocity: number;

  /** `velocity` in px/s, signed. */
  constructor(velocity: number) {
    this.velocity = Math.max(-MAX_FLING_PX_PER_S, Math.min(MAX_FLING_PX_PER_S, velocity));
  }

  get done(): boolean {
    return Math.abs(this.velocity) < REST_PX_PER_S;
  }

  /** The distance covered in the next `dtMs`, in px, signed. */
  step(dtMs: number): number {
    if (this.done) return 0;
    const decay = Math.exp(-dtMs / TIME_CONSTANT_MS);
    const distance = (this.velocity / 1000) * TIME_CONSTANT_MS * (1 - decay);
    this.velocity *= decay;
    return distance;
  }
}
