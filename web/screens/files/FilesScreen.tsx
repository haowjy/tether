// Files: the screen of the active Files tab (its folder or preview), on every layout. The
// phone's dock holds its current-tab button, with no keyboard control: Files has no terminal
// input to raise.
import { useApp, useAppView } from "../../app/context";
import { Spinner } from "../../ui/primitives/Spinner";
import { activeTab } from "../../workspace/state";
import { CurrentTabButton } from "../terminal/dock/CurrentTabButton";
import { FilesPane } from "./FilesPane";
import { filesSession } from "./session";
import styles from "./FilesScreen.module.css";

export function FilesScreen() {
  const app = useApp();
  const tab = useAppView((v) => { const t = activeTab(v.workspace); return t?.kind === "files" ? t : null; });
  const host = useAppView((v) => v.hosts.find((h) => h.hostId === tab?.host));
  const dock = useAppView((v) => v.viewport.layout === "phone" && v.viewport.directInput !== "xterm");
  if (!tab) return null;
  return (
    <div class={styles.screen}>
      {host ? <FilesPane key={tab.id} session={filesSession(app, host)} tab={tab} /> : <Spinner label="Checking access" />}
      {dock && <div class={styles.dock}><CurrentTabButton /></div>}
    </div>
  );
}
