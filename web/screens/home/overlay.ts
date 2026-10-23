import type { AppController } from "../../app/controller";

/**
 * Closes the open overlay, then runs `then`. Closing is `history.back()`, which lands on a
 * later `popstate`: a tab activation that navigates first would push its entry before the
 * pop, and the pop would undo it (client-architecture.md §6.6).
 */
export function closeOverlayThen(app: AppController, then: () => void): void {
  if (app.router.entry.overlay === null) {
    then();
    return;
  }
  const off = app.router.subscribe(({ entry }) => {
    if (entry.overlay !== null) return;
    off();
    then();
  });
  app.router.closeOverlay();
}
