// The review entry: the real app on the test platform. Open
// `/harness/index.html?fixture=<name>&layout=phone|desktop&scheme=dark|light&density=touch|compact`, plus `&open` to open the saved active tab at launch (a clean launch shows Home).
// Served by Vite's dev server only; no production build includes it (the forbidTestModules plugin in vite.config.ts fails the build if one leaks).
import { render } from "preact";
import { App } from "../app/App";
import { AppProvider } from "../app/context";
import { AppController } from "../app/controller";
import { createTestPlatform, DESKTOP, PHONE, type TestPlatform } from "../platform/test";
import { applyViewport, trackInputKind } from "../ui/theme";
import "../ui/tokens/index.css";
import { fixtures } from "./index";

declare global {
  interface Window {
    /** The running app and its platform, for probes to drive and read. */
    __harness?: { platform: TestPlatform; app: AppController };
  }
}

const params = new URLSearchParams(location.search);
const fixture = fixtures[params.get("fixture") ?? "home"];
if (!fixture) throw new Error(`No harness fixture "${params.get("fixture") ?? ""}"`);

const base = params.get("layout") === "phone" ? PHONE : DESKTOP;
const viewport = {
  ...base,
  scheme: params.get("scheme") === "light" ? ("light" as const) : ("dark" as const),
  density: params.get("density") === "touch" ? ("touch" as const) : params.get("density") === "compact" ? ("compact" as const) : base.density,
  // The page is the size the browser gave it; the platform reports what the browser would.
  width: innerWidth,
  stableHeight: innerHeight,
  visibleHeight: innerHeight,
  keyboardInset: 0,
};
trackInputKind();
const platform = createTestPlatform({ viewport, ...fixture.options?.() });
fixture.daemon?.(platform.daemon);
const app = await AppController.start(platform, { fetchFn: platform.fetch, applyViewport });
window.__harness = { platform, app };
if ((fixture.openActive || params.has("open")) && app.snapshot.workspace.active) app.dispatch({ type: "activated", id: app.snapshot.workspace.active });

const root = document.getElementById("app");
if (!root) throw new Error("harness/index.html lacks #app");
const Replacement = fixture.render;
render(Replacement ? <AppProvider app={app}><Replacement /></AppProvider> : <App app={app} />, root);
