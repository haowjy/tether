// The suggestion strip's client (complete.md "What the client does").
import type { Chip, CompleteRequest, Completion } from "../proto/generated/messages";

/** How long the line must stay unchanged before asking. */
const DEBOUNCE_MS = 100;

export type CompleteFn = (request: CompleteRequest, signal: AbortSignal) => Promise<Completion>;

/**
 * `POST /complete` on a host's HTTP origin, where native's scheme handler (or the dev
 * proxy) adds the token. Any refusal, `503 busy` included, is a failure: the strip waits
 * for the next change rather than retrying.
 */
export function httpComplete(origin: string): CompleteFn {
  return async (request, signal) => {
    const res = await fetch(`${origin}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal,
    });
    if (!res.ok) throw new Error(`complete: ${String(res.status)}`);
    return (await res.json()) as Completion;
  };
}

/**
 * Asks for chips as the line changes: 100 ms after the last change, aborting the request a
 * newer line supersedes. `onChips` gets null to hide the strip, or the chips to show; an
 * empty list keeps a shown strip in place while the next answer is on its way.
 *
 * Shown chips must stay true to the line, or a tap would type the wrong text: when the line
 * only grew by what a chip starts with, that chip stays with the typed part cut off; the
 * others go at once rather than at the answer.
 */
export class Suggester {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inflight: AbortController | null = null;
  private wanted: CompleteRequest | null = null;
  /** The chips on screen and the request they extend; null while the strip is hidden. */
  private shown: { chips: Chip[]; for: CompleteRequest } | null = null;

  constructor(private readonly onChips: (chips: readonly Chip[] | null) => void) {}

  /** The line, or null when there is none to complete. Asks only when it changed. */
  set(request: CompleteRequest | null, complete: CompleteFn | null): void {
    if (request && this.wanted && sameRequest(request, this.wanted)) return;
    clearTimeout(this.timer);
    this.inflight?.abort();
    this.inflight = null;
    this.wanted = request;
    if (!request || !complete) {
      this.show(null);
      return;
    }
    if (this.shown) this.show(narrow(this.shown, request));
    this.timer = setTimeout(() => { void this.ask(request, complete); }, DEBOUNCE_MS);
  }

  /** A chip was typed: its text is on the way, so the chips must already count it. */
  tapped(chip: Chip): void {
    if (!this.shown) return;
    const typed = { ...this.shown.for, before: this.shown.for.before + chip.insert };
    this.show(narrow(this.shown, typed));
  }

  private async ask(request: CompleteRequest, complete: CompleteFn): Promise<void> {
    const abort = new AbortController();
    this.inflight = abort;
    let chips: Chip[] | null;
    try {
      chips = (await complete(request, abort.signal)).chips;
    } catch {
      chips = null;
    }
    if (abort.signal.aborted || this.wanted !== request) return;
    this.inflight = null;
    this.show(chips?.length ? { chips, for: request } : null);
  }

  private show(shown: { chips: Chip[]; for: CompleteRequest } | null): void {
    this.shown = shown;
    this.onChips(shown?.chips ?? null);
  }
}

function sameRequest(a: CompleteRequest, b: CompleteRequest): boolean {
  return a.before === b.before && a.after === b.after && a.cwd === b.cwd;
}

/** The chips that still extend `next`, cut by what was typed since they were asked for. */
function narrow(shown: { chips: Chip[]; for: CompleteRequest }, next: CompleteRequest): { chips: Chip[]; for: CompleteRequest } {
  const base = shown.for;
  if (next.after !== base.after || next.cwd !== base.cwd || !next.before.startsWith(base.before)) return { chips: [], for: next };
  const typed = next.before.slice(base.before.length);
  const chips = shown.chips
    .filter((chip) => chip.insert.length > typed.length && chip.insert.startsWith(typed))
    .map((chip) => ({ ...chip, insert: chip.insert.slice(typed.length) }));
  return { chips, for: next };
}
