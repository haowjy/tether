import type { Lifecycle } from "../types";

/** Page visibility and connectivity. A browser page is never locked. */
export function readLifecycle(): Lifecycle {
  return { visible: document.visibilityState === "visible", online: navigator.onLine, locked: false };
}

export function watchLifecycle(listener: (lifecycle: Lifecycle) => void): () => void {
  let last = JSON.stringify(readLifecycle());
  const changed = (): void => {
    const now = readLifecycle();
    const key = JSON.stringify(now);
    if (key === last) return;
    last = key;
    listener(now);
  };
  const events = [
    ["visibilitychange", document],
    ["pagehide", window],
    ["pageshow", window],
    ["online", window],
    ["offline", window],
  ] as const;
  for (const [name, target] of events) target.addEventListener(name, changed);
  return () => {
    for (const [name, target] of events) target.removeEventListener(name, changed);
  };
}
