// Creation (client-architecture.md §6.3): `newSession` or `newWindow` over the host's one
// socket, then the new window's tab. The `created` reply has refs, not names, so the tab is
// opened from the next listing: the one fetcher answers, and the cache holds it.
import type { AppController } from "../../app/controller";
import { RequestError } from "../../net/host";
import type { HostClient } from "../../net/hosts";
import type { SessionRef, WindowRef } from "../../proto/generated/messages";
import { newSessionMsg, newWindowMsg, type CreationFields } from "../../sessions/creation";
import { findWindow } from "../../sessions/groups";
import { openWindow } from "./openWindow";
import { closeOverlayThen } from "./overlay";

const LISTING_WAIT_MS = 5_000;

export type Target = { kind: "session" } | { kind: "window"; session: SessionRef };

export type CreateResult = { ok: true } | { error: string };

/** The daemon's own words for a refusal it explains; ours for a request that got no answer. */
function failureText(error: unknown, hostName: string): string {
  if (!(error instanceof RequestError)) return "Couldn't create it. Try again.";
  switch (error.reason) {
    case "busy":
      return "tether is busy, try again";
    case "lost":
    case "timeout":
    case "background":
      return `Couldn't reach ${hostName}. Try again.`;
    default:
      return error.message;
  }
}

/** Resolves with the window once a listing holds it, or null after a few seconds. */
function listingWith(app: AppController, host: HostClient, ref: WindowRef): Promise<ReturnType<typeof findWindow> | null> {
  const cache = app.sessions;
  const { handle } = host.entry;
  const found = () => {
    const listing = cache.snapshot.hosts[handle]?.listing;
    return listing ? findWindow(listing, ref) : undefined;
  };
  return new Promise((resolve) => {
    const done = (value: ReturnType<typeof findWindow> | null): void => {
      clearTimeout(timer);
      off();
      resolve(value);
    };
    const timer = setTimeout(() => { done(null); }, LISTING_WAIT_MS);
    const off = cache.subscribe(() => {
      const hit = found();
      if (hit) done(hit);
    });
    const now = found();
    if (now) done(now);
    else app.listing.refresh(handle);
  });
}

/** Creates the session or window, then opens its tab and shows Terminal. The overlay closes first. */
export async function createAndOpen(app: AppController, host: HostClient, target: Target, fields: CreationFields): Promise<CreateResult> {
  const hostName = host.name ?? "the server";
  let created;
  try {
    created = await host.socket.request(
      (req) => (target.kind === "session" ? newSessionMsg(req, fields) : newWindowMsg(req, target.session, fields)),
      (reply) => (reply.type === "created" ? reply.data : undefined),
    );
  } catch (error) {
    return { error: failureText(error, hostName) };
  }
  const hit = await listingWith(app, host, created.window);
  const listing = app.sessions.snapshot.hosts[host.entry.handle]?.listing;
  if (!hit || !listing) return { error: "Created, but it hasn't appeared in the list yet. Close this to see the list." };
  closeOverlayThen(app, () => { openWindow(app, host, listing, hit.session, hit.window); });
  return { ok: true };
}
