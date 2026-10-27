import { useApp, useAppView } from "../../app/context";
import { Banner } from "../../ui/primitives/Banner";
import { screenOf } from "../../workspace/state";

/** App-wide notices: a schema upgrade waiting on a reload, and a new version waiting on a tap, an update another page applied, a page whose version the host no longer has, and the offer to open this host in the tether app. */
export function AppBanners() {
  const app = useApp();
  const storageClosed = useAppView((v) => v.storageClosed);
  const update = useAppView((v) => v.update);
  const appOffer = useAppView((v) => v.appOffer);
  const onTerminal = useAppView((v) => screenOf(v.workspace) === "terminal");
  return (
    <>
      {(storageClosed || update === "reload") && !onTerminal && (
        <Banner tone="warning" title="Reload to finish updating" action={{ label: "Reload", onAction: () => { app.platform.restart("update"); } }}>
          {storageClosed ? "Changes since then are kept in memory and won't survive a reload." : undefined}
        </Banner>
      )}
      {/* These banners show on Home and Files, never over the terminal: in flow they would shrink the stable box and resize tmux. */}
      {update === "ready" && !onTerminal && (
        <Banner title="Update ready" action={{ label: "Update", onAction: () => { app.applyUpdate(); } }} />
      )}
      {update === "required" && !onTerminal && (
        <Banner tone="warning" title="Update required" action={{ label: "Reload", onAction: () => { app.applyUpdate(); } }} />
      )}
      {appOffer && !onTerminal && (
        <Banner title="Open in the tether app" action={{ label: "Open", onAction: () => { app.platform.openInApp?.(appOffer, app.enrolCode); } }} onDismiss={() => { app.dismissAppOffer(); }}>
          If it does not open, add {appOffer} in the app with no code.
        </Banner>
      )}
    </>
  );
}
