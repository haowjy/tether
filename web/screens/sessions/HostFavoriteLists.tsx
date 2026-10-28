// The picker's Files side, one server at a time: Home first, then the favorites A to Z by path, then
// Uploads, and "Open a folder…" last, like a server's New session row. The favorites are the host's
// `FileBrowser` store, asked again each time the picker opens (another device may have changed them), so
// a Files tab's star and this list never disagree. A pick activates the Files tab already at that folder
// or opens one (`openFolder`), and rows read "here" or "open" like session rows. A favorite whose folder
// is gone stays, dimmed, with a × to remove it: its star is inside the folder, so this is its only way out.
import { useEffect } from "preact/hooks";
import { useApp, useAppView } from "../../app/context";
import { describeError } from "../../files/browser";
import type { PlaceEntry } from "../../files/api";
import { shorten } from "../../files/format";
import type { HostClient } from "../../net/hosts";
import type { HttpRefusal } from "../../net/http";
import { Button } from "../../ui/primitives/Button";
import { EmptyState } from "../../ui/primitives/EmptyState";
import { IconButton } from "../../ui/primitives/IconButton";
import { Row } from "../../ui/primitives/Row";
import { RovingList } from "../../ui/primitives/RovingList";
import { useStore } from "../../ui/store";
import { screenOf } from "../../workspace/state";
import { filesSession } from "../files/session";
import { HostSection, Loading, useListedHosts } from "./HostSection";
import { lineClass, listClass, missingClass, NoMatches, StateMark, Unreachable } from "./PickRows";
import { filesTabAt, openFolder, reasonOf } from "./pick";

const byPath = (a: PlaceEntry, b: PlaceEntry): number => {
  const [x, y] = [a.canonical ?? a.path, b.canonical ?? b.path];
  return x < y ? -1 : x > y ? 1 : 0;
};

interface Props {
  query: string;
  /** The "Open a folder…" row: start a path on this server. */
  onPath: (host: HostClient) => void;
}

function HostFavorites({ host, titled, query, onPath }: Props & { host: HostClient; titled: boolean }) {
  const app = useApp();
  const name = host.name ?? "the server";
  const { hostId } = host;
  const askable = host.admission.kind === "admitted" && hostId !== null;
  const { browser } = filesSession(app, host);
  const favorites = useStore(browser, (s) => s.favorites);
  const failure = useStore(browser, (s) => s.favoritesError);
  const { tabs, shown } = useAppView((v) => ({ tabs: v.workspace.tabs, shown: screenOf(v.workspace) === "files" ? v.workspace.active : null }), (a, b) => a.tabs === b.tabs && a.shown === b.shown);
  useEffect(() => { if (askable) void browser.refreshFavorites(); }, [browser, askable]);

  const remove = (path: string): void => {
    browser.removeFavorite(path).catch((error: unknown) => { app.notify(describeError(error as HttpRefusal, name)); });
  };

  let body;
  if (host.admission.kind === "unreachable") {
    body = <Unreachable what="Folders" hostName={name} />;
  } else if (!askable || (favorites === null && failure === null)) {
    body = <Loading what={askable ? "Loading folders" : "Checking access"} />;
  } else if (favorites === null) {
    body = <EmptyState icon="alert" title={describeError(failure as HttpRefusal, name)} action={<Button variant="secondary" icon="refresh" onClick={() => { void browser.refreshFavorites(); }}>Retry</Button>} />;
  } else {
    const home: PlaceEntry = { path: favorites.home, canonical: favorites.home, ok: true };
    // Home and Uploads are listed in their own place: a favorite naming one, or a folder twice, shows once.
    const seen = new Set<string>([favorites.home, favorites.uploadsDir.canonical ?? ""]);
    const extra = [...favorites.favorites].sort(byPath).filter((f) => !seen.has(f.canonical ?? f.path) && seen.add(f.canonical ?? f.path));
    const rows = [
      { key: "home", entry: home, removable: false, meta: "Home" },
      ...extra.map((r) => ({ key: r.path, entry: r, removable: !r.ok, meta: undefined })),
      ...(favorites.uploadsDir.ok ? [{ key: "uploads", entry: favorites.uploadsDir, removable: false, meta: "Uploads" }] : []),
    ].map((row) => ({ ...row, label: shorten(row.entry.canonical ?? row.entry.path, favorites.home) }));
    const needle = query.trim().toLowerCase();
    const matching = rows.filter((r) => r.label.toLowerCase().includes(needle));
    body = matching.length === 0 ? (
      <NoMatches what="folders" hostName={name} query={query} />
    ) : (
      <RovingList label="Folders" class={listClass}>
        {matching.map(({ key, entry, removable, meta, label }) => {
          const tab = filesTabAt(tabs, hostId, entry.canonical);
          const state = tab ? (tab.id === shown ? "here" : "open") : null;
          return (
            <div key={key} class={lineClass}>
              <Row
                roving
                {...(!entry.ok && { class: missingClass })}
                icon="folder"
                label={label}
                meta={entry.ok ? <>{meta}<StateMark state={state} /></> : "Missing"}
                {...(entry.ok && { trailing: "chevron" as const })}
                selected={state !== null}
                disabled={!entry.ok || entry.canonical === null}
                onClick={() => { if (entry.canonical && hostId) { openFolder(app, hostId, entry.canonical); } }}
              />
              {removable && <IconButton icon="close" label={`Remove ${label} from favorites`} onClick={() => { remove(entry.path); }} />}
            </div>
          );
        })}
      </RovingList>
    );
  }
  const reason = reasonOf(host);
  return (
    <HostSection hostName={name} label={`Folders on ${name}`} titled={titled}>
      {body}
      {favorites !== null && (
        <RovingList label="Open a folder" class={listClass}>
          <Row roving icon="folder" label="Open a folder…" trailing="chevron" disabled={reason !== undefined} onClick={() => { onPath(host); }} />
        </RovingList>
      )}
    </HostSection>
  );
}

export function HostFavoriteLists({ only, ...rest }: Props & { only?: string | undefined }) {
  const hosts = useListedHosts(only);
  return <>{hosts.map((h) => <HostFavorites key={h.entry.handle} host={h} titled={hosts.length > 1} {...rest} />)}</>;
}
