import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppController } from "../../app/controller";
import type { HistoryPort } from "../../app/router";
import { createTestPlatform } from "../../platform/test";
import { filesSession } from "./session";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

const history: HistoryPort = { current: () => ({ state: null, hash: "#/tab" }), push: () => undefined, replace: () => undefined, go: () => undefined, onPop: () => () => undefined };

it("names the host once /auth/info has answered, however early the session was made", async () => {
  const platform = createTestPlatform();
  const app = await AppController.start(platform, { fetchFn: platform.fetch, history });
  const host = app.snapshot.hosts[0];
  if (!host) throw new Error("no host");
  const session = filesSession(app, host);
  expect(session.hostName).toBe("the server");
  await vi.advanceTimersByTimeAsync(0);
  expect(session.hostName).toBe("pop-os");
});
