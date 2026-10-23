// Stub: W4 (PWA) owns this file. It builds the service worker entry (`/sw.js`), generates the
// precache list from the build, and injects the manifest link and the `theme-color` metas
// into index.html. Until then the build ships no worker.
import type { Plugin } from "vite";

export function serviceWorker(): Plugin {
  return { name: "tether-service-worker" };
}
