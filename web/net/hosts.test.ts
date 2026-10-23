import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestPlatform, type TestPlatform } from "../platform/test";
import type { TabPort } from "./host";
import { HostRegistry } from "./hosts";

const port: TabPort = { linkUp: () => undefined, linkLost: () => undefined, paused: () => undefined, message: () => undefined, frame: () => undefined };

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

async function boot(edit: (p: TestPlatform) => void = () => undefined, options: Parameters<typeof createTestPlatform>[0] = {}) {
  const platform = createTestPlatform(options);
  edit(platform);
  const stuck: string[] = [];
  const registry = new HostRegistry({ transport: platform.transport, fetchFn: platform.fetch, onStuck: () => stuck.push("stuck"), random: () => 0.5 });
  const { hosts, lifecycle } = await platform.boot();
  registry.setLifecycle(lifecycle);
  registry.set(hosts);
  await vi.advanceTimersByTimeAsync(0);
  const host = () => registry.all()[0];
  return { platform, registry, host, stuck };
}

describe("admission, read from the daemon at launch", () => {
  it("admits an enrolled node and learns the host id", async () => {
    const t = await boot();
    expect(t.host()?.admission).toEqual({ kind: "admitted" });
    expect(t.host()).toMatchObject({ hostId: "h-pop", name: "pop-os" });
    expect(t.platform.daemon.requests).toEqual(["GET /auth/info", "GET /auth/node/session"]);
  });

  it("opens a socket only for an admitted host", async () => {
    const t = await boot();
    t.host()?.socket.join(port);
    expect(t.platform.links).toHaveLength(1);
    const refused = await boot((p) => { if (p.daemon.info !== "down") p.daemon.info = { ...p.daemon.info, browserOrigin: "https://elsewhere" }; });
    refused.host()?.socket.join(port);
    expect(refused.host()?.admission).toEqual({ kind: "wrongOrigin", origin: "https://elsewhere" });
    expect(refused.platform.links).toHaveLength(0);
    expect(refused.platform.daemon.requests).toEqual(["GET /auth/info"]);
  });

  it("says why a browser can't use the host", async () => {
    const t = await boot((p) => { if (p.daemon.info !== "down") p.daemon.info = { ...p.daemon.info, browserOrigin: null, browserRefused: "not_https" }; });
    expect(t.host()?.admission).toEqual({ kind: "originRefused", reason: "not_https" });
  });

  it("never retries a node the daemon refuses", async () => {
    const t = await boot((p) => { p.daemon.node = "refused"; p.daemon.refusedReason = "shared"; });
    expect(t.host()?.admission).toEqual({ kind: "nodeRefused", reason: "shared" });
    const seen = t.platform.daemon.requests.length;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(t.platform.daemon.requests).toHaveLength(seen);
  });

  it("keeps deciding with the host's backoff until the daemon can answer", async () => {
    const t = await boot((p) => { p.daemon.node = "busy"; });
    expect(t.host()?.admission).toEqual({ kind: "deciding" });
    expect(t.host()?.checkingSince).not.toBeNull();
    t.platform.daemon.node = "enrolled";
    await vi.advanceTimersByTimeAsync(500);
    expect(t.host()?.admission).toEqual({ kind: "admitted" });
    expect(t.host()?.checkingSince).toBeNull();
  });

  it("reports an unreachable host and checks again when the network returns", async () => {
    const t = await boot((p) => { p.daemon.info = "down"; });
    expect(t.host()?.admission).toEqual({ kind: "unreachable" });
    t.platform.daemon.info = defaultInfo();
    t.registry.setLifecycle({ visible: true, online: false, locked: false });
    t.registry.setLifecycle({ visible: true, online: true, locked: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(t.host()?.admission).toEqual({ kind: "admitted" });
  });

  it("calls a protocol outside the daemon's range incompatible, and stays", async () => {
    const t = await boot((p) => { if (p.daemon.info !== "down") p.daemon.info = { ...p.daemon.info, protocol: { min: 2, max: 2 } }; });
    expect(t.host()?.admission).toEqual({ kind: "incompatible" });
  });
});

function defaultInfo() {
  return createTestPlatform().daemon.info;
}

describe("enrolment", () => {
  it("takes the Enrol screen's code, refuses a wrong one, and admits after the right one", async () => {
    const t = await boot((p) => { p.daemon.node = "notEnrolled"; p.daemon.nodeName = "laptop"; });
    expect(t.host()?.admission).toEqual({ kind: "notEnrolled", nodeName: "laptop" });
    expect(await t.registry.enrol("h1", "000000", "laptop")).toEqual({ kind: "badCode" });
    expect(t.host()?.admission.kind).toBe("notEnrolled");
    expect(await t.registry.enrol("h1", "123456", "my laptop")).toEqual({ kind: "enrolled" });
    await vi.advanceTimersByTimeAsync(0);
    expect(t.host()?.admission).toEqual({ kind: "admitted" });
  });

  it("reports a busy daemon as tryAgain, and a refused node on the refusal screen", async () => {
    const busy = await boot((p) => { p.daemon.node = "busy"; });
    expect(await busy.registry.enrol("h1", "123456", "x")).toEqual({ kind: "tryAgain" });
    const refused = await boot((p) => { p.daemon.node = "notEnrolled"; });
    refused.platform.daemon.node = "refused";
    expect(await refused.registry.enrol("h1", "123456", "x")).toEqual({ kind: "nodeRefused", reason: "routes" });
    expect(refused.host()?.admission).toEqual({ kind: "nodeRefused", reason: "routes" });
  });

  it("removes this device: sockets close, and admission reads notEnrolled", async () => {
    const t = await boot();
    t.host()?.socket.join(port);
    expect(await t.registry.removeDevice("h1")).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.platform.links[0]?.closed).toBe(true);
    expect(t.host()?.admission).toEqual({ kind: "notEnrolled", nodeName: "laptop" });
  });
});

describe("a socket closing with 4401", () => {
  it("asks the session route why instead of assuming notEnrolled", async () => {
    const t = await boot();
    t.host()?.socket.join(port);
    t.platform.daemon.node = "refused";
    t.platform.links[0]?.drop(4401);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.host()?.admission).toEqual({ kind: "nodeRefused", reason: "routes" });
  });

  it("is a refused token for a host with no page origin", async () => {
    const t = await boot(undefined, { hosts: [{ handle: "h1", hostId: "h-pop", name: "pop-os", pageOrigin: null }] });
    expect(t.host()?.admission).toEqual({ kind: "admitted" });
    expect(t.platform.daemon.requests).toEqual([]);
    t.host()?.socket.join(port);
    t.platform.links[0]?.drop(4401);
    expect(t.host()?.admission).toEqual({ kind: "notEnrolled", nodeName: null });
  });
});

describe("sockets follow the lifecycle", () => {
  it("closes when hidden and reconnects when visible again", async () => {
    const t = await boot();
    t.host()?.socket.join(port);
    await vi.advanceTimersByTimeAsync(0);
    t.registry.setLifecycle({ visible: false, online: true, locked: false });
    expect(t.platform.links[0]?.closed).toBe(true);
    t.registry.setLifecycle({ visible: true, online: true, locked: false });
    expect(t.platform.links).toHaveLength(2);
  });

  it("stays closed while locked", async () => {
    const t = await boot();
    t.host()?.socket.join(port);
    t.registry.setLifecycle({ visible: true, online: true, locked: true });
    expect(t.platform.links[0]?.closed).toBe(true);
    t.registry.setLifecycle({ visible: true, online: true, locked: false });
    expect(t.platform.links).toHaveLength(2);
  });
});
