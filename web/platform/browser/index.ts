// Assembles the browser Platform from one file per capability (client-architecture.md
// §3.2). Only main.tsx imports this. The browser holds no credential and has no dev mode.
import { createBrowserStorage } from "./storage";
import { createBrowserTransport } from "./transport";
import { createBrowserUploads } from "./uploads";
import { createBrowserPreferences } from "./preferences";
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
  const preferences = createBrowserPreferences();
  const viewport = createBrowserViewport(() => preferences.read().appearance);
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
        preferences: preferences.read(),
        lifecycle: readLifecycle(),
        focusMode: null,
        lineSnapshot: null,
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    transport: createBrowserTransport(),
    setPreference(name, value) {
      preferences.set(name, value);
      emit({ type: "preferences", preferences: preferences.read() });
      viewport.check();
    },
    // app/focus.ts already moved DOM focus in the same dispatch; there is no native side.
    input: {
      setFocus: () => undefined,
      setLine: () => Promise.resolve(0),
      setLineCaret: () => undefined,
      stepLineCaret: () => undefined,
      insertLine: () => undefined,
      submitLine: () => undefined,
      selectAllLine: () => undefined,
      setArmedModifier: () => undefined,
      setActiveTab: () => undefined,
    },
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
