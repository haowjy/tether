// Home's and the picker's binding to the controller's sessions cache.
import { useEffect, useState } from "preact/hooks";
import type { AppController } from "../../app/controller";
import type { SessionsCache, SessionsState } from "../../sessions/cache";

/** The cache's state, re-rendering on every change (a listing, a toggle). */
export function useSessions(app: AppController): { state: SessionsState; cache: SessionsCache } {
  const cache = app.sessions;
  const [, rerender] = useState(0);
  useEffect(() => {
    const off = cache.subscribe(() => { rerender((n) => n + 1); });
    rerender((n) => n + 1); // a change between render and subscription
    return off;
  }, [cache]);
  return { state: cache.snapshot, cache };
}

/** Expansion changes the saved workspace: hand it to storage. */
export function toggleExpanded(app: AppController, hostId: string, key: string): void {
  app.sessions.toggle(hostId, key);
  app.persist.save();
}

/** Retry on a stale or failed listing: updating again until the fetcher answers. */
export function retryListing(app: AppController, handle: string): void {
  app.sessions.expectFresh(handle);
  app.listing.refresh(handle);
}
