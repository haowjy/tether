// A stand-in for the daemon's shell: serves a built `dist` with the daemon's cache headers
// (hashed assets immutable, everything else `no-cache` with an ETag, as src/http/shell.rs
// does), a fake `/auth`, and no `/ws`. The build it serves can change while a page is open,
// which is how the update gates ship a new version.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

/** Builds the production bundle into `out`, its chunks salted so `salt` makes a different build. Returns `out`. */
export function buildShell(out: string, salt: string): string {
  mkdirSync(dirname(out), { recursive: true });
  const run = spawnSync("pnpm", ["exec", "vite", "build", "--configLoader", "runner", "-c", "e2e/pwa/vite.build.config.ts", "--logLevel", "error"], {
    cwd: WEB,
    env: { ...process.env, NODE_ENV: "production", TETHER_E2E_SALT: salt, TETHER_E2E_OUT: out },
    encoding: "utf8",
  });
  if (run.status !== 0) throw new Error(`build ${salt} failed:\n${run.stdout}\n${run.stderr}`);
  return out;
}

export const buildsDir = (project: string): string => join(process.env["TMPDIR"] ?? tmpdir(), "tether-w4", project);

export interface ShellServer {
  origin: string;
  /** Serve this build from now on. */
  use(dir: string): void;
  /** Every `GET` path served, newest last. */
  requests: string[];
  /** Answer the next `n` requests for asset files with `503 Retry-After: 1`. */
  busy(n: number): void;
  stop(): Promise<void>;
  start(): Promise<void>;
}

export async function startShellServer(first: string): Promise<ShellServer> {
  let dir = first;
  let busy = 0;
  const requests: string[] = [];
  let server: Server;
  let port = 0;

  function send(req: IncomingMessage, res: ServerResponse): void {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    requests.push(path);
    const json = (body: unknown, status = 200): void => {
      res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
    };
    if (path === "/auth/info") {
      json({ hostId: "h-pwa", name: "pop-os", daemonVersion: "0", protocol: { min: 1, max: 2 }, browserOrigin: `http://localhost:${String(port)}`, browserRefused: null });
      return;
    }
    if (path === "/auth/node/session") {
      json({ deviceName: "laptop" });
      return;
    }
    const file = path === "/" ? "index.html" : path.slice(1);
    const abs = join(dir, file);
    let bytes: Buffer;
    try {
      if (!abs.startsWith(dir) || !statSync(abs).isFile() || file.startsWith(".vite/")) throw new Error("no");
      bytes = readFileSync(abs);
    } catch {
      res.writeHead(404).end();
      return;
    }
    // Only `fetch()` calls (the worker precaching) are refused, not the page loading its own scripts.
    if (busy > 0 && path.startsWith("/assets/") && req.headers["sec-fetch-dest"] === "empty") {
      busy--;
      res.writeHead(503, { "Retry-After": "1" }).end();
      return;
    }
    const versioned = path.startsWith("/assets/") && /-/u.test(path.split("/").pop() ?? "");
    const etag = `"${createHash("sha256").update(bytes).digest("hex")}"`;
    if (!versioned && req.headers["if-none-match"] === etag) {
      res.writeHead(304, { "Cache-Control": "no-cache", ETag: etag }).end();
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[extname(file)] ?? "application/octet-stream",
      "Cache-Control": versioned ? "public, max-age=31536000, immutable" : "no-cache",
      ...(versioned ? {} : { ETag: etag }),
    }).end(bytes);
  }

  async function start(): Promise<void> {
    server = createServer(send);
    server.on("upgrade", (_req, socket) => { socket.destroy(); });
    await new Promise<void>((resolveListen) => { server.listen(port, "localhost", resolveListen); });
    port = (server.address() as AddressInfo).port;
  }
  await start();
  return {
    get origin() { return `http://localhost:${String(port)}`; },
    use: (next) => { dir = next; },
    requests,
    busy: (n) => { busy = n; },
    start,
    stop: () => new Promise<void>((resolveStop) => { server.closeAllConnections(); server.close(() => { resolveStop(); }); }),
  };
}
