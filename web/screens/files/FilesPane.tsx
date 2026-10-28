import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { useApp } from "../../app/context";
import { describeError, parentPlace } from "../../files/browser";
import { baseName, parentOf } from "../../files/paths";
import type { FilesTab } from "../../workspace/state";
import type { LinkTarget } from "../../files/render/markdown";
import type { FilesPlace } from "../../platform/types";
import { useStore } from "../../ui/store";
import { Button } from "../../ui/primitives/Button";
import { EmptyState } from "../../ui/primitives/EmptyState";
import { IconButton } from "../../ui/primitives/IconButton";
import { Spinner } from "../../ui/primitives/Spinner";
import { shorten } from "../../files/format";
import { FavoriteToggle } from "./FavoriteToggle";
import { DirList, MissingFolder } from "./FolderList";
import { PathField } from "./PathField";
import { Preview } from "./Preview";
import { scrollKey, startUpload, type FilesSession } from "./session";
import { UploadPanel } from "./UploadPanel";
import styles from "./FilesScreen.module.css";

/**
 * The file manager for one Files tab: a folder list or a preview, under a header that says
 * where you are. Where you are is the tab's place (the workspace's, written from history);
 * the host's `FileBrowser` follows it and reports the daemon's canonical path back.
 */
export function FilesPane({ session, tab }: { session: FilesSession; tab: FilesTab }) {
  const app = useApp();
  const { browser } = session;
  const view = useStore(browser, (s) => s);
  const wanted = tab.place;
  const { place, pages, favorites, loading, error } = view;
  const scroller = useRef<HTMLDivElement>(null);
  // While the path field is being typed in, its completions are the list.
  const [finding, setFinding] = useState(false);

  // The one cancellation for answers that land late: this effect's token is current only while the pane still wants this place.
  // A resolve or a Markdown link answer that finds another token (or none) is dropped.
  const wantsNow = useRef<object | null>(null);
  useEffect(() => {
    const token = {};
    wantsNow.current = token;
    void browser.follow(wanted, (settled) => { if (wantsNow.current === token) app.resolvedPlace(wanted, settled); });
    return () => { wantsNow.current = null; };
  }, [app, browser, wanted]);

  const open = (to: FilesPlace): void => { app.openPlace(to); };
  const up = parentPlace(view);
  const listed = pages !== null && (place.kind === "dir" ? pages.path === place.path : pages.path === parentOf(place.file.path));
  const listingVisible = place.kind === "dir" && listed && !error && !finding;

  // Back finds a folder's list scrolled where it was left.
  const folder = listed ? pages.path : null;
  useLayoutEffect(() => {
    if (folder !== null && scroller.current) scroller.current.scrollTop = session.scroll.get(scrollKey(tab.id, folder)) ?? 0;
  }, [folder, session.scroll, tab.id, listingVisible]);

  const onLink = (target: LinkTarget): void => {
    if (target.kind === "external") app.platform.openURL(target.url);
    else if (target.kind === "path") {
      const token = wantsNow.current;
      const here = (): boolean => wantsNow.current === token;
      browser.resolve(target.path).then((to) => { if (here()) open(to); }, (e: unknown) => { if (here()) app.notify(e instanceof Error && "code" in e ? describeError(e as never, session.hostName) : "That link can't be opened."); });
    }
  };

  const home = favorites?.home ?? null;
  const title = place.kind === "dir" ? baseName(place.path) : place.file.name;
  const rest = place.kind === "dir" ? shorten(place.path, home) : "";

  let body;
  if (error) {
    // A folder that vanished (moved, deleted) still has a way up.
    const gone = place.kind === "dir" && error.code === "not_found";
    body = gone ? (
      <MissingFolder {...(up && { parent: { name: baseName(up.path), onOpen: () => { app.toPlace(up); } } })} />
    ) : (
      <EmptyState icon="alert" title={describeError(error, session.hostName)} action={<Button onClick={() => { void browser.reload(); }}>Try again</Button>} />
    );
  } else if (place.kind === "dir") {
    body = listed ? null : <Loading what="Loading the folder" />;
  } else {
    body = loading && place.file.mime === null && place.file.size === null ? <Loading what="Opening the file" /> : null;
  }

  return (
    <div class={styles.files}>
      <header class={styles.header}>
        {place.kind === "file" && up && <IconButton icon="back" label="Back to folder" onClick={() => { app.toPlace(up); }} />}
        <div class={styles.heading}>
          <h1 class={styles.title}>{title}</h1>
          {place.kind === "file" && <p class={styles.crumb} title={place.file.path}>{shorten(place.file.path, home)}</p>}
        </div>
        {place.kind !== "file" && (
          <div class={styles.actions}>
            {listed && !error && <FavoriteToggle session={session} path={pages.path} />}
            <IconButton icon="refresh" label="Refresh" disabled={loading} onClick={() => { void browser.reload(); }} />
            <Button icon="upload" onClick={() => { startUpload(app, session); }}>Upload</Button>
          </div>
        )}
      </header>
      {place.kind !== "file" && favorites && <PathField session={session} rest={rest} onEditing={setFinding} onOpen={open} />}
      {!finding && <UploadPanel session={session} onPreview={(path) => { open({ kind: "file", path }); }} />}
      {/* The list stays mounted under a preview, so Back returns to it as it was. */}
      {listed && !error && (
        <div
          ref={scroller}
          key={pages.path}
          class={styles.scroll}
          hidden={!listingVisible}
          onScroll={(e) => { session.scroll.set(scrollKey(tab.id, pages.path), e.currentTarget.scrollTop); }}
        >
          <DirList
            path={pages.path}
            entries={pages.entries}
            total={pages.total}
            truncated={pages.truncated}
            hidden={view.hidden}
            loading={loading}
            onOpen={open}
            onMore={() => { void browser.more(); }}
            onToggleHidden={() => { void browser.toggleHidden(); }}
            {...(up?.kind === "dir" && { parent: { name: baseName(up.path), onOpen: () => { app.toPlace(up); } } })}
          />
        </div>
      )}
      {place.kind === "file" && !error && !(loading && place.file.mime === null && place.file.size === null) && (
        <Preview session={session} file={place.file} onLink={onLink} />
      )}
      {body && !finding && <div class={styles.scroll}>{body}</div>}
    </div>
  );
}

function Loading({ what }: { what: string }) {
  return <div class={styles.loading}><Spinner label={what} /><p>{what}</p></div>;
}
