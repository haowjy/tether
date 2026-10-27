// What one host's Files tabs keep while the screen is away: the browser state (the folder and
// preview shown last), the uploads under way, and each folder's scroll. The screen unmounts
// when you go to the terminal or another tab; the active tab's own place, held by the
// workspace, is what the browser follows when you come back.
import type { AppController } from "../../app/controller";
import type { FsApi } from "../../files/api";
import { FileBrowser } from "../../files/browser";
import { Recent } from "../../files/recent";
import { UploadTracker } from "../../files/uploads";
import type { HostClient } from "../../net/hosts";
import { insertTargetOf } from "../../workspace/state";

export interface FilesSession {
  /** The host's adapter handle: uploads and video take it. */
  handle: string;
  /** The host's name now: it is unknown until `/auth/info` answers, so it is read on each use. */
  readonly hostName: string;
  browser: FileBrowser;
  uploads: UploadTracker;
  /** Scroll position by Files tab and folder path (`scrollKey`), so Back finds the list where it was. */
  scroll: Recent<number>;
}

/** Scrolls kept per host: the least recently set go first, so closed tabs' do not pile up. */
const SCROLLS_KEPT = 64;

/** Two tabs may show the same folder, each scrolled its own way. */
export const scrollKey = (tab: string, path: string): string => `${tab}\n${path}`;

const sessions = new WeakMap<FsApi, FilesSession>();

export function filesSession(app: AppController, host: HostClient): FilesSession {
  const existing = sessions.get(host.fs);
  if (existing) return existing;
  const browser = new FileBrowser({ api: host.fs, hidden: false });
  const session: FilesSession = {
    handle: host.entry.handle,
    get hostName() { return app.hosts.get(host.entry.handle)?.name ?? "the server"; },
    browser,
    uploads: new UploadTracker((path) => { void browser.uploaded(path); }),
    scroll: new Recent(SCROLLS_KEPT),
  };
  sessions.set(host.fs, session);
  return session;
}

/**
 * The tap on Upload. The picker must open inside the tap, so `pick` is called here and
 * its stream followed afterwards. The terminal tab last used on this host is the one the saved path is offered to.
 */
export function startUpload(app: AppController, session: FilesSession): void {
  const target = insertTargetOf(app.snapshot.workspace);
  void session.uploads.track(app.platform.uploads.pick(session.handle, new AbortController().signal), target);
}
