import { expect, test, type Page } from "@playwright/test";

// The production entry (`/`, main.tsx) on the real browser adapter, with only the daemon faked
// at the network: `/auth/*` by route, `/ws` by a scripted WebSocket. The real transport,
// real admission, real viewport and real IndexedDB run.
// The harness server playwright.config.ts starts: the same port variable.
const ORIGIN = `http://localhost:${process.env["TETHER_E2E_PORT"] ?? "5199"}`;
const INFO = { hostId: "h-real", name: "pop-os", daemonVersion: "0", protocol: { min: 1, max: 1 }, browserOrigin: ORIGIN, browserRefused: null };

async function fakeDaemon(page: Page, node: { enrolled: boolean }): Promise<{ hellos: unknown[] }> {
  const seen = { hellos: [] as unknown[] };
  await page.route("**/auth/info", (route) => route.fulfill({ json: INFO }));
  await page.route("**/auth/node/session", (route) =>
    node.enrolled ? route.fulfill({ json: { deviceName: "laptop" } }) : route.fulfill({ status: 401, json: { error: "not_enrolled", node: { name: "laptop" } } }),
  );
  await page.route("**/auth/node/enroll", (route) => {
    node.enrolled = true;
    return route.fulfill({ json: { deviceName: "laptop" } });
  });
  await page.routeWebSocket("**/ws", (ws) => {
    ws.onMessage((raw) => {
      const msg = JSON.parse(String(raw)) as { type: string; data?: { req?: number } };
      seen.hellos.push(msg);
      if (msg.type === "hello") ws.send(JSON.stringify({ type: "welcome", data: { protocol: 1, daemon: { version: "0", completion: false }, host: { id: "h-real", name: "pop-os" } } }));
      if (msg.type === "listSessions") ws.send(JSON.stringify({ type: "sessions", data: { req: msg.data?.req, tmux: null } }));
    });
  });
  return seen;
}

test("admits an enrolled node, opens /ws as a web client, and reads the viewport", async ({ page }) => {
  const seen = await fakeDaemon(page, { enrolled: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "tether" })).toBeVisible();
  await expect(page.getByText("pop-os").first()).toBeVisible();
  await expect.poll(() => seen.hellos.length).toBeGreaterThan(0);
  expect(seen.hellos[0]).toMatchObject({ type: "hello", data: { client: { kind: "web" } } });
  const html = await page.evaluate(() => Object.fromEntries(Object.entries(document.documentElement.dataset)));
  expect(html["layout"]).toBe("desktop");
  expect(html["scheme"]).toMatch(/^(dark|light)$/);
  // The browser adapter opened its database, and holds no credential in storage.
  expect(await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name))).toContain("tether");
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
});

test("enrols through the real client: code, device name, then Home", async ({ page }) => {
  await fakeDaemon(page, { enrolled: false });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Set up pop-os" })).toBeVisible();
  await page.getByLabel("Code").fill("123456");
  await page.getByRole("button", { name: "Enrol this device" }).click();
  await expect(page.getByRole("heading", { name: "tether" })).toBeVisible();
});

test("a page at another origin than the daemon's canonical one says where to go and opens no socket", async ({ page }) => {
  const seen = await fakeDaemon(page, { enrolled: true });
  await page.route("**/auth/info", (route) => route.fulfill({ json: { ...INFO, browserOrigin: "https://pop-os.tail.ts.net" } }));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Open tether at https://pop-os.tail.ts.net" })).toBeVisible();
  expect(seen.hellos).toEqual([]);
});

test("the phone layout is chosen by min(width, height), and density by the pointer", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 852, height: 393 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await fakeDaemon(page, { enrolled: true });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "tether" })).toBeVisible();
  // A landscape phone stays in the phone layout.
  expect(await page.evaluate(() => document.documentElement.dataset["layout"])).toBe("phone");
  expect(await page.evaluate(() => document.documentElement.dataset["density"])).toBe("touch");
  await context.close();
});
