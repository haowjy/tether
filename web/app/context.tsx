import { createContext, type ComponentChildren } from "preact";
import { useContext } from "preact/hooks";
import { FocusContext } from "../ui/focus";
import { useStore } from "../ui/store";
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

/** A slice of the app's view state (viewport, workspace, navigation, hosts), re-rendering only when that slice changes. */
export function useAppView<S>(select: (view: AppView) => S, equal?: (a: S, b: S) => boolean): S {
  return useStore(useApp(), select, equal);
}
