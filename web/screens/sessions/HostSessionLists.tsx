// Every listable host's sessions, as Home, the picker and the switcher draw them: the same rows
// in all (client-architecture.md §6.3). It reads the cache and the open tabs and retries a
// listing; what opening or creating does is the caller's.
import { useApp, useAppView } from "../../app/context";
import type { HostClient } from "../../net/hosts";
import { tabId } from "../../platform/tabKey";
import type { SessionListing, TmuxListing } from "../../proto/generated/messages";
import { useStore } from "../../ui/store";
import { SessionList } from "./SessionList";

/** Hosts whose sessions can be listed or are about to be; the others show a banner or the Enrol screen instead. */
const LISTABLE = new Set(["admitted", "deciding", "unreachable"]);

interface HostSessionListsProps {
  query: string;
  /** The switcher: the active tab's id, so its session says "here". Home passes none. */
  active?: string | null;
  onOpen: (host: HostClient, listing: TmuxListing, session: SessionListing) => void;
  /** Home: the creation action beside each host's list. */
  creation?: { onNewSession: (host: HostClient, opener: HTMLElement) => void };
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
            {...(active !== undefined && { active })}
            onOpen={(l, session) => { onOpen(h, l, session); }}
            onRetry={() => { if (h.admission.kind === "unreachable") app.hosts.recheck(handle); else app.listing.refresh(handle); }}
            {...(creation && { creation: { onNewSession: (el: HTMLElement) => { creation.onNewSession(h, el); } } })}
          />
        );
      })}
    </>
  );
}
