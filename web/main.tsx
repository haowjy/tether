import { render } from "preact";
import { App } from "./app/app";
import { Chrome } from "./app/Chrome";
import { BRIDGE_VERSION, hasNativeBridge, installReceiver, Native, webkitPost } from "./native/bridge";
import type { NativeMsg } from "./native/bridge";
import { createXtermRenderer } from "./term";

async function start(): Promise<void> {
  const terminal = document.getElementById("terminal");
  const chrome = document.getElementById("chrome");
  if (!terminal || !chrome) throw new Error("index.html lacks #terminal or #chrome");

  const native = hasNativeBridge()
    ? new Native(webkitPost)
    : import.meta.env.DEV
      ? new Native((await import("./dev/shim")).createDevShim())
      : new Native(webkitPost);

  // Registered before `ready`, so nothing native sends right after boot is missed.
  // Native's first batch can predate the app; `boot` carries the same state, so it is dropped.
  const shown: { app?: App } = {};
  installReceiver((msg: NativeMsg) => { shown.app?.receive(msg); }, () => {
    const tab = shown.app?.activeTab();
    return { host: tab?.host ?? "", tab: tab?.id ?? "" };
  });

  const boot = await native.boot();
  if (boot.bridgeVersion !== BRIDGE_VERSION) {
    chrome.textContent = `Bridge version mismatch: web ${String(BRIDGE_VERSION)}, native ${String(boot.bridgeVersion)}. Rebuild both.`;
    return;
  }
  const app = new App({
    native,
    boot,
    renderer: createXtermRenderer(terminal),
    kind: hasNativeBridge() ? "ios" : "web",
    chromeHeight: () => chrome.offsetHeight,
  });
  shown.app = app;
  render(<Chrome app={app} />, chrome);
}

void start();
