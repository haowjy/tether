// A server's full-height sessions sheet: the router overlay `{ screen: "sessions", name: "server",
// params: { host } }`, opened by "All N sessions" on a Home card (browser-behaviors.md "Session
// picker ... Phone"). Back instead of Home, no tab strip (Home lists the open tabs), + beside the
// search, that server's sessions only. Like the picker it closes and then acts, so a tapped row
// opens its tab over Home and Back from the tab lands on Home, never on this sheet again.
import { useEffect } from "preact/hooks";
import { useApp, useAppView, useOverlay } from "../../app/context";
import { Dialog } from "../../ui/primitives/Dialog";
import { PageBar } from "../../ui/primitives/DialogBars";
import { SearchField } from "../../ui/primitives/TextField";
import { NewMenu } from "./NewMenu";
import { closing, SessionPicks, useQuery } from "./SessionPicks";
import styles from "./Sessions.module.css";

export function ServerSheet() {
  const app = useApp();
  const { open, params, close } = useOverlay("sessions", "server");
  const [query, setQuery] = useQuery(open);
  const handle = typeof params?.["host"] === "string" ? params["host"] : undefined;
  const host = useAppView((v) => v.hosts.find((h) => h.entry.handle === handle));
  // A server removed while its sheet is open leaves nothing to show.
  useEffect(() => { if (open && !host) close(); }, [open, host]);
  const commit = closing(app);
  return (
    <Dialog
      open={open}
      title={`Sessions on ${host?.name ?? "the server"}`}
      variant="page"
      onClose={close}
      header={
        <PageBar back="Back to Home" onBack={close}>
          <SearchField label="Find a session" placeholder="Find a session" value={query} onInput={setQuery} class={styles.search} />
          {open && <NewMenu host={host} commit={commit} />}
        </PageBar>
      }
    >
      {open && host && <SessionPicks query={query} commit={commit} only={host.entry.handle} />}
    </Dialog>
  );
}
