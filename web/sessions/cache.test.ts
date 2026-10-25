import { describe, expect, it, vi } from "vitest";
import type { TmuxListing } from "../proto/generated/messages";
import { classifyFailure, SessionsCache } from "./cache";

const listing = (...ids: number[]): TmuxListing => ({
  server: "main:1-1",
  version: "3.4",
  sessions: ids.map((id) => ({ id, name: `s${String(id)}`, windows: [{ id: id * 10, index: 0, name: "shell", active: true, activity: 0 }] })),
});

describe("SessionsCache", () => {
  it("is never listed until the first answer, then holds it", () => {
    const cache = new SessionsCache();
    expect(cache.snapshot.hosts["h1"]).toBeUndefined();
    cache.listed("h1", listing(1));
    expect(cache.snapshot.hosts["h1"]).toEqual({ listing: listing(1), failure: null, updating: false });
  });

  it("is updating from a requested listing until an answer, and keeps the cached rows meanwhile", () => {
    const cache = new SessionsCache();
    cache.listed("h1", listing(1));
    cache.requested("h1");
    expect(cache.snapshot.hosts["h1"]).toMatchObject({ listing: listing(1), updating: true });
    cache.listed("h1", listing(1, 2));
    expect(cache.snapshot.hosts["h1"]?.updating).toBe(false);
  });

  it("a failure marks the cached rows stale and a listing clears it", () => {
    const cache = new SessionsCache();
    cache.listed("h1", listing(1));
    cache.failed("h1", "timeout");
    expect(cache.snapshot.hosts["h1"]).toMatchObject({ listing: listing(1), failure: "offline" });
    cache.listed("h1", listing(1));
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
    cache.listed("h1", null);
    expect(cache.snapshot.hosts["h1"]?.listing).toBeNull();
  });

  it("tells subscribers once per change", () => {
    const cache = new SessionsCache();
    const seen = vi.fn();
    cache.subscribe(seen);
    cache.listed("h1", listing(1));
    cache.requested("h1");
    expect(seen).toHaveBeenCalledTimes(2);
  });
});
