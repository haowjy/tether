// `updates` and `install` for the browser (client-architecture.md §9.3). The service worker
// is registered after the page's `load`, so it never competes with first paint. A new build
// installs and waits; `apply()` is the tap that lets it take over. Screens see only the
// capability and the `update` events.
import { restart } from "./restart";
import type { Platform, PlatformEvent, UpdateState } from "../types";

/** How long `apply()` waits for a build that is still installing or activating before it reloads anyway. */
const INSTALL_WAIT_MS = 15_000;

/** Resolves when `worker` reaches `state` (or is discarded), or after {@link INSTALL_WAIT_MS}. */
function reached(worker: ServiceWorker, state: "installed" | "activated"): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => { clearTimeout(timer); worker.removeEventListener("statechange", onChange); resolve(); };
    const onChange = (): void => { if (worker.state === state || worker.state === "redundant") done(); };
    const timer = setTimeout(done, INSTALL_WAIT_MS);
    worker.addEventListener("statechange", onChange);
    onChange();
  });
}

export function createPwa(emit: (event: PlatformEvent) => void): Pick<Platform, "updates" | "install"> {
  const install: Platform["install"] = {
    installed: () => matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true,
  };
  // The dev server builds no worker; a browser without one gets no `updates` at all.
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return { install };

  const container = navigator.serviceWorker;
  let state: UpdateState = "none";
  let applying = false;
  const set = (next: UpdateState, force = false): void => {
    if (next === state && !force) return;
    state = next;
    emit({ type: "update", state });
  };

  const registration = new Promise<ServiceWorkerRegistration | null>((resolve) => {
    const register = (): void => {
      container.register("/sw.js", { scope: "/" }).then(
        (reg) => {
          const sync = (): void => { if (reg.waiting && state === "none") set("ready"); };
          reg.addEventListener("updatefound", () => { reg.installing?.addEventListener("statechange", sync); });
          sync();
          resolve(reg);
        },
        () => { resolve(null); },
      );
    };
    if (document.readyState === "complete") register();
    else addEventListener("load", register, { once: true });
  });

  // Another page's Update activates the new worker under this one. No claim: this page keeps
  // its build and offers a reload; the page that tapped reloads at once.
  let hadController = container.controller !== null;
  container.addEventListener("controllerchange", () => {
    if (applying) restart("update");
    else if (hadController) set("reload");
    hadController = true;
  });

  // The worker saw the daemon answer 404 for a file of this page's build (sw.ts): a lazy chunk is gone.
  container.addEventListener("message", (event: MessageEvent) => {
    if ((event.data as { type?: unknown } | null)?.type === "buildGone") set("required");
  });

  return {
    install,
    updates: {
      async check() {
        const reg = await registration;
        if (!reg) return;
        // A repeat of the current state, in case it was reached before anyone listened.
        set(state, true);
        await reg.update();
        if (reg.waiting && state === "none") set("ready");
      },
      apply() {
        void (async () => {
          let reg = await registration;
          if (reg && !reg.waiting) {
            await reg.update().catch(() => undefined);
            if (reg.installing) await reached(reg.installing, "installed");
            reg = await registration;
          }
          if (!reg?.waiting) {
            restart("update");
            return;
          }
          applying = true;
          const worker = reg.waiting;
          worker.postMessage({ type: "skipWaiting" });
          // A hard-reloaded page has no controller, so `controllerchange` never fires for it.
          if (container.controller === null) {
            await reached(worker, "activated");
            restart("update");
          }
        })();
      },
    },
  };
}
