import { useAppView } from "../../app/context";
import { Spinner } from "../../ui/primitives/Spinner";
import { Enrol } from "../enrol/Enrol";
import { HostProblem } from "../enrol/HostProblem";
import { FilesScreen } from "../files/FilesScreen";
import { Home } from "../home/Home";
import { Picker } from "../picker/Picker";
import { Settings } from "../settings/Settings";
import { TerminalScreen } from "../terminal/TerminalScreen";
import { HostBanner } from "./HostBanner";
import { Rail } from "./Rail";
import styles from "./Shell.module.css";

/** The destination frame: the rail on desktop, and the screen for the route. Admission problems replace it. */
export function Shell() {
  const layout = useAppView((v) => v.viewport.layout);
  const destination = useAppView((v) => v.nav.destination);
  const hosts = useAppView((v) => v.hosts);
  const desktop = layout === "desktop";
  // The browser has one host; native may have several, each with its own banner.
  const blocking = hosts.find((h) => ["notEnrolled", "wrongOrigin", "originRefused", "nodeRefused", "incompatible"].includes(h.admission.kind) && h.entry.pageOrigin !== null);

  if (blocking) {
    return (
      <div class={styles.shell} data-layout={layout}>
        <main class={styles.screen}>{blocking.admission.kind === "notEnrolled" ? <Enrol host={blocking} /> : <HostProblem host={blocking} />}</main>
      </div>
    );
  }

  return (
    <div class={styles.shell} data-layout={layout}>
      {desktop && <Rail destination={destination} />}
      <div class={styles.column}>
        <div class={styles.banners}>{hosts.map((h) => <HostBanner key={h.entry.handle} host={h} />)}</div>
        <main class={styles.screen}>
          {hosts.length === 0 && <div class={styles.waiting}><Spinner label="Checking access" /></div>}
          {destination === "home" && <Home pane="sessions" />}
          {destination === "files" && (desktop ? <FilesScreen /> : <Home pane="files" />)}
          <TerminalScreen active={destination === "terminal"} />
        </main>
      </div>
      <Picker />
      <Settings />
    </div>
  );
}
