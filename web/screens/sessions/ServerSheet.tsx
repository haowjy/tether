// A server's full-height sessions sheet: the router overlay `{ screen: "sessions", name: "server",
// params: { host } }`, opened by "All N sessions" on a Home card (browser-behaviors.md "Session
// picker ... Phone"). Back instead of Home, no tab strip (Home lists the open tabs), + beside the
// search, that server's sessions only. Like the picker it closes and then acts, so a tapped row
// opens its tab over Home and Back from the tab lands on Home, never on this sheet again.
import { useApp, useOverlay } from "../../app/context";
import { Dialog } from "../../ui/primitives/Dialog";
import { IconButton } from "../../ui/primitives/IconButton";
import { SearchField } from "../../ui/primitives/TextField";
import { NewMenu } from "./NewMenu";
import { closing, SessionPicks, useQuery } from "./SessionPicks";
import styles from "./Sessions.module.css";

/** The overlay params of a server's sheet: the host's handle. */
export interface ServerParams extends Record<string, unknown> {
  host: string;
}

export function ServerSheet() {
  const app = useApp();
  const { open, params, close } = useOverlay("sessions", "server");
  const [query, setQuery] = useQuery(open);
  const handle = open ? (params as ServerParams).host : undefined;
  const host = handle === undefined ? undefined : app.hosts.get(handle);
  const commit = closing(app);
  return (
    <Dialog
      open={open}
      title={`Sessions on ${host?.name ?? "the server"}`}
      variant="page"
      onClose={close}
      header={
        <>
          <IconButton icon="back" label="Back to Home" data-initial-focus="touch" onClick={close} />
          <SearchField label="Find a session" placeholder="Find a session" value={query} onInput={setQuery} class={styles.search} />
          {open && <NewMenu host={host} commit={commit} />}
        </>
      }
    >
      {open && <SessionPicks query={query} commit={commit} {...(handle !== undefined && { only: handle })} />}
    </Dialog>
  );
}
