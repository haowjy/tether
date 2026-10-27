import { createContext, type ComponentChildren } from "preact";
import { useContext } from "preact/hooks";
import { FocusContext } from "../ui/focus";
import { useStore } from "../ui/store";
import { tabLabels, type TabLabel } from "../workspace/labels";
import type { AppController, AppView } from "./controller";

const AppContext = createContext<AppController | null>(null);

/** Provides the controller, and its focus controller to the primitives. */
export function AppProvider({ app, children }: { app: AppController; children: ComponentChildren }) {
  return (
    <AppContext.Provider value={app}>
      <FocusContext.Provider value={app.focus}>{children}</FocusContext.Provider>
    </AppContext.Provider>
  );
}

/**
 * Everything a screen reaches the app through: the platform, the host registry, the router,
 * the focus controller, persist now, the listing fetcher, and `dispatch` for the workspace.
 * A screen's own logic lives in the screen or its core and calls through this.
 */
export function useApp(): AppController {
  const app = useContext(AppContext);
  if (!app) throw new Error("useApp() outside <AppProvider>");
  return app;
}

/** Whether the overlay `screen` (and `name`, when given) is open, with its params and the way to close it. */
export function useOverlay(screen: string, name?: string): { open: boolean; params: Record<string, unknown> | undefined; close: () => void } {
  const app = useApp();
  const overlay = useAppView((v) => v.entry.overlay);
  const shown = overlay?.screen === screen && (name === undefined || overlay.name === name) ? overlay : null;
  return { open: shown !== null, params: shown?.params, close: () => { app.router.closeOverlay(); } };
}

/** A slice of the app's view state (viewport, workspace, navigation, hosts), re-rendering only when that slice changes. */
export function useAppView<S>(select: (view: AppView) => S, equal?: (a: S, b: S) => boolean): S {
  return useStore(useApp(), select, equal);
}

/** A host's name for a host id, falling back to the id while the host is unknown. */
export function useHostName(): (hostId: string) => string {
  const hosts = useAppView((v) => v.hosts);
  return (hostId) => hosts.find((h) => h.hostId === hostId)?.name ?? hostId;
}

/** The open tabs' labels, one place for every pill, chip and list that names a tab. */
export function useTabLabels(): TabLabel[] {
  const tabs = useAppView((v) => v.workspace.tabs);
  return tabLabels(tabs, useHostName());
}
