import { AppProvider, useAppView } from "./context";
import type { AppController } from "./controller";
import { Banner } from "../ui/primitives/Banner";
import { Toast } from "../ui/primitives/Toast";
import { Shell } from "../screens/shell/Shell";
import { useApp } from "./context";

/** App-wide notices: a schema upgrade waiting on a reload, and a new version waiting on a tap. */
function AppBanners() {
  const app = useApp();
  const storageClosed = useAppView((v) => v.storageClosed);
  const update = useAppView((v) => v.update);
  const destination = useAppView((v) => v.nav.destination);
  return (
    <>
      {storageClosed && (
        <Banner tone="warning" title="Reload to finish updating" action={{ label: "Reload", onAction: () => { app.platform.restart("update"); } }}>
          Changes since then are kept in memory and won't survive a reload.
        </Banner>
      )}
      {/* "Update ready" shows on Home and Files, never over the terminal. */}
      {update === "ready" && destination !== "terminal" && (
        <Banner title="Update ready" action={{ label: "Update", onAction: () => { app.applyUpdate(); } }} />
      )}
    </>
  );
}

function Notices() {
  const app = useApp();
  const notice = useAppView((v) => v.notice);
  return <Toast message={notice} onDismiss={() => { app.dismissNotice(); }} />;
}

export function App({ app }: { app: AppController }) {
  return (
    <AppProvider app={app}>
      <AppBanners />
      <Shell />
      <Notices />
    </AppProvider>
  );
}
