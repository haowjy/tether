import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { buildShell, buildsDir, startShellServer, type ShellServer } from "./shell-server";

// The built bundle (a salted production build, e2e/pwa/vite.build.config.ts) served by a
// stand-in for the daemon's shell, on the real browser adapter and the real service worker.
// What needs the daemon itself and Tailscale Serve (install from a second enrolled machine)
// is listed in web/README.md.

test.describe.configure({ mode: "serial" });

let server: ShellServer;
let builds: Record<"h1" | "h2" | "h3", string>;

test.beforeAll(({}, testInfo) => {
  // Each project builds into its own directory: the two run in parallel.
  const root = buildsDir(testInfo.project.name);
  builds = { h1: buildShell(join(root, "h1"), "h1"), h2: buildShell(join(root, "h2"), "h2"), h3: buildShell(join(root, "h3"), "h3") };
});

test.beforeEach(async () => {
  server = await startShellServer(builds.h1);
});

test.afterEach(async () => {
  await server.stop();
});

/** The cache a build's worker fills, named from the hash defined in its sw.js. */
function cacheOf(dir: string): string {
  const hash = /[`"']([0-9a-f]{12})[`"']/u.exec(readFileSync(join(dir, "sw.js"), "utf8"))?.[1];
  if (!hash) throw new Error(`no build hash in ${dir}/sw.js`);
  return `tether-shell-${hash}`;
}

/** A hashed file only this build has: its entry script. */
function entryOf(dir: string): string {
  const file = readdirSync(join(dir, "assets")).find((f) => /^index-.*\.js$/u.test(f));
  if (!file) throw new Error(`no entry script in ${dir}`);
  return `/assets/${file}`;
}

/** Loads Home, waits for the worker to activate, and reloads so the worker controls the page. */
async function openControlled(page: Page): Promise<void> {
  await page.goto(`${server.origin}/`);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.reload();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await expect(page.getByRole("heading", { name: "tether" })).toBeVisible();
}

/** What a page's launch-time check or a visibility check does: look for a new sw.js. */
const lookForUpdate = (page: Page): Promise<void> => page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())?.update(); });

const cacheNames = (page: Page): Promise<string[]> => page.evaluate(async () => (await caches.keys()).sort());

const putDraft = (page: Page, id: string, text: string): Promise<void> =>
  page.evaluate(
    ([key, value]) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("tether");
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("drafts", "readwrite");
          tx.objectStore("drafts").put({ text: value }, key);
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => { reject(tx.error ?? new Error("put failed")); };
        };
        open.onerror = () => { reject(open.error ?? new Error("open failed")); };
      }),
    [id, text] as const,
  );

const readDraft = (page: Page, id: string): Promise<unknown> =>
  page.evaluate(
    (key) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open("tether");
        open.onsuccess = () => {
          const db = open.result;
          const get = db.transaction("drafts").objectStore("drafts").get(key);
          get.onsuccess = () => { db.close(); resolve(get.result); };
          get.onerror = () => { reject(get.error ?? new Error("get failed")); };
        };
        open.onerror = () => { reject(open.error ?? new Error("open failed")); };
      }),
    id,
  );

const status = (page: Page, path: string): Promise<number> => page.evaluate(async (p) => (await fetch(p)).status, path);

test("installs on the first visit, launches offline from the cache, and caches no API response", async ({ page }) => {
  await openControlled(page);
  expect(await cacheNames(page)).toEqual([cacheOf(builds.h1), "tether-meta"].sort());

  // Only shell files: nothing from /auth (which the page fetched), /ws, /fs or /complete.
  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) for (const request of await (await caches.open(name)).keys()) urls.push(new URL(request.url).pathname);
    return urls;
  });
  expect(cached).toContain("/");
  expect(cached).toContain("/manifest.webmanifest");
  expect(cached.filter((p) => !/^(\/|\/active|\/manifest\.webmanifest|\/apple-touch-icon\.png|\/favicon\.ico|\/icons\/.+|\/assets\/.+)$/u.test(p))).toEqual([]);
  expect(server.requests).toContain("/auth/info");

  // Offline launch: the daemon is gone, so only the worker can answer the page.
  await server.stop();
  await page.reload();
  await expect(page.getByRole("heading", { name: "tether" })).toBeVisible();
  await expect(page.getByText(/Can.t reach/).first()).toBeVisible();
});

test("an update takes over only the page that tapped it; the others keep their build, drafts and chunks", async ({ page, context, browserName }) => {
  const other = await context.newPage();
  await openControlled(page);
  await other.goto(`${server.origin}/`);
  await expect(other.getByRole("heading", { name: "tether" })).toBeVisible();
  await expect.poll(() => other.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  for (const p of [page, other]) {
    await p.evaluate(() => { (window as unknown as { marker: string }).marker = "still here"; });
    await putDraft(p, "draft", `unsaved in ${p === page ? "A" : "B"}`);
  }

  server.use(builds.h2);
  await lookForUpdate(page);
  for (const p of [page, other]) await expect(p.getByText("Update ready")).toBeVisible();
  // Nothing reloaded, and nothing activated yet: h1 still serves both pages.
  expect(await cacheNames(page)).toEqual([cacheOf(builds.h1), cacheOf(builds.h2), "tether-meta"].sort());

  await page.getByRole("button", { name: "Update" }).click();
  // The tapping page reloads onto h2; its marker is gone.
  await expect(page.locator(`script[src="${entryOf(builds.h2)}"]`)).toHaveCount(1);
  expect(await page.evaluate(() => (window as unknown as { marker?: string }).marker)).toBeUndefined();
  await expect(page.getByText("Update ready")).toBeHidden();

  // The other page was not touched: same page, same draft, and a banner offering the reload.
  await expect(other.getByText("Reload to finish updating")).toBeVisible();
  expect(await other.evaluate(() => (window as unknown as { marker?: string }).marker)).toBe("still here");
  expect(await readDraft(other, "draft")).toEqual({ text: "unsaved in B" });
  expect(await cacheNames(other)).toEqual([cacheOf(builds.h1), cacheOf(builds.h2), "tether-meta"].sort());

  // After the worker has been idle long enough to be stopped, B's next chunk (h1's entry) is still found.
  if (browserName === "chromium") {
    const cdp = await context.newCDPSession(other);
    await cdp.send("ServiceWorker.enable");
    await cdp.send("ServiceWorker.stopAllWorkers");
  }
  expect(await status(other, entryOf(builds.h1))).toBe(200);
  expect(await status(other, entryOf(builds.h2))).toBe(200);
});

test("two updates in a row: the page two builds behind misses its chunks, and only the last two builds stay cached", async ({ page, context }) => {
  const newer = await context.newPage();
  await openControlled(page);
  await newer.goto(`${server.origin}/`);
  await expect(newer.getByRole("heading", { name: "tether" })).toBeVisible();
  expect(await status(page, entryOf(builds.h1))).toBe(200);

  for (const next of [builds.h2, builds.h3]) {
    server.use(next);
    await lookForUpdate(newer);
    await newer.getByRole("button", { name: "Update" }).click();
    await expect(newer.locator(`script[src="${entryOf(next)}"]`)).toHaveCount(1);
  }

  // h1's page: its entry script is in no cache any more, so a lazy chunk of h1 would miss.
  expect(await status(page, entryOf(builds.h1))).toBe(404);
  expect(await cacheNames(page)).toEqual([cacheOf(builds.h2), cacheOf(builds.h3), "tether-meta"].sort());
  await expect(page.getByText("Reload to finish updating")).toBeVisible();
});

test("a schema upgrade from another page closes this page's database, keeps its draft, and is not held up", async ({ page, context }) => {
  await openControlled(page);
  await putDraft(page, "draft", "keep me");
  const upgrader = await context.newPage();
  await upgrader.goto(`${server.origin}/manifest.webmanifest`);
  const outcome = await upgrader.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const open = indexedDB.open("tether", 2);
        // `blocked` fires while the old page still holds its connection; what matters is that it lets go.
        open.onupgradeneeded = () => { resolve("upgrading"); };
        open.onerror = () => { resolve("error"); };
      }),
  );
  expect(outcome).toBe("upgrading");
  await expect(page.getByText("Reload to finish updating")).toBeVisible();
  expect(await readDraft(upgrader, "draft")).toEqual({ text: "keep me" });
});
