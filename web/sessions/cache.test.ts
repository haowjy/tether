import { describe, expect, it, vi } from "vitest";
import type { TmuxListing } from "../proto/generated/messages";
import { classifyFailure, SessionsCache } from "./cache";
import { sessionKey } from "./groups";

const listing = (...ids: number[]): TmuxListing => ({
  server: "main:1-1",
  version: "3.4",
  sessions: ids.map((id) => ({ id, name: `s${String(id)}`, attachedElsewhere: false, windows: [{ id: id * 10, index: 0, name: "shell", active: true, activity: 0 }] })),
});
const key = (id: number) => sessionKey("main:1-1", (listing(id).sessions[0] as TmuxListing["sessions"][number]));

describe("SessionsCache", () => {
  it("is never listed until the first answer, then holds it", () => {
    const cache = new SessionsCache();
    expect(cache.snapshot.hosts["h1"]).toBeUndefined();
    cache.listed("h1", listing(1), "h-pop");
    expect(cache.snapshot.hosts["h1"]).toEqual({ listing: listing(1), failure: null, updating: false });
  });

  it("is updating from a requested listing until an answer, and keeps the cached rows meanwhile", () => {
    const cache = new SessionsCache();
    cache.listed("h1", listing(1), null);
    cache.requested("h1");
    expect(cache.snapshot.hosts["h1"]).toMatchObject({ listing: listing(1), updating: true });
    cache.listed("h1", listing(1, 2), null);
    expect(cache.snapshot.hosts["h1"]?.updating).toBe(false);
  });

  it("a failure marks the cached rows stale and a listing clears it", () => {
    const cache = new SessionsCache();
    cache.listed("h1", listing(1), null);
    cache.failed("h1", "timeout");
    expect(cache.snapshot.hosts["h1"]).toMatchObject({ listing: listing(1), failure: "offline" });
    cache.listed("h1", listing(1), null);
    expect(cache.snapshot.hosts["h1"]?.failure).toBeNull();
  });

  it("tells a daemon refusal from a network failure, and ignores busy and background", () => {
    expect([classifyFailure("lost"), classifyFailure("timeout"), classifyFailure("tmux"), classifyFailure("unauthorized")]).toEqual(["offline", "offline", "refused", "refused"]);
    const cache = new SessionsCache();
    cache.requested("h1");
    cache.failed("h1", "busy");
    cache.failed("h1", "background");
    expect(cache.snapshot.hosts["h1"]).toEqual({ listing: undefined, failure: null, updating: true });
  });

  it("keeps a null listing (no tmux server) distinct from never listed", () => {
    const cache = new SessionsCache();
    cache.listed("h1", null, null);
    expect(cache.snapshot.hosts["h1"]?.listing).toBeNull();
  });

  it("applies a rename to the cached window", () => {
    const cache = new SessionsCache();
    cache.listed("h1", listing(1), null);
    cache.renamed("h1", { server: "main:1-1", window: 10 }, "agent");
    expect(cache.snapshot.hosts["h1"]?.listing?.sessions[0]?.windows[0]?.name).toBe("agent");
    // Another run's window id is not this window.
    cache.renamed("h1", { server: "main:9-9", window: 10 }, "other");
    expect(cache.snapshot.hosts["h1"]?.listing?.sessions[0]?.windows[0]?.name).toBe("agent");
  });

  it("toggles expansion per host and saves it", () => {
    const cache = new SessionsCache();
    cache.toggle("h-pop", key(1));
    cache.toggle("h-pop", key(2));
    cache.toggle("h-pop", key(1));
    expect(cache.saved()).toEqual({ "h-pop": [key(2)] });
    cache.toggle("h-pop", key(2));
    expect(cache.saved()).toEqual({});
  });

  it("restores saved expansion, and drops sessions a listing no longer has", () => {
    const cache = new SessionsCache({ "h-pop": [key(1), key(2), "main:0-0/7"] });
    expect(cache.snapshot.expanded["h-pop"]?.has(key(2))).toBe(true);
    cache.listed("h1", listing(2, 3), "h-pop");
    expect(cache.saved()).toEqual({ "h-pop": [key(2)] });
  });

  it("a null listing decides nothing about expansion", () => {
    const cache = new SessionsCache({ "h-pop": [key(1)] });
    cache.listed("h1", null, "h-pop");
    expect(cache.saved()).toEqual({ "h-pop": [key(1)] });
  });

  it("tells subscribers once per change", () => {
    const cache = new SessionsCache();
    const seen = vi.fn();
    cache.subscribe(seen);
    cache.listed("h1", listing(1), null);
    cache.toggle("h", "k");
    expect(seen).toHaveBeenCalledTimes(2);
  });
});
