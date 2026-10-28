// The picker's Files side: every listable server's root folders (or one server's), drawn with the
// Files tab's own roots list. It asks each server for its roots when it mounts, which the picker
// does the first time the side is shown in an opening, and again on Retry; the side then stays
// mounted until the picker closes, so switching sides neither asks again nor flashes. Typing never
// asks. A root opens a new Files tab, once the picker has closed. Adding and removing roots is the Files tab's.
import { useEffect, useState } from "preact/hooks";
import { useApp } from "../../app/context";
import { describeError } from "../../files/browser";
import type { Roots } from "../../files/api";
import type { HostClient } from "../../net/hosts";
import type { HttpRefusal } from "../../net/http";
import { Button } from "../../ui/primitives/Button";
import { EmptyState } from "../../ui/primitives/EmptyState";
import { RootsList } from "../files/FolderList";
import { HostSection, Loading, useListedHosts } from "./HostSection";
import type { Commit } from "./SessionPicks";

type Answer = { roots: Roots } | { error: HttpRefusal } | null;

function HostRoots({ host, titled, query, commit }: { host: HostClient; titled: boolean; query: string; commit: Commit }) {
  const app = useApp();
  const name = host.name ?? "the server";
  const { hostId } = host;
  const askable = host.admission.kind === "admitted" && hostId !== null;
  const [answer, setAnswer] = useState<Answer>(null);
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (!askable) return undefined;
    let current = true;
    setAnswer(null);
    host.fs.roots().then(
      (roots) => { if (current) setAnswer({ roots }); },
      // The fs client turns every failure into an HttpRefusal.
      (error: unknown) => { if (current) setAnswer({ error: error as HttpRefusal }); },
    );
    return () => { current = false; };
  }, [host.fs, askable, round]);

  let body;
  if (host.admission.kind === "unreachable") {
    body = <EmptyState icon="alert" title="Folders can't load yet">They load when {name} is reachable.</EmptyState>;
  } else if (!askable || answer === null) {
    body = <Loading what={askable ? "Loading folders" : "Checking access"} />;
  } else if ("error" in answer) {
    body = <EmptyState icon="alert" title={describeError(answer.error, name)} action={<Button variant="secondary" icon="refresh" onClick={() => { setRound(round + 1); }}>Retry</Button>} />;
  } else {
    body = <RootsList roots={answer.roots} hostName={name} query={query} onOpen={(place) => { commit(() => { app.openFiles(hostId, place); }); }} />;
  }
  return <HostSection hostName={name} label={`Folders on ${name}`} titled={titled}>{body}</HostSection>;
}

export function HostRootLists({ query, only, commit }: { query: string; only?: string | undefined; commit: Commit }) {
  const hosts = useListedHosts(only);
  return <>{hosts.map((h) => <HostRoots key={h.entry.handle} host={h} titled={hosts.length > 1} query={query} commit={commit} />)}</>;
}
