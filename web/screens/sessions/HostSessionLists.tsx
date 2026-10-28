// Every listable host's sessions (or one host's), as the sessions overlay draws them
// (client-architecture.md §6.3). It reads the cache and the open tabs and retries a listing; what
// opening or creating does is the caller's.
import { useApp, useAppView, useBells } from "../../app/context";
import type { HostClient } from "../../net/hosts";
import { tabId } from "../../platform/tabKey";
import { bellLook, bellsUnavailable } from "../../sessions/bells";
import type { SessionListing, TmuxListing } from "../../proto/generated/messages";
import { useStore } from "../../ui/store";
import { useListedHosts } from "./HostSection";
import { reasonOf } from "./pick";
import { SessionList, type ActiveWindows } from "./SessionList";

interface HostSessionListsProps {
  query: string;
  /** Only this host's list (a server's full-height sheet); every listable host's when absent. */
  only?: string | undefined;
  /** The terminal tab on screen: its session says "here" and lists its windows. None on Home and Files. */
  active?: ActiveWindows & { id: string };
  onOpen: (host: HostClient, listing: TmuxListing, session: SessionListing) => void;
  /** The "New session" row of `host`'s group, with the search as the name's start. */
  onNew: (host: HostClient, name: string) => void;
}

export function HostSessionLists({ query, only, active, onOpen, onNew }: HostSessionListsProps) {
  const app = useApp();
  const hosts = useListedHosts(only);
  const tabs = useAppView((v) => v.workspace.tabs);
  const state = useStore(app.sessions, (s) => s);
  const bells = useBells();
  const open = new Set(tabs.map((t) => t.id));
  return (
    <>
      {hosts.map((h) => {
        const handle = h.entry.handle;
        const listing = state.hosts[handle]?.listing;
        return (
          <SessionList
            key={handle}
            hostName={h.name ?? "the server"}
            titled={hosts.length > 1}
            unreachable={h.admission.kind === "unreachable"}
            bellsUnavailable={bellsUnavailable(bells, h.hostId)}
            sessions={state.hosts[handle]}
            query={query}
            rowOf={(s) => {
              const id = h.hostId !== null && listing != null ? tabId({ host: h.hostId, session: { server: listing.server, session: s.id } }) : null;
              return {
                state: id === null || !open.has(id) ? null : id === active?.id ? "here" : "open",
                bell: id === null ? { ring: false, hidden: false } : bellLook(bells, id),
              };
            }}
            {...(active && { active })}
            onOpen={(l, session) => { onOpen(h, l, session); }}
            onNew={(name) => { onNew(h, name); }}
            newDisabled={reasonOf(h)}
            onRetry={() => { app.retryHost(handle); }}
          />
        );
      })}
    </>
  );
}
