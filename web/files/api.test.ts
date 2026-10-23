import { describe, expect, it, vi } from "vitest";
import { HttpRefusal } from "../net/http";
import { encodePath, httpFsApi, rawPathOf } from "./api";
import { linkTarget } from "./render/markdown";

describe("paths in URLs", () => {
  it("encodes each segment and decodes back", () => {
    const path = "/home/j/my repo/#1?/ü.md";
    expect(encodePath(path)).toBe("/home/j/my%20repo/%231%3F/%C3%BC.md");
    expect(rawPathOf(`/fs/raw${encodePath(path)}`)).toBe(path);
    expect(encodePath("/")).toBe("/");
    expect(rawPathOf("/fs/list/x")).toBeNull();
  });
});

const response = (status: number, body: BodyInit | null, headers: Record<string, string> = {}): Response => new Response(body, { status, headers });

describe("httpFsApi", () => {
  it("builds routes on the host's origin", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(response(200, JSON.stringify({ path: "/", entries: [] }))));
    const api = httpFsApi("tether-app://h-dev", fetch);
    await api.list("/home/j/a b", 200, true);
    expect(fetch.mock.calls[0]?.[0]).toBe("tether-app://h-dev/fs/list/home/j/a%20b?offset=200&hidden=1");
    expect(api.rawUrl("/x/y.png")).toBe("tether-app://h-dev/fs/raw/x/y.png");
  });

  it("turns the daemon's JSON error into an HttpRefusal, and a dead network into `network`", async () => {
    const api = httpFsApi("o", () => Promise.resolve(response(403, JSON.stringify({ error: "outside_roots" }))));
    await expect(api.roots()).rejects.toEqual(new HttpRefusal(403, "outside_roots"));
    const down = httpFsApi("o", () => Promise.reject(new TypeError("Load failed")));
    await expect(down.roots()).rejects.toMatchObject({ code: "network" });
  });

  it("retries `busy` after Retry-After", async () => {
    vi.useFakeTimers();
    let n = 0;
    const api = httpFsApi("o", () => Promise.resolve(n++ === 0
      ? response(503, JSON.stringify({ error: "busy" }), { "Retry-After": "1" })
      : response(200, JSON.stringify({ home: "/h" }))));
    const roots = api.roots();
    await vi.advanceTimersByTimeAsync(1000);
    await expect(roots).resolves.toEqual({ home: "/h" });
    vi.useRealTimers();
  });

  it("reads a text preview with Range and says when it is cut", async () => {
    const api = httpFsApi("o", (_url, init) => {
      expect(new Headers(init?.headers).get("Range")).toBe("bytes=0-3");
      return Promise.resolve(response(206, "abcd", { "Content-Range": "bytes 0-3/10" }));
    });
    await expect(api.text("/f", 4)).resolves.toEqual({ text: "abcd", size: 10, truncated: true });
    const empty = httpFsApi("o", () => Promise.resolve(response(416, JSON.stringify({ error: "bad_range" }))));
    await expect(empty.text("/f", 4)).resolves.toEqual({ text: "", size: 0, truncated: false });
  });

  it("probes a directory as a directory", async () => {
    const api = httpFsApi("o", () => Promise.resolve(response(409, JSON.stringify({ error: "not_a_file" }))));
    await expect(api.probe("/d")).resolves.toEqual({ kind: "dir" });
  });
});

describe("Markdown links", () => {
  const doc = "tether-app://h-dev/fs/raw/home/j/repo/docs/README.md";
  it("resolves relative links against the document", () => {
    expect(linkTarget("../src/main.rs", doc)).toEqual({ kind: "path", path: "/home/j/repo/src/main.rs" });
    expect(linkTarget("img%20one.png", doc)).toEqual({ kind: "path", path: "/home/j/repo/docs/img one.png" });
  });
  it("sends the web out of the app and drops the rest", () => {
    expect(linkTarget("https://example.com/x", doc)).toEqual({ kind: "external", url: "https://example.com/x" });
    expect(linkTarget("javascript:alert(1)", doc)).toEqual({ kind: "none" });
    expect(linkTarget("#usage", doc)).toEqual({ kind: "none" });
    expect(linkTarget("../../../../../../etc", doc)).toEqual({ kind: "none" });
  });
});
