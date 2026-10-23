// Home (client-architecture.md §6.3, browser-behaviors.md "Home: Sessions"): the open tabs,
// a search over the host's sessions, and the creation actions. On a phone, Files is its second
// pane behind the bottom navigation, and fills the screen above it.
import { useRef, useState } from "preact/hooks";
import { useApp, useAppView } from "../../app/context";
import { Row } from "../../ui/primitives/Row";
import { SearchField } from "../../ui/primitives/TextField";
import { FilesScreen } from "../files/FilesScreen";
import { HostSessionLists } from "../sessions/HostSessionLists";
import { openWindow } from "../sessions/openWindow";
import { CreateDialog, type CreateParams } from "./CreateDialog";
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

  // The control that opened the creation dialog gets focus back on close (Safari leaves a clicked button unfocused).
  const opener = useRef<HTMLElement | null>(null);
  const create = (from: HTMLElement, name: "newSession" | "newWindow", params: CreateParams): void => {
    opener.current = from;
    app.router.openOverlay({ screen: "home", name, params });
  };

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
            onOpen={(h, listing, session, window) => { openWindow(app, h, listing, session, window); }}
            creation={{
              onNewSession: (h, el) => { create(el, "newSession", { handle: h.entry.handle }); },
              onNewWindow: (h, listing, session, el) => {
                create(el, "newWindow", { handle: h.entry.handle, session: { server: listing.server, session: session.id }, sessionName: session.name });
              },
            }}
          />
          <Row icon="settings" label="Settings" trailing="chevron" onClick={() => { app.router.openOverlay({ screen: "settings", name: "settings" }); }} />
        </div>
      </div>
      {phone && <HomeNav pane="sessions" />}
      <CreateDialog opener={opener} />
    </div>
  );
}
