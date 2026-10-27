import { useApp, useAppView } from "../../app/context";
import { screenOf } from "../../workspace/state";
import { Spinner } from "../../ui/primitives/Spinner";
import { Enrol } from "../enrol/Enrol";
import { NoServers } from "../enrol/NoServers";
import { HostProblem } from "../enrol/HostProblem";
import { FilesScreen } from "../files/FilesScreen";
import { CreateDialog } from "../home/CreateDialog";
import { Home } from "../home/Home";
import { Picker } from "../sessions/Picker";
import { ServerSheet } from "../sessions/ServerSheet";
import { Sessions } from "../sessions/Sessions";
import { Settings } from "../settings/Settings";
import { TerminalScreen } from "../terminal/TerminalScreen";
import { AppBanners } from "./AppBanners";
import { HostBanner } from "./HostBanner";
import { TopRow } from "./TopRow";
import styles from "./Shell.module.css";

/** The frame: the top row where there is no dock, and the screen the route and the active tab show. Admission problems replace it. */
export function Shell() {
  const app = useApp();
  const layout = useAppView((v) => v.viewport.layout);
  const screen = useAppView((v) => screenOf(v.workspace));
  // Touch input ends in the dock (phone and iPad); a mouse keeps the top row, even in a narrow window.
  const topRow = useAppView((v) => v.viewport.layout === "desktop" || v.viewport.directInput === "xterm");
  const hosts = useAppView((v) => v.hosts);
  // An app with no server yet has nothing to wait for: it offers to add one.
  const noServers = hosts.length === 0 && app.platform.manageHosts !== undefined;
  // The browser has one host; native may have several, each with its own banner.
  const blocking = hosts.find((h) => ["notEnrolled", "wrongOrigin", "originRefused", "nodeRefused", "incompatible"].includes(h.admission.kind) && h.entry.pageOrigin !== null);

  // The terminal stays mounted, hidden, under an admission screen: its buffer and watches outlive it (§6.5).
  return (
    <div class={styles.shell} data-layout={layout}>
      <div class={styles.column}>
        {!blocking && topRow && <TopRow />}
        <div class={styles.banners}>
          <AppBanners />
          {!blocking && hosts.map((h) => <HostBanner key={h.entry.handle} host={h} />)}
        </div>
        <main class={styles.screen}>
          {blocking ? (
            blocking.admission.kind === "notEnrolled" ? <Enrol host={blocking} /> : <HostProblem host={blocking} />
          ) : (
            <>
              {hosts.length === 0 && !noServers && <div class={styles.waiting}><Spinner label="Checking access" /></div>}
              {noServers && <NoServers />}
              {!noServers && screen === "home" && <Home />}
              {!noServers && screen === "files" && <FilesScreen />}
            </>
          )}
          <TerminalScreen active={!blocking && screen === "terminal"} />
        </main>
      </div>
      {!blocking && (
        <>
          {/* Every sessions overlay name has its renderer here, whatever the layout. */}
          <Sessions />
          <Picker />
          <ServerSheet />
          {/* New session opens from Home and from the sessions overlay. */}
          <CreateDialog />
          <Settings />
        </>
      )}
    </div>
  );
}
