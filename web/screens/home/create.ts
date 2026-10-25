// Creation (client-architecture.md §6.3 "Creation"). A new session is `newSession` over the
// host's one socket, then its tab, opened from the next listing: the `created` reply has refs,
// not names. A new window is created through its tab (`Terminals.newWindow`): the daemon makes
// it the session's current window and the tab follows it, so nothing is opened.
import type { AppController } from "../../app/controller";
import { RequestError } from "../../net/host";
import type { HostClient } from "../../net/hosts";
import type { SessionRef } from "../../proto/generated/messages";
import { newSessionMsg, type CreationFields } from "../../sessions/creation";
import { findSession } from "../../sessions/groups";
import { openSession } from "../sessions/openSession";
import { terminalsOf } from "../terminal/terminals";

const LISTING_WAIT_MS = 5_000;

/** A session to create, or a window to create in the session the tab `tab` follows. */
export type Target = { kind: "session" } | { kind: "window"; tab: string };

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

/** Resolves with the session once a listing holds it, or null after a few seconds. */
function listingWith(app: AppController, host: HostClient, ref: SessionRef): Promise<ReturnType<typeof findSession> | null> {
  const cache = app.sessions;
  const { handle } = host.entry;
  const found = () => {
    const listing = cache.snapshot.hosts[handle]?.listing;
    return listing ? findSession(listing, ref) : undefined;
  };
  return new Promise((resolve) => {
    const done = (value: ReturnType<typeof findSession> | null): void => {
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

/** Creates the session and opens its tab, or creates the window and shows it. Every overlay closes first, the switcher's too. */
export async function createAndOpen(app: AppController, host: HostClient, target: Target, fields: CreationFields): Promise<CreateResult> {
  const hostName = host.name ?? "the server";
  if (target.kind === "window") {
    try {
      await terminalsOf(app).newWindow(target.tab, fields);
    } catch (error) {
      return { error: failureText(error, hostName) };
    }
    app.router.closeAllOverlays();
    return { ok: true };
  }
  let created;
  try {
    created = await host.socket.request(
      (req) => newSessionMsg(req, fields),
      (reply) => (reply.type === "created" ? reply.data : undefined),
    );
  } catch (error) {
    return { error: failureText(error, hostName) };
  }
  const hit = await listingWith(app, host, created.session);
  const listing = app.sessions.snapshot.hosts[host.entry.handle]?.listing;
  if (!hit || !listing) return { error: "Created, but it hasn't appeared in the list yet. Close this to see the list." };
  app.router.closeAllOverlays(() => { openSession(app, host, listing, hit); });
  return { ok: true };
}
