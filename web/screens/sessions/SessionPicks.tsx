// What both forms of the sessions overlay hold between their search box and their actions: every
// listable server's sessions, with the active terminal tab's session marked "here" and its
// windows beneath it. What a pick does afterwards is the form's: `commit` runs the pick once the
// form is ready for it, at once on the sheet and after the picker has closed.
import { useEffect, useState } from "preact/hooks";
import { useApp, useAppView } from "../../app/context";
import { useStore } from "../../ui/store";
import { terminalTabOf } from "../../workspace/state";
import { terminalsOf } from "../terminal/terminals";
import { HostSessionLists } from "./HostSessionLists";
import { openSession } from "./openSession";

export type Commit = (pick: () => void) => void;

/** The sheet's commit: a pick runs at once, behind the sheet that stays open. */
export const now: Commit = (pick) => { pick(); };

/** The search box's text, cleared whenever the overlay closes so each opening starts fresh. */
export function useQuery(open: boolean): [string, (query: string) => void] {
  const [query, setQuery] = useState("");
  useEffect(() => { if (!open) setQuery(""); }, [open]);
  return [query, setQuery];
}

export function SessionPicks({ query, commit }: { query: string; commit: Commit }) {
  const app = useApp();
  const terminals = terminalsOf(app);
  const tab = useAppView((v) => terminalTabOf(v.workspace, v.workspace.active));
  const shownId = useStore(terminals, (s) => (tab ? (s.tabs[tab.id]?.shown?.id ?? null) : null));
  return (
    <HostSessionLists
      query={query}
      {...(tab && { active: { id: tab.id, shownId, onWindow: (window: number) => { commit(() => { terminals.selectWindow(tab.id, window); }); } } })}
      onOpen={(host, listing, session) => { commit(() => { openSession(app, host, listing, session); }); }}
    />
  );
}
