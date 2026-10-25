// Home (client-architecture.md §6.3, browser-behaviors.md "Home: Sessions"): the open tabs,
// a search over the host's sessions, and New session. On a phone, Files is its second
// pane behind the bottom navigation, and fills the screen above it.
import { useState } from "preact/hooks";
import { useApp, useAppView } from "../../app/context";
import { Row } from "../../ui/primitives/Row";
import { SearchField } from "../../ui/primitives/TextField";
import { FilesScreen } from "../files/FilesScreen";
import { HostSessionLists } from "../sessions/HostSessionLists";
import { openSession } from "../sessions/openSession";
import { HomeNav } from "./HomeNav";
import { OpenTabs } from "./OpenTabs";
import styles from "./Home.module.css";

export function Home({ pane }: { pane: "sessions" | "files" }) {
  if (pane === "files") {
    return (
      <div class={styles.home}>
        <FilesScreen />
        <HomeNav pane="files" />
      </div>
    );
  }
  return <Sessions />;
}

function Sessions() {
  const app = useApp();
  const hosts = useAppView((v) => v.hosts);
  const phone = useAppView((v) => v.viewport.layout === "phone");
  const [query, setQuery] = useState("");
  const host = hosts[0];
  const tone = !host || host.admission.kind === "unreachable" || host.admission.kind === "deciding" ? "reconnecting" : host.admission.kind === "admitted" ? "live" : "error";

  return (
    <div class={styles.home}>
      <header class={styles.header}>
        <h1 class={styles.brand}>tether</h1>
        {host && <span class={styles.host} data-tone={tone}>{host.name ?? "the server"}</span>}
      </header>
      <div class={styles.body}>
        <div class={styles.column}>
          <OpenTabs />
          <SearchField label="Find a session" placeholder="Find a session" value={query} onInput={setQuery} focusTarget="homeSearch" />
          <HostSessionLists
            query={query}
            onOpen={(h, listing, session) => { openSession(app, h, listing, session); }}
            creation={{ onNewSession: (h, el) => { app.openOverlay({ screen: "home", name: "newSession", params: { handle: h.entry.handle } }, el); } }}
          />
          <Row icon="settings" label="Settings" trailing="chevron" onClick={(e) => { app.openOverlay({ screen: "settings", name: "settings" }, e.currentTarget); }} />
        </div>
      </div>
      {phone && <HomeNav pane="sessions" />}
    </div>
  );
}
