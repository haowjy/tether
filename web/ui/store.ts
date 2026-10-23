import { useEffect, useState } from "preact/hooks";

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

  protected update(patch: Partial<T>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
}

/** Renders again whenever `store` changes. */
export function useStore<T extends object>(store: Store<T>): T {
  const [, rerender] = useState(0);
  const rendered = store.snapshot;
  useEffect(() => {
    const off = store.subscribe(() => { rerender((n) => n + 1); });
    // A change between this render and the subscription (a fetch that settled first) would be missed.
    if (store.snapshot !== rendered) rerender((n) => n + 1);
    return off;
  }, [store]);
  return rendered;
}
