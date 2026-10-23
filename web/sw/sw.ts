// The service worker serves the shell from cache and nothing else (client-architecture.md
// §9.2). It precaches the whole build and never touches /ws, /auth, /fs, /complete or any
// non-GET. A new version installs, then waits: the page's Update button sends `skipWaiting`.
// Built as /sw.js by sw/vite-plugin.ts, which defines the two constants below.

declare const __BUILD__: string;
declare const __PRECACHE__: readonly string[];

// Typed as the worker scope; lib has WebWorker, whose `self` is the generic scope.
const sw = self as unknown as ServiceWorkerGlobalScope;

const PREFIX = "tether-shell-";
const CACHE = `${PREFIX}${__BUILD__}`;
/** One entry, `/active`, holds the hash of the build whose worker last activated. */
const META = "tether-meta";
const ACTIVE = "/active";

/** The daemon serves 4 shell files at once and queues 16 more (src/http/shell.rs). */
const PARALLEL = 4;
const RETRIES = 3;
const MAX_RETRY_DELAY_MS = 10_000;

const hashed = (path: string): boolean => path.startsWith("/assets/");

function isShellPath(path: string): boolean {
  return hashed(path) || path.startsWith("/icons/") || path === "/manifest.webmanifest" || path === "/apple-touch-icon.png" || path === "/favicon.ico";
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

async function fetchShellFile(path: string): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(new Request(path, { cache: "reload" }));
    if (response.ok) return response;
    if (response.status !== 503 || attempt >= RETRIES) throw new Error(`${path}: ${String(response.status)}`);
    const seconds = Number(response.headers.get("Retry-After"));
    await sleep(Math.min(Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 1000, MAX_RETRY_DELAY_MS));
  }
}

/** Hashed assets never change, so an update copies the ones an older cache has and fetches the rest. */
async function precache(): Promise<void> {
  const cache = await caches.open(CACHE);
  const older = await Promise.all((await caches.keys()).filter((n) => n.startsWith(PREFIX) && n !== CACHE).map((n) => caches.open(n)));
  const queue = [...__PRECACHE__];
  const worker = async (): Promise<void> => {
    for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
      if (hashed(path)) {
        const copy = (await Promise.all(older.map((c) => c.match(path)))).find((r) => r !== undefined);
        if (copy) {
          await cache.put(path, copy);
          continue;
        }
      }
      await cache.put(path, await fetchShellFile(path));
    }
  };
  try {
    await Promise.all(Array.from({ length: PARALLEL }, worker));
  } catch (error) {
    // A half-filled cache would be kept as "the replaced build" if it later activated; it never does.
    await caches.delete(CACHE);
    throw error;
  }
}

/** Keeps this build and the one it replaced; every other shell cache goes. */
async function activate(): Promise<void> {
  const meta = await caches.open(META);
  const previous = await (await meta.match(ACTIVE))?.text();
  const keep = new Set([CACHE, previous === undefined ? "" : `${PREFIX}${previous}`]);
  await Promise.all((await caches.keys()).filter((n) => n.startsWith(PREFIX) && !keep.has(n)).map((n) => caches.delete(n)));
  await meta.put(ACTIVE, new Response(__BUILD__));
}

/**
 * The own build's copy wins; a page one build behind finds its own chunks in the other cache.
 * A file in neither (an evicted cache) goes to the network, which has the current build's.
 */
async function fromCache(request: Request): Promise<Response> {
  const own = await (await caches.open(CACHE)).match(request);
  return own ?? (await caches.match(request)) ?? fetch(request);
}

sw.addEventListener("install", (event) => {
  event.waitUntil(precache());
});

sw.addEventListener("activate", (event) => {
  event.waitUntil(activate());
});

sw.addEventListener("message", (event) => {
  if ((event.data as { type?: unknown } | null)?.type === "skipWaiting") void sw.skipWaiting();
});

sw.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== sw.location.origin) return;
  if (request.mode === "navigate" && (url.pathname === "/" || url.pathname === "/index.html")) {
    // The worker's version is the page's version; the network is only for an empty cache.
    event.respondWith(
      caches.open(CACHE).then((cache) => cache.match("/")).then((cached) => cached ?? fetch(request)),
    );
  } else if (isShellPath(url.pathname)) {
    event.respondWith(fromCache(request));
  }
});
