import type { AppController } from "../../app/controller";
import type { HostClient } from "../../net/hosts";
import type { SessionListing, TmuxListing } from "../../proto/generated/messages";

/** Opens the session's tab, or activates the one it already has, and shows Terminal. The tab shows whatever window tmux has current. */
export function openSession(app: AppController, host: HostClient, listing: TmuxListing, session: SessionListing): void {
  if (host.hostId === null) return; // a listing came from a welcomed socket, so the id is known
  app.dispatch({
    type: "opened",
    key: { host: host.hostId, session: { server: listing.server, session: session.id } },
    session: session.name,
    window: session.windows.find((w) => w.active)?.name ?? session.windows[0]?.name ?? "",
  });
}
