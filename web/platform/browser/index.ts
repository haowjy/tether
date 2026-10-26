// Assembles the browser Platform from one file per capability (client-architecture.md
// §3.2). Only main.tsx imports this. The browser holds no credential and has no dev mode.
import { createBrowserStorage } from "./storage";
import { createBrowserTransport } from "./transport";
import { createBrowserUploads } from "./uploads";
import { createBrowserViewport } from "./viewport";
import { readLifecycle, watchLifecycle } from "./lifecycle";
import { clipboard } from "./clipboard";
import { canOpenApp, openInApp, openURL } from "./links";
import { createPwa } from "./pwa";
import { restart } from "./restart";
import type { Platform, PlatformEvent } from "../types";

export function createBrowserPlatform(): Platform {
  const listeners = new Set<(event: PlatformEvent) => void>();
  const emit = (event: PlatformEvent): void => {
    for (const l of [...listeners]) l(event);
  };
  const viewport = createBrowserViewport();
  const storage = createBrowserStorage();
  let started = false;
  const start = (): void => {
    if (started) return;
    started = true;
    viewport.watch((v) => { emit({ type: "viewport", viewport: v }); });
    watchLifecycle((lifecycle) => { emit({ type: "lifecycle", lifecycle }); });
    storage.start(emit);
  };

  return {
    async boot() {
      const workspace = await storage.loadWorkspace();
      start();
      return {
        hosts: [{ handle: "browser", hostId: null, name: null, pageOrigin: location.origin }],
        workspace,
        viewport: viewport.read(),
        lifecycle: readLifecycle(),
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    transport: createBrowserTransport(),
    // app/focus.ts already moved DOM focus in the same dispatch; there is no native side.
    input: { setFocus: () => undefined, setLineFieldRect: () => undefined, setActiveTab: () => undefined },
    storage: storage.storage,
    uploads: createBrowserUploads(),
    clipboard,
    openURL,
    ...(canOpenApp() && { openInApp }),
    playVideo: () => "inline",
    haptic: () => undefined,
    restart,
    ...createPwa(emit),
  };
}
