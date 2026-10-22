import { useRef, useState } from "preact/hooks";
import type { App } from "../app/app";
import type { HostEntry } from "../native/bridge";
import { ago } from "../ui/format";
import { useStore } from "../ui/store";
import { Tappable } from "../ui/Tappable";
import { ChevronRight, Close, Eye, EyeOff, FileIcon, Film, Folder, Gear, ImageIcon, Plus, Upload, Wrap } from "../ui/icons";
import { CloseButton, Empty, Sheet, SheetHeader } from "../ui/Sheet";
import type { HttpRefusal } from "../net/http";
import type { Entry, RootEntry, Roots } from "./api";
import { baseName, describeError, within, type FileBrowser, type FilesView } from "./browser";
import { viewerFor } from "./kinds";
import { FileViewer, formatSize } from "./Viewers";

/** How far a pull at the top of a list must travel to relist it. */
const PULL_TRIGGER = 64;
/** Start the next page this far before the list's end. */
const MORE_MARGIN = 600;

/** `/home/jimmy/code/x` → `~/code/x`. */
function tilde(path: string, roots: Roots | null): string {
  const home = roots?.home;
  if (!home || !within(path, home)) return path;
  return path === home ? "~" : `~${path.slice(home.length)}`;
}

function EntryIcon({ entry }: { entry: Entry }) {
  if (entry.kind === "dir") return <Folder />;
  switch (viewerFor(entry.mime ?? null)) {
    case "image": return <ImageIcon />;
    case "media": return <Film />;
    default: return <FileIcon />;
  }
}

function EntryRow({ entry, onOpen, now }: { entry: Entry; onOpen: () => void; now: number }) {
  // A non-UTF-8 name can't be sent back; a broken link or a FIFO has nothing to show.
  const openable = entry.utf8 !== false && (entry.kind === "dir" || entry.kind === "file");
  const sub = [
    entry.link ? (entry.kind === "broken" ? "broken link" : "link") : null,
    entry.kind === "other" ? "special file" : null,
    entry.utf8 === false ? "name isn't UTF-8" : null,
  ].filter(Boolean).join(", ");
  return (
    <Tappable class={`row entry entry-${entry.kind}`} label={`${entry.kind === "dir" ? "Folder" : "File"} ${entry.name}`} disabled={!openable} onTap={onOpen}>
      <EntryIcon entry={entry} />
      <span class="row-main">
        <span class="row-title">{entry.name}</span>
        {sub && <span class="row-sub">{sub}</span>}
      </span>
      {entry.kind === "file" && entry.size !== undefined && <span class="row-meta">{formatSize(entry.size)}</span>}
      {entry.mtime !== undefined && <span class="row-meta entry-age">{ago(entry.mtime, now)}</span>}
      {entry.kind === "dir" && <ChevronRight size={16} />}
    </Tappable>
  );
}

/** A problem loading the place, with the ways out of it. */
function Problem({ browser, error, host }: { browser: FileBrowser; error: HttpRefusal; host: string }) {
  const lost = error.code === "outside_roots" || error.code === "not_found" || error.code === "denied";
  return (
    <Empty title={describeError(error, host)}>
      <Tappable class="action action-quiet" label="Try again" onTap={() => { void browser.reload(); }}>Try again</Tappable>
      {lost && <Tappable class="action action-quiet" label="Show folders" onTap={() => { void browser.showRoots(); }}>Show folders</Tappable>}
    </Empty>
  );
}

/**
 * A directory's entries, loading the next page as the end nears; pull down at the top to
 * relist. Remounted per directory, so each opens at its top.
 */
function DirList({ browser, view, host }: { browser: FileBrowser; view: FilesView; host: string }) {
  const { pages, loading, error, hidden } = view;
  const scroller = useRef<HTMLDivElement>(null);
  const pullFrom = useRef<number | null>(null);
  const [pull, setPull] = useState(0);
  const now = Date.now();
  if (!pages) return error ? <Problem browser={browser} error={error} host={host} /> : <div class="loading">Loading…</div>;
  const remaining = pages.total - pages.entries.length;
  const picking = pages.source === "dirs";
  // The last folder's entries stay up, inert, until the next folder's arrive; under a
  // viewer they stay mounted (for the scroll position) and inert.
  const place = view.place;
  const stale = loading && (place.kind === "dir" || place.kind === "pick") && place.path !== pages.path;
  return (
    <div
      ref={scroller}
      inert={stale || place.kind === "file"}
      class={`files-list${stale ? " files-stale" : ""}`}
      onScroll={(e) => {
        const el = e.currentTarget;
        if (el.scrollHeight - el.scrollTop - el.clientHeight < MORE_MARGIN) void browser.more();
      }}
      onTouchStart={(e) => { pullFrom.current = (scroller.current?.scrollTop ?? 1) <= 0 ? (e.touches[0]?.clientY ?? null) : null; }}
      onTouchMove={(e) => {
        const from = pullFrom.current;
        const y = e.touches[0]?.clientY;
        if (from !== null && y !== undefined) setPull(Math.max(0, Math.min(PULL_TRIGGER * 1.5, (y - from) / 2)));
      }}
      onTouchEnd={() => {
        if (pull >= PULL_TRIGGER / 2) void browser.reload();
        pullFrom.current = null;
        setPull(0);
      }}
    >
      <div class="pull" style={{ height: `${String(pull)}px` }} aria-hidden="true">
        {pull > 0 && (pull >= PULL_TRIGGER / 2 ? "Release to refresh" : "Pull to refresh")}
      </div>
      {error && <div class="viewer-note viewer-error" role="alert">{describeError(error, host)}</div>}
      {pages.entries.length === 0 && !loading && (
        <Empty title={picking ? "No folders here" : "Empty folder"} hint={hidden ? undefined : "Hidden files are hidden. Show them with the eye."} />
      )}
      {pages.entries.map((entry) => (
        <EntryRow key={entry.name} entry={entry} now={now} onOpen={() => { void browser.openEntry(entry); }} />
      ))}
      {remaining > 0 && <div class="loading">{loading ? "Loading…" : `${String(remaining)} more`}</div>}
      {pages.truncated && <div class="viewer-note">This folder is too big to list in full. Use the terminal for the rest.</div>}
    </div>
  );
}

function rootLabel(entry: RootEntry, roots: Roots): { title: string; sub: string } {
  const path = entry.canonical ?? entry.path;
  return { title: baseName(path), sub: entry.ok ? tilde(path, roots) : `${entry.path}: not found on the server` };
}

/** Where the file manager opens when the tab's folder isn't in a root. */
function RootsList({ browser, view, host }: { browser: FileBrowser; view: FilesView; host: string }) {
  const { roots, loading, error } = view;
  if (error) return <Problem browser={browser} error={error} host={host} />;
  if (!roots) return loading ? <div class="loading">Loading…</div> : null;
  const row = (entry: RootEntry, label: string) => {
    const { title, sub } = rootLabel(entry, roots);
    return (
      <Tappable key={entry.path} class="row" label={`${label} ${title}`} disabled={!entry.ok} onTap={() => { if (entry.canonical) void browser.openDir(entry.canonical); }}>
        <Folder />
        <span class="row-main">
          <span class="row-title">{title}</span>
          <span class="row-sub mono">{sub}</span>
        </span>
        <ChevronRight size={16} />
      </Tappable>
    );
  };
  return (
    <div class="files-list">
      <h2 class="home-section">Folders</h2>
      {roots.roots.length === 0 && (
        <Empty title="No folders yet" hint="Add the project folders you want to browse from your phone.">
          <Tappable class="action action-quiet" label="Add a folder" onTap={() => { void browser.pick("root"); }}><Plus /> Add a folder</Tappable>
        </Empty>
      )}
      {roots.roots.map((entry) => row(entry, "Open"))}
      <h2 class="home-section">Uploads</h2>
      {row(roots.uploadsDir, "Open uploads")}
    </div>
  );
}

/** Settings: the roots and the uploads folder, saved in the server's config.toml. */
function SettingsPane({ browser, view, host }: { browser: FileBrowser; view: FilesView; host: string }) {
  const { roots, saving, error, loading } = view;
  if (!roots) return error ? <Problem browser={browser} error={error} host={host} /> : loading ? <div class="loading">Loading…</div> : null;
  return (
    <div class="files-list">
      {error && <div class="viewer-note viewer-error" role="alert">{describeError(error, host)}</div>}
      <h2 class="home-section">Folders</h2>
      <p class="settings-hint">The file manager shows only these folders and the uploads folder.</p>
      {roots.roots.map((entry) => {
        const { title, sub } = rootLabel(entry, roots);
        return (
          <div key={entry.path} class="row-split">
            <div class="row">
              <Folder />
              <span class="row-main">
                <span class="row-title">{title}</span>
                <span class="row-sub mono">{sub}</span>
              </span>
            </div>
            <Tappable class="icon-tap" label={`Remove ${title}`} disabled={saving} onTap={() => { void browser.removeRoot(entry.path); }}><Close size={16} /></Tappable>
          </div>
        );
      })}
      <Tappable class="row row-action" label="Add a folder" disabled={saving} onTap={() => { void browser.pick("root"); }}>
        <Plus />
        <span class="row-main"><span class="row-title">Add a folder</span></span>
      </Tappable>
      <h2 class="home-section">Uploads</h2>
      <p class="settings-hint">Photos sent from the phone are saved here.</p>
      <Tappable class="row" label="Change the uploads folder" disabled={saving} onTap={() => { void browser.pick("uploads"); }}>
        <Upload />
        <span class="row-main">
          <span class="row-title">{rootLabel(roots.uploadsDir, roots).title}</span>
          <span class="row-sub mono">{rootLabel(roots.uploadsDir, roots).sub}</span>
        </span>
        <span class="row-meta">Change</span>
      </Tappable>
    </div>
  );
}

function HiddenToggle({ browser, hidden }: { browser: FileBrowser; hidden: boolean }) {
  return (
    <Tappable class={`icon-tap${hidden ? " icon-on" : ""}`} label={hidden ? "Hide hidden files" : "Show hidden files"} onTap={() => { void browser.toggleHidden(); }}>
      {hidden ? <Eye /> : <EyeOff />}
    </Tappable>
  );
}

/**
 * The file manager, a sheet over the terminal (plan.md "File manager"). A file's viewer
 * lies over the listing it came from, so going back finds the list where it was.
 */
export function FilesSheet({ app, host, browser }: { app: App; host: HostEntry; browser: FileBrowser }) {
  const view = useStore(browser);
  const [wrap, setWrap] = useState(false);
  const { place, roots, pages, hidden, saving } = view;
  const close = (): void => { app.closeSheet(); };
  const back = (): void => { void browser.back(); };
  const describe = (error: HttpRefusal): string => describeError(error, host.name);
  const closeButton = <CloseButton onClose={close} />;

  let title: string;
  let sub: string | null = null;
  let actions = closeButton;
  let onBack: (() => void) | undefined = back;
  switch (place.kind) {
    case "roots":
      title = "Files";
      sub = host.name;
      onBack = undefined;
      actions = <><Tappable class="icon-tap" label="Folder settings" onTap={() => { browser.showSettings(); }}><Gear /></Tappable>{closeButton}</>;
      break;
    case "dir":
      title = baseName(place.path);
      sub = tilde(place.path, roots);
      actions = (
        <>
          <HiddenToggle browser={browser} hidden={hidden} />
          <Tappable class="icon-tap" label="Upload a photo" onTap={() => { app.uploadMedia(); }}><Upload /></Tappable>
          {closeButton}
        </>
      );
      break;
    case "file":
      title = place.file.name;
      sub = tilde(place.file.path.slice(0, place.file.path.lastIndexOf("/")) || "/", roots);
      actions = (
        <>
          {viewerFor(place.file.mime) === "code" && (
            <Tappable class={`icon-tap${wrap ? " icon-on" : ""}`} label={wrap ? "Don't wrap lines" : "Wrap lines"} onTap={() => { setWrap(!wrap); }}><Wrap /></Tappable>
          )}
          {closeButton}
        </>
      );
      break;
    case "settings":
      title = "Folders";
      sub = host.name;
      break;
    case "pick":
      title = place.path === roots?.home ? "Home" : baseName(place.path);
      sub = place.purpose === "root" ? "Choose a folder to add" : "Choose the uploads folder";
      actions = <><HiddenToggle browser={browser} hidden={hidden} />{closeButton}</>;
      break;
  }

  // The listing stays mounted under a viewer; a new directory starts at its top.
  const listed = place.kind === "dir" || place.kind === "pick" || (place.kind === "file" && pages?.source === "list");
  const atHome = place.kind === "pick" && place.path === roots?.home;
  const pickTarget = place.kind === "pick" ? tilde(place.path, roots) : "";
  return (
    <Sheet onClose={close} tall label="Files">
      <SheetHeader title={title} sub={sub} onBack={onBack} actions={actions} />
      <div class="files-body">
        {place.kind === "roots" && <RootsList browser={browser} view={view} host={host.name} />}
        {place.kind === "settings" && <SettingsPane browser={browser} view={view} host={host.name} />}
        {listed && <DirList key={`${pages?.source ?? ""}:${pages?.path ?? ""}`} browser={browser} view={view} host={host.name} />}
        {place.kind === "file" && (
          <div class="files-viewer">
            {/* A link followed from this file that failed: the viewer stays. */}
            {view.error && <div class="viewer-note viewer-error" role="alert">{describe(view.error)}</div>}
            <FileViewer
              key={place.file.path}
              api={browser.api}
              file={place.file}
              wrap={wrap}
              describe={describe}
              onPlay={(path) => { app.playMedia(host.id, path); }}
              onLink={(target) => {
                if (target.kind === "path") void browser.openPath(target.path);
                else if (target.kind === "external") app.openExternal(target.url);
              }}
            />
          </div>
        )}
      </div>
      {place.kind === "pick" && (
        <div class="sheet-foot">
          <Tappable
            class="action action-primary"
            label={place.purpose === "root" ? `Add ${pickTarget}` : `Save uploads in ${pickTarget}`}
            disabled={atHome || saving || view.loading}
            onTap={() => { void browser.choose(); }}
          >
            {atHome ? "Choose a folder inside home" : place.purpose === "root" ? `Add ${pickTarget}` : `Save uploads in ${pickTarget}`}
          </Tappable>
        </div>
      )}
    </Sheet>
  );
}
