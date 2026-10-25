import { useApp, useAppView } from "../../app/context";
import { Banner } from "../../ui/primitives/Banner";

/** App-wide notices: a schema upgrade waiting on a reload, and a new version waiting on a tap, and an update another page applied. */
export function AppBanners() {
  const app = useApp();
  const storageClosed = useAppView((v) => v.storageClosed);
  const update = useAppView((v) => v.update);
  const destination = useAppView((v) => v.nav.destination);
  return (
    <>
      {(storageClosed || update === "reload") && destination !== "terminal" && (
        <Banner tone="warning" title="Reload to finish updating" action={{ label: "Reload", onAction: () => { app.platform.restart("update"); } }}>
          {storageClosed ? "Changes since then are kept in memory and won't survive a reload." : undefined}
        </Banner>
      )}
      {/* These banners show on Home and Files, never over the terminal: in flow they would shrink the stable box and resize tmux. */}
      {update === "ready" && destination !== "terminal" && (
        <Banner title="Update ready" action={{ label: "Update", onAction: () => { app.applyUpdate(); } }} />
      )}
    </>
  );
}
