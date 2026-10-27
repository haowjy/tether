// What both forms of the sessions overlay hold between their search box and their actions: every
// listable server's sessions, with the terminal tab on screen's session marked "here" and its
// windows beneath it. What a pick does afterwards is the form's: `commit` runs the pick once the
// form is ready for it: at once on the half-height sheet, after the picker or a server's sheet has closed.
import { useEffect, useState } from "preact/hooks";
import { useApp, useAppView } from "../../app/context";
import type { AppController } from "../../app/controller";
import { useStore } from "../../ui/store";
import { shownTab, terminalTabOf } from "../../workspace/state";
import { terminalsOf } from "../terminal/terminals";
import { HostSessionLists } from "./HostSessionLists";
import { openSession } from "./openSession";

export type Commit = (pick: () => void) => void;

/** The sheet's commit: a pick runs at once, behind the sheet that stays open. */
export const now: Commit = (pick) => { pick(); };

/** The picker's and the server sheet's commit: close the overlay, then act, so the tab the pick opens is the one that gets focus and Back returns to what was under the overlay. */
export const closing = (app: AppController): Commit => (pick) => { app.router.closeOverlay(pick); };

/** The search box's text, cleared whenever the overlay closes so each opening starts fresh. */
export function useQuery(open: boolean): [string, (query: string) => void] {
  const [query, setQuery] = useState("");
  useEffect(() => { if (!open) setQuery(""); }, [open]);
  return [query, setQuery];
}

/** `only`: one host's sessions, by handle (a server's sheet); every listable host's otherwise. */
export function SessionPicks({ query, commit, only }: { query: string; commit: Commit; only?: string }) {
  const app = useApp();
  const terminals = terminalsOf(app);
  // "here" is the tab on screen: on Home no tab is, and every open session reads "open".
  const tab = useAppView((v) => terminalTabOf(v.workspace, shownTab(v.workspace)));
  const shownId = useStore(terminals, (s) => (tab ? (s.tabs[tab.id]?.shown?.id ?? null) : null));
  return (
    <HostSessionLists
      query={query}
      {...(only !== undefined && { only })}
      {...(tab && { active: { id: tab.id, shownId, onWindow: (window: number) => { commit(() => { terminals.selectWindow(tab.id, window); }); } } })}
      onOpen={(host, listing, session) => { commit(() => { openSession(app, host, listing, session); }); }}
    />
  );
}
