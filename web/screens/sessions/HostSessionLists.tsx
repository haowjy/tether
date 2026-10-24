// Every listable host's sessions, as Home and the picker draw them: the same rows in both
// (client-architecture.md §6.3). It reads the cache and the open tabs, toggles expansion and
// retries a listing; what opening or creating does is the caller's.
import { useApp, useAppView } from "../../app/context";
import type { HostClient } from "../../net/hosts";
import { tabId } from "../../platform/tabKey";
import type { SessionListing, TmuxListing, WindowListing } from "../../proto/generated/messages";
import { useStore } from "../../ui/store";
import { SessionList } from "./SessionList";

/** Hosts whose sessions can be listed or are about to be; the others show a banner or the Enrol screen instead. */
const LISTABLE = new Set(["admitted", "deciding", "unreachable"]);
const NONE: ReadonlySet<string> = new Set();

interface HostSessionListsProps {
  query: string;
  /** The switcher: the active tab's id, so its window row says "here". Home passes none. */
  active?: string | null;
  /** The switcher keeps its own expansion (its active session starts open); Home and the picker share the cache's. */
  expansion?: { keys: ReadonlySet<string>; toggle: (key: string) => void };
  onOpen: (host: HostClient, listing: TmuxListing, session: SessionListing, window: WindowListing) => void;
  /** Home only: the creation actions beside each host's list. */
  creation?: {
    onNewSession: (host: HostClient, opener: HTMLElement) => void;
    onNewWindow: (host: HostClient, listing: TmuxListing, session: SessionListing, opener: HTMLElement) => void;
  };
}

export function HostSessionLists({ query, active, expansion, onOpen, creation }: HostSessionListsProps) {
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
            expanded={expansion ? expansion.keys : (h.hostId !== null && state.expanded[h.hostId]) || NONE}
            query={query}
            tabIdOf={(w) => (h.hostId !== null && listing != null ? tabId({ host: h.hostId, window: { server: listing.server, window: w.id } }) : null)}
            open={open}
            {...(active !== undefined && { active })}
            onToggle={(key) => {
              if (expansion) {
                expansion.toggle(key);
                return;
              }
              if (h.hostId === null) return;
              app.sessions.toggle(h.hostId, key);
              app.persist.save(); // expansion is part of the saved workspace
            }}
            onOpen={(l, session, window) => { onOpen(h, l, session, window); }}
            onRetry={() => { if (h.admission.kind === "unreachable") app.hosts.recheck(handle); else app.listing.refresh(handle); }}
            {...(creation && {
              creation: {
                onNewSession: (el: HTMLElement) => { creation.onNewSession(h, el); },
                onNewWindow: (session: SessionListing, el: HTMLElement) => { if (listing) creation.onNewWindow(h, listing, session, el); },
              },
            })}
          />
        );
      })}
    </>
  );
}
