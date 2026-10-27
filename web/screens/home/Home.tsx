// Home (client-architecture.md §6.3, browser-behaviors.md "Home"): the open tabs, a search over
// the host's sessions, and Files and New session beside each host's list.
import { useState } from "preact/hooks";
import { useApp, useAppView } from "../../app/context";
import { Row } from "../../ui/primitives/Row";
import { SearchField } from "../../ui/primitives/TextField";
import { HostSessionLists } from "../sessions/HostSessionLists";
import { NewActions } from "../sessions/NewActions";
import { now } from "../sessions/SessionPicks";
import { openSession } from "../sessions/openSession";
import { OpenTabs } from "./OpenTabs";
import styles from "./Home.module.css";

export function Home() {
  const app = useApp();
  const hosts = useAppView((v) => v.hosts);
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
          />
          <div><NewActions host={host} commit={now} /></div>
          <Row icon="settings" label="Settings" trailing="chevron" onClick={(e) => { app.openOverlay({ screen: "settings", name: "settings" }, e.currentTarget); }} />
        </div>
      </div>
    </div>
  );
}
