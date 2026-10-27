import { expect, test, type Page } from "@playwright/test";

// The production entry on the real browser adapter, with only the daemon faked at the network:
// the real hidden file input and upload queue (platform/browser/uploads.ts) and the real /fs client.
const ORIGIN = `http://localhost:${process.env["TETHER_E2E_PORT"] ?? "5199"}`;
const INFO = { hostId: "h-real", name: "pop-os", daemonVersion: "0", protocol: { min: 2, max: 2 }, browserOrigin: ORIGIN, browserRefused: null };
const ROOTS = {
  home: "/home/jimmy",
  roots: [{ path: "/home/jimmy/tether", canonical: "/home/jimmy/tether", ok: true }],
  uploadsDir: { path: "~/tether-uploads", canonical: "/home/jimmy/tether-uploads", ok: true },
};

interface Daemon {
  /** Uploads the daemon has begun and not answered, in order. */
  pending: { name: string; answer: (status: number, body: unknown) => Promise<void> }[];
  /** The most requests in flight at once. */
  mostAtOnce: number;
  names: string[];
}

async function fakeDaemon(page: Page): Promise<Daemon> {
  const daemon: Daemon = { pending: [], mostAtOnce: 0, names: [] };
  await page.route("**/auth/info", (route) => route.fulfill({ json: INFO }));
  await page.route("**/auth/node/session", (route) => route.fulfill({ json: { deviceName: "laptop" } }));
  await page.routeWebSocket("**/ws", (ws) => {
    ws.onMessage((raw) => {
      const msg = JSON.parse(String(raw)) as { type: string; data?: { req?: number } };
      if (msg.type === "hello") ws.send(JSON.stringify({ type: "welcome", data: { protocol: 1, daemon: { version: "0", completion: false }, host: { id: "h-real", name: "pop-os" } } }));
      if (msg.type === "listSessions") ws.send(JSON.stringify({ type: "sessions", data: { req: msg.data?.req, tmux: null } }));
    });
  });
  await page.route("**/fs/roots", (route) => route.fulfill({ json: ROOTS }));
  await page.route("**/fs/upload?*", (route) => {
    const name = new URL(route.request().url()).searchParams.get("name") ?? "";
    daemon.names.push(name);
    return new Promise<void>((resolve) => {
      daemon.pending.push({
        name,
        answer: async (status, body) => {
          await route.fulfill({ status, json: body });
          resolve();
        },
      });
      daemon.mostAtOnce = Math.max(daemon.mostAtOnce, daemon.pending.length);
    });
  });
  return daemon;
}

const file = (name: string) => ({ name, mimeType: "text/plain", buffer: Buffer.from(name) });

test("uploads go one at a time, four at most, and a fifth is refused", async ({ page }) => {
  const daemon = await fakeDaemon(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: "Files", exact: true }).click(); // Home's Files opens a new Files tab at the roots
  await expect(page.getByRole("button", { name: "~/tether", exact: true })).toBeVisible();

  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Upload", exact: true }).click()]);
  await chooser.setFiles(["a.txt", "b.txt", "c.txt", "d.txt", "e.txt"].map(file));

  const uploads = page.getByRole("list", { name: "Uploads" });
  await expect(uploads.getByRole("alert")).toHaveText("Wait for the current uploads to finish");
  await expect(uploads.getByRole("listitem")).toHaveCount(5);
  // Only the first is on the wire.
  await expect.poll(() => daemon.pending.length).toBe(1);
  expect(daemon.names).toEqual(["a.txt"]);

  for (const [i, name] of ["a.txt", "b.txt", "c.txt", "d.txt"].entries()) {
    await expect.poll(() => daemon.pending.length).toBe(1);
    expect(daemon.pending[0]?.name).toBe(name);
    const [done] = daemon.pending.splice(0, 1);
    await done?.answer(201, { path: `/home/jimmy/tether-uploads/2026-${name}`, size: name.length });
    await expect(uploads.getByText(`Saved 2026-${name}`)).toBeVisible();
    expect(await uploads.getByText(/^Saved /).count()).toBe(i + 1);
  }
  expect(daemon.names).toEqual(["a.txt", "b.txt", "c.txt", "d.txt"]);
  expect(daemon.mostAtOnce).toBe(1);
  // With no terminal tab open, the offer says why it can't be taken.
  await expect(uploads.getByRole("button", { name: "Insert path" }).first()).toHaveAccessibleDescription("Open a terminal tab first");

  // The queue is free again.
  const [again] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Upload", exact: true }).click()]);
  await again.setFiles([file("f.txt")]);
  await expect.poll(() => daemon.pending.length).toBe(1);
});

test("a refusal from the daemon is shown in words, and the picker's cancel leaves nothing behind", async ({ page }) => {
  const daemon = await fakeDaemon(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: "Files", exact: true }).click(); // Home's Files opens a new Files tab at the roots
  await expect(page.getByRole("button", { name: "~/tether", exact: true })).toBeVisible();

  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Upload", exact: true }).click()]);
  await chooser.setFiles([file("big.bin")]);
  await expect.poll(() => daemon.pending.length).toBe(1);
  await daemon.pending[0]?.answer(413, { error: "too_large" });
  await expect(page.getByRole("alert")).toHaveText("That file is over the 128 MiB limit");
  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByRole("list", { name: "Uploads" })).toHaveCount(0);

  const [cancelled] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Upload", exact: true }).click()]);
  await cancelled.setFiles([]);
  await expect(page.getByRole("list", { name: "Uploads" })).toHaveCount(0);
});
