// Every listable host's sessions, as Home and the sessions overlay draw them: the same rows
// in both (client-architecture.md §6.3). It reads the cache and the open tabs and retries a
// listing; what opening or creating does is the caller's.
import { useApp, useAppView } from "../../app/context";
import type { HostClient } from "../../net/hosts";
import { tabId } from "../../platform/tabKey";
import type { SessionListing, TmuxListing } from "../../proto/generated/messages";
import { useStore } from "../../ui/store";
import { SessionList, type ActiveTab } from "./SessionList";

/** Hosts whose sessions can be listed or are about to be; the others show a banner or the Enrol screen instead. */
const LISTABLE = new Set(["admitted", "deciding", "unreachable"]);

interface HostSessionListsProps {
  query: string;
  /** The phone sheet: the active terminal tab, so its session says "here" and lists its windows. Home and the desktop picker pass none. */
  active?: ActiveTab;
  onOpen: (host: HostClient, listing: TmuxListing, session: SessionListing) => void;
  /** Home: the actions beside each host's list. */
  creation?: { onNewSession: (host: HostClient, opener: HTMLElement) => void; onFiles: (host: HostClient) => void };
}

export function HostSessionLists({ query, active, onOpen, creation }: HostSessionListsProps) {
  const app = useApp();
  const hosts = useAppView((v) => v.hosts);
  const tabs = useAppView((v) => v.workspace.tabs);
  const state = useStore(app.sessions, (s) => s);
  const open = new Set(tabs.map((t) => t.id));
  return (
    <>
      {hosts.filter((h) => LISTABLE.has(h.admission.kind)).map((h) => {
        const handle = h.entry.handle;
        const listing = state.hosts[handle]?.listing;
        return (
          <SessionList
            key={handle}
            hostName={h.name ?? "the server"}
            unreachable={h.admission.kind === "unreachable"}
            sessions={state.hosts[handle]}
            query={query}
            tabIdOf={(s) => (h.hostId !== null && listing != null ? tabId({ host: h.hostId, session: { server: listing.server, session: s.id } }) : null)}
            open={open}
            {...(active && { active })}
            onOpen={(l, session) => { onOpen(h, l, session); }}
            onRetry={() => { if (h.admission.kind === "unreachable") app.hosts.recheck(handle); else app.listing.refresh(handle); }}
            {...(creation && { creation: { onNewSession: (el: HTMLElement) => { creation.onNewSession(h, el); }, onFiles: () => { creation.onFiles(h); } } })}
          />
        );
      })}
    </>
  );
}
