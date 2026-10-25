import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { useApp, useAppView } from "../../app/context";
import { describeError, parentPlace } from "../../files/browser";
import { baseName, parentOf } from "../../files/paths";
import type { LinkTarget } from "../../files/render/markdown";
import type { FilesPlace } from "../../platform/types";
import { useStore } from "../../ui/store";
import { Button } from "../../ui/primitives/Button";
import { EmptyState } from "../../ui/primitives/EmptyState";
import { IconButton } from "../../ui/primitives/IconButton";
import { Spinner } from "../../ui/primitives/Spinner";
import { shorten } from "../../files/format";
import { AddThisFolder } from "./AddThisFolder";
import { RemoveFolderDialog } from "./FolderDialogs";
import { DirList, RootsList } from "./FolderList";
import { PathField } from "./PathField";
import { Preview } from "./Preview";
import { startUpload, type FilesSession } from "./session";
import { UploadPanel } from "./UploadPanel";
import styles from "./FilesScreen.module.css";

/**
 * The file manager for one host: a folder list or a preview, under a header that says where
 * you are. Where you are is the router's (history entry); `FileBrowser` follows it.
 */
export function FilesPane({ session }: { session: FilesSession }) {
  const app = useApp();
  const { browser } = session;
  const view = useStore(browser, (s) => s);
  const wanted = useAppView((v) => v.nav.entry.files);
  const { place, pages, roots, loading, error } = view;
  const scroller = useRef<HTMLDivElement>(null);
  // While the path field is being typed in, its completions are the list.
  const [finding, setFinding] = useState(false);

  useEffect(() => { void browser.follow(wanted); }, [browser, wanted]);

  const open = (to: FilesPlace): void => { app.router.pushFiles(to); };
  const up = parentPlace(view);
  const listed = pages !== null && (place.kind === "dir" ? pages.path === place.path : place.kind === "file" && pages.path === parentOf(place.file.path));
  const listingVisible = place.kind === "dir" && listed && !error && !finding;

  // Back finds a folder's list scrolled where it was left.
  const folder = listed ? pages.path : null;
  useLayoutEffect(() => {
    if (folder !== null && scroller.current) scroller.current.scrollTop = session.scroll.get(folder) ?? 0;
  }, [folder, session.scroll, listingVisible]);

  const onLink = (target: LinkTarget): void => {
    if (target.kind === "external") app.platform.openURL(target.url);
    else if (target.kind === "path") {
      browser.resolve(target.path).then(open, (e: unknown) => { app.notify(e instanceof Error && "code" in e ? describeError(e as never, session.hostName) : "That link can't be opened."); });
    }
  };

  const home = roots?.home ?? null;
  const title = place.kind === "roots" ? "Files" : place.kind === "dir" ? baseName(place.path) : place.file.name;
  const rest = place.kind === "dir" ? shorten(place.path, home) : "";
  const backLabel = place.kind === "file" ? "Back to folder" : up?.kind === "roots" ? "All folders" : "Up one folder";

  let body;
  if (error) {
    body = (
      <EmptyState icon="alert" title={describeError(error, session.hostName)} action={<Button onClick={() => { void browser.reload(); }}>Try again</Button>} />
    );
  } else if (place.kind === "roots") {
    body = roots ? (
      <RootsList
        roots={roots}
        hostName={session.hostName}
        onOpen={open}
        onAdd={() => { app.focus.focusTarget("path", true); }}
        onRemove={(path, from) => { app.openOverlay({ screen: "files", name: "removeFolder", params: { path } }, from); }}
      />
    ) : <Loading what="Loading folders" />;
  } else if (place.kind === "dir") {
    body = listed ? null : <Loading what="Loading the folder" />;
  } else {
    body = loading && place.file.mime === null && place.file.size === null ? <Loading what="Opening the file" /> : null;
  }

  return (
    <div class={styles.files}>
      <header class={styles.header}>
        {up && <IconButton icon="back" label={backLabel} onClick={() => { app.router.toParent(up); }} />}
        <div class={styles.heading}>
          <h1 class={styles.title}>{title}</h1>
          {place.kind === "file" && <p class={styles.crumb} title={place.file.path}>{shorten(place.file.path, home)}</p>}
        </div>
        {place.kind !== "file" && (
          <div class={styles.actions}>
            <IconButton icon="refresh" label="Refresh" disabled={loading} onClick={() => { void browser.reload(); }} />
            <Button icon="upload" onClick={() => { startUpload(app, session); }}>Upload</Button>
          </div>
        )}
      </header>
      {place.kind !== "file" && roots && <PathField session={session} rest={rest} onEditing={setFinding} />}
      {!finding && <UploadPanel session={session} onPreview={(path) => { open({ kind: "file", path }); }} />}
      {/* The list stays mounted under a preview, so Back returns to it as it was. */}
      {listed && !error && (
        <div
          ref={scroller}
          key={pages.path}
          class={styles.scroll}
          hidden={!listingVisible}
          onScroll={(e) => { session.scroll.set(pages.path, e.currentTarget.scrollTop); }}
        >
          {pages.via === "dirs" && <AddThisFolder session={session} path={pages.path} />}
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
            foldersOnly={pages.via === "dirs"}
          />
        </div>
      )}
      {place.kind === "file" && !error && !(loading && place.file.mime === null && place.file.size === null) && (
        <Preview session={session} file={place.file} onLink={onLink} />
      )}
      {body && !finding && <div class={styles.scroll}>{body}</div>}
      <RemoveFolderDialog session={session} />
    </div>
  );
}

function Loading({ what }: { what: string }) {
  return <div class={styles.loading}><Spinner label={what} /><p>{what}</p></div>;
}
