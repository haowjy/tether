// Home (client-architecture.md §6.3, browser-behaviors.md "Home: Sessions"): the open tabs,
// a search over the host's sessions, and the creation actions. On a phone, Files is its second
// pane behind the bottom navigation, and fills the screen above it.
import { useEffect, useRef, useState } from "preact/hooks";
import { useApp, useAppView } from "../../app/context";
import { tabId } from "../../platform/tabKey";
import { Row } from "../../ui/primitives/Row";
import { SearchField } from "../../ui/primitives/TextField";
import { FilesScreen } from "../files/FilesScreen";
import { CreateDialog, type CreateParams } from "./CreateDialog";
import { HomeNav } from "./HomeNav";
import { OpenTabs } from "./OpenTabs";
import { SessionList } from "./SessionList";
import { openWindow } from "./openWindow";
import { retryListing, toggleExpanded, useSessions } from "./useSessions";
import styles from "./Home.module.css";

/** Hosts whose sessions can be listed or are about to be; the others show a banner or the Enrol screen instead. */
const LISTABLE = new Set(["admitted", "deciding", "unreachable"]);

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
  const workspace = useAppView((v) => v.workspace);
  const phone = useAppView((v) => v.viewport.layout === "phone");
  const { state } = useSessions(app);
  const [query, setQuery] = useState("");
  const host = hosts[0];
  const tone = !host || host.admission.kind === "unreachable" || host.admission.kind === "deciding" ? "reconnecting" : host.admission.kind === "admitted" ? "live" : "error";
  const open = new Set(workspace.tabs.map((t) => t.id));

  // Entering Home: show the cached rows at once, quietly "Updating" until the listing answers.
  useEffect(() => {
    for (const h of app.hosts.all()) app.sessions.expectFresh(h.entry.handle);
  }, [app]);

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
          {hosts.filter((h) => LISTABLE.has(h.admission.kind)).map((h) => {
            const handle = h.entry.handle;
            return (
              <SessionList
                key={handle}
                hostName={h.name ?? "the server"}
                unreachable={h.admission.kind === "unreachable"}
                sessions={state.hosts[handle]}
                expanded={(h.hostId !== null && state.expanded[h.hostId]) || NONE}
                query={query}
                isOpen={(w) => {
                  const listing = state.hosts[handle]?.listing;
                  return h.hostId !== null && listing != null && open.has(tabId({ host: h.hostId, window: { server: listing.server, window: w.id } }));
                }}
                onToggle={(key) => { if (h.hostId !== null) toggleExpanded(app, h.hostId, key); }}
                onOpen={(listing, session, window) => { openWindow(app, h, listing, session, window); }}
                onRetry={() => { if (h.admission.kind === "unreachable") app.hosts.recheck(handle); else retryListing(app, handle); }}
                creation={{
                  onNewSession: (el) => { create(el, "newSession", { handle }); },
                  onNewWindow: (session, el) => {
                    const listing = state.hosts[handle]?.listing;
                    if (listing) create(el, "newWindow", { handle, session: { server: listing.server, session: session.id }, sessionName: session.name });
                  },
                }}
              />
            );
          })}
          <Row icon="settings" label="Settings" trailing="chevron" onClick={() => { app.router.openOverlay({ screen: "settings", name: "settings" }); }} />
        </div>
      </div>
      {phone && <HomeNav pane="sessions" />}
      <CreateDialog opener={opener} />
    </div>
  );
}

const NONE: ReadonlySet<string> = new Set();
