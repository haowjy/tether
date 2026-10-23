import { useEffect, useRef, useState } from "preact/hooks";

/** A controller's state for the views: a snapshot replaced on every change, and who to tell. */
export class Store<T extends object> {
  private readonly listeners = new Set<() => void>();

  constructor(private state: T) {}

  get snapshot(): T {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Replaces what changed; a patch that changes nothing tells no one. */
  protected update(patch: Partial<T>): void {
    const changed = (Object.keys(patch) as (keyof T)[]).some((key) => !Object.is(patch[key], this.state[key]));
    if (!changed) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
}

/**
 * Renders again when what `select` picks from `store` changes by `equal` (identity by
 * default), not on every change: a view takes the slice it draws.
 */
export function useStore<T extends object, S>(store: Store<T>, select: (state: T) => S, equal: (a: S, b: S) => boolean = Object.is): S {
  const [, rerender] = useState(0);
  const selected = select(store.snapshot);
  const latest = useRef({ selected, select, equal });
  latest.current = { selected, select, equal };
  useEffect(() => {
    const check = (): void => {
      const { selected: rendered, select: pick, equal: same } = latest.current;
      if (!same(rendered, pick(store.snapshot))) rerender((n) => n + 1);
    };
    const off = store.subscribe(check);
    // A change between this render and the subscription (a fetch that settled first) would be missed.
    check();
    return off;
  }, [store]);
  return selected;
}
