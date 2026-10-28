// The picker's Sessions side: every listable server's sessions, with the terminal tab on screen's
// session marked "here" and its windows beneath it. A pick leaves the picker open, with the tab behind it.
import { useApp, useAppView } from "../../app/context";
import type { HostClient } from "../../net/hosts";
import { useStore } from "../../ui/store";
import { shownTab, terminalTabOf } from "../../workspace/state";
import { terminalsOf } from "../terminal/terminals";
import { HostSessionLists } from "./HostSessionLists";
import { openSession } from "./openSession";

/** `only`: one host's sessions, by handle (the full sheet); every listable host's otherwise. */
export function SessionPicks({ query, only, onNew }: { query: string; only?: string | undefined; onNew: (host: HostClient, name: string) => void }) {
  const app = useApp();
  const terminals = terminalsOf(app);
  // "here" is the tab on screen: on Home no tab is, and every open session reads "open".
  const tab = useAppView((v) => terminalTabOf(v.workspace, shownTab(v.workspace)));
  const shownId = useStore(terminals, (s) => (tab ? (s.tabs[tab.id]?.shown?.id ?? null) : null));
  return (
    <HostSessionLists
      query={query}
      only={only}
      {...(tab && { active: { id: tab.id, shownId, onWindow: (window: number) => { terminals.selectWindow(tab.id, window); } } })}
      onNew={onNew}
      onOpen={(host, listing, session) => { openSession(app, host, listing, session); }}
    />
  );
}
