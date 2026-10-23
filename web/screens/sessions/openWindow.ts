import type { AppController } from "../../app/controller";
import type { HostClient } from "../../net/hosts";
import type { SessionListing, TmuxListing, WindowListing } from "../../proto/generated/messages";

/** Opens the window's tab, or activates the one it already has, and shows Terminal. */
export function openWindow(app: AppController, host: HostClient, listing: TmuxListing, session: SessionListing, window: WindowListing): void {
  if (host.hostId === null) return; // a listing came from a welcomed socket, so the id is known
  app.dispatch({
    type: "opened",
    key: { host: host.hostId, window: { server: listing.server, window: window.id } },
    session: session.name,
    window: window.name,
    index: window.index,
  });
}
