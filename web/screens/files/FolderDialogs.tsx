// Add folder and Remove (fs.md "The picker"): two overlays on the Files destination, so Back, Escape
// and the backdrop close them like every other overlay. Adding browses `/fs/dirs` from $HOME one
// folder at a time; the daemon's refusals (`outside_home`, a read-only config.toml) show in the dialog.
import { useEffect, useRef, useState } from "preact/hooks";
import { useApp, useAppView, useOverlay } from "../../app/context";
import type { Entry } from "../../files/api";
import { describeError, join, parentOf } from "../../files/browser";
import { HttpRefusal } from "../../net/http";
import { useFocus } from "../../ui/focus";
import { useStore } from "../../ui/store";
import { Button } from "../../ui/primitives/Button";
import { Dialog } from "../../ui/primitives/Dialog";
import { EmptyState } from "../../ui/primitives/EmptyState";
import { IconButton } from "../../ui/primitives/IconButton";
import { Row } from "../../ui/primitives/Row";
import { RovingList } from "../../ui/primitives/RovingList";
import { Spinner } from "../../ui/primitives/Spinner";
import { shorten } from "./FolderList";
import type { FilesSession } from "./session";
import styles from "./FolderDialogs.module.css";

/** A folder's directories so far, and whether the next page or a retry is under way. */
interface Dirs {
  /** The path asked for; `path` is the daemon's canonical answer for it. */
  asked: string;
  path: string;
  entries: Entry[];
  total: number;
  loading: boolean;
  error: HttpRefusal | null;
}

const refusal = (error: unknown): HttpRefusal => (error instanceof HttpRefusal ? error : new HttpRefusal(0, "internal"));

/** Mounted only while the dialog is open, so each open starts at $HOME with nothing chosen. */
function AddBody({ session, home }: { session: FilesSession; home: string }) {
  const app = useApp();
  const focus = useFocus();
  const { browser, hostName } = session;
  const roots = useStore(browser, (s) => s.roots);
  const [path, setPath] = useState(home);
  const [hidden, setHidden] = useState(false);
  const [dirs, setDirs] = useState<Dirs>({ asked: home, path: home, entries: [], total: 0, loading: true, error: null });
  const [again, setAgain] = useState(0);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);

  // Lists `path` from its first page; the answer for a folder already left is dropped.
  useEffect(() => {
    let current = true;
    setDirs((d) => ({ asked: path, path, entries: d.asked === path ? d.entries : [], total: d.asked === path ? d.total : 0, loading: true, error: null }));
    browser.api.dirs(path, 0, hidden).then(
      (page) => { if (current) setDirs({ asked: path, path: page.path, entries: page.entries, total: page.total, loading: false, error: null }); },
      (error: unknown) => { if (current) setDirs({ asked: path, path, entries: [], total: 0, loading: false, error: refusal(error) }); },
    );
    return () => { current = false; };
  }, [browser, path, hidden, again]);

  // Descending or going up replaces the row that held focus: put it on the new list's first row.
  const listed = !dirs.loading && dirs.error === null && dirs.asked === path;
  useEffect(() => {
    if (!listed) return;
    const active = document.activeElement;
    if (active && active !== document.body && active.tagName !== "DIALOG") return;
    const first = list.current?.querySelector<HTMLElement>("[data-roving]");
    if (first) focus.focusElement(first);
  }, [listed, path, focus]);

  const more = (): void => {
    setDirs((d) => ({ ...d, loading: true }));
    browser.api.dirs(path, dirs.entries.length, hidden).then(
      (page) => { setDirs((d) => (d.asked === path ? { ...d, entries: [...d.entries, ...page.entries], total: page.total, loading: false } : d)); },
      (error: unknown) => { setDirs((d) => ({ ...d, loading: false, error: refusal(error) })); },
    );
  };

  const atHome = path === home;
  const alreadyAdded = roots?.roots.some((r) => r.canonical === dirs.path) ?? false;
  const add = async (): Promise<void> => {
    setBusy(true);
    setRefused(null);
    try {
      await browser.addRoot(path);
      app.notify(`Added ${shorten(path, home)}`);
      app.router.closeOverlay();
    } catch (error) {
      setRefused(describeError(refusal(error), hostName));
    }
    setBusy(false);
  };
  const reason = atHome ? "Open a folder inside your home folder first" : alreadyAdded ? "Already in your folders" : busy ? "Adding" : undefined;

  return (
    <div class={styles.body}>
      <div class={styles.where}>
        {!atHome && <IconButton icon="back" label="Up one folder" onClick={() => { setPath(parentOf(path)); }} />}
        <p class={styles.path} title={path}>{shorten(path, home)}</p>
      </div>
      <div ref={list} class={styles.results} aria-busy={dirs.loading}>
        {dirs.error ? (
          <EmptyState icon="alert" title={describeError(dirs.error, hostName)} action={<Button onClick={() => { setAgain((n) => n + 1); }}>Try again</Button>} />
        ) : dirs.asked !== path || (dirs.loading && dirs.entries.length === 0) ? (
          <div class={styles.loading}><Spinner label="Loading the folder" /><p>Loading the folder</p></div>
        ) : dirs.entries.length === 0 ? (
          <EmptyState icon="folder" title="No folders here">{hidden ? undefined : "Hidden folders are not shown."}</EmptyState>
        ) : (
          <RovingList label="Subfolders" class={styles.list}>
            {dirs.entries.map((entry) => (
              <Row key={entry.name} roving class={styles.item} icon="folder" label={entry.name} trailing="chevron" onClick={() => { setPath(join(dirs.path, entry.name)); }} />
            ))}
          </RovingList>
        )}
        {dirs.entries.length < dirs.total && !dirs.error && (
          <div class={styles.more}>
            {dirs.loading ? <Spinner label="Loading more" /> : <Button variant="quiet" onClick={more}>Show more ({String(dirs.total - dirs.entries.length)} left)</Button>}
          </div>
        )}
      </div>
      <Button variant="quiet" class={styles.hidden} onClick={() => { setHidden(!hidden); }}>{hidden ? "Hide hidden folders" : "Show hidden folders"}</Button>
      {atHome && <p class={styles.hint}>Your home folder itself can't be added. Open a folder inside it.</p>}
      {refused && <p class={styles.error} role="alert">{refused}</p>}
      <div class={styles.actions}>
        <Button variant="quiet" onClick={() => { app.router.closeOverlay(); }}>Cancel</Button>
        <Button variant="primary" disabledReason={reason} onClick={() => { void add(); }}>{busy ? "Adding…" : "Add this folder"}</Button>
      </div>
    </div>
  );
}

export function AddFolderDialog({ session }: { session: FilesSession }) {
  const { open, close } = useOverlay("files", "addFolder");
  const phone = useAppView((v) => v.viewport.layout === "phone");
  const home = useStore(session.browser, (s) => s.roots?.home ?? null);
  return (
    <Dialog open={open} title="Add a folder" variant={phone ? "sheet" : "dialog"} onClose={close}>
      {open && home !== null && <AddBody session={session} home={home} />}
    </Dialog>
  );
}

export function RemoveFolderDialog({ session }: { session: FilesSession }) {
  const app = useApp();
  const { open, params, close } = useOverlay("files", "removeFolder");
  const path = open ? String(params?.["path"]) : null;
  const roots = useStore(session.browser, (s) => s.roots);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A removed row's button is gone by the time the dialog closes: focus goes to Add folder instead.
  const [removed, setRemoved] = useState(false);
  useEffect(() => { if (open) setRemoved(false); }, [open]);
  const label = path === null ? "" : shorten(roots?.roots.find((r) => r.path === path)?.canonical ?? path, roots?.home ?? null);

  const remove = async (): Promise<void> => {
    if (path === null) return;
    setBusy(true);
    setError(null);
    try {
      await session.browser.removeRoot(path);
      app.notify(`Removed ${label}`);
      setRemoved(true);
      close();
    } catch (e) {
      setError(describeError(refusal(e), session.hostName));
    }
    setBusy(false);
  };

  return (
    <Dialog open={open} title="Remove this folder?" returnFocusTo={removed ? "addFolder" : null} onClose={close}>
      {open && (
        <div class={styles.body}>
          <p>{label} will no longer show in Files on {session.hostName}. Nothing in the folder is deleted.</p>
          {error && <p class={styles.error} role="alert">{error}</p>}
          <div class={styles.actions}>
            <Button variant="quiet" onClick={close}>Cancel</Button>
            <Button variant="secondary" class={styles.danger} disabledReason={busy ? "Removing" : undefined} onClick={() => { void remove(); }}>{busy ? "Removing…" : "Remove folder"}</Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
