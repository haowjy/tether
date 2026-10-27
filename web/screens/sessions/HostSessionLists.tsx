// Every listable host's sessions (or one host's), as the sessions overlay draws them
// (client-architecture.md §6.3). It reads the cache and the open tabs and retries a listing; what
// opening or creating does is the caller's.
import { useApp, useAppView, useBells } from "../../app/context";
import type { HostClient } from "../../net/hosts";
import { tabId } from "../../platform/tabKey";
import { bellLook, bellsUnavailable } from "../../sessions/bells";
import type { SessionListing, TmuxListing } from "../../proto/generated/messages";
import { useStore } from "../../ui/store";
import { SessionList, type ActiveWindows } from "./SessionList";

/** Hosts whose sessions can be listed or are about to be; the others show a banner or the Enrol screen instead. */
const LISTABLE = new Set(["admitted", "deciding", "unreachable"]);

interface HostSessionListsProps {
  query: string;
  /** Only this host's list (a server's full-height sheet); every listable host's when absent. */
  only?: string;
  /** The terminal tab on screen: its session says "here" and lists its windows. None on Home and Files. */
  active?: ActiveWindows & { id: string };
  onOpen: (host: HostClient, listing: TmuxListing, session: SessionListing) => void;
}

export function HostSessionLists({ query, only, active, onOpen }: HostSessionListsProps) {
  const app = useApp();
  const hosts = useAppView((v) => v.hosts);
  const tabs = useAppView((v) => v.workspace.tabs);
  const state = useStore(app.sessions, (s) => s);
  const bells = useBells();
  const open = new Set(tabs.map((t) => t.id));
  return (
    <>
      {hosts.filter((h) => LISTABLE.has(h.admission.kind) && (only === undefined || h.entry.handle === only)).map((h) => {
        const handle = h.entry.handle;
        const listing = state.hosts[handle]?.listing;
        return (
          <SessionList
            key={handle}
            hostName={h.name ?? "the server"}
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
            onRetry={() => { app.retryHost(handle); }}
          />
        );
      })}
    </>
  );
}
