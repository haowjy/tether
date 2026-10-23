// What one host's Files screen keeps while it is away: the browser state (the folder and
// preview you left), the uploads under way, and each folder's scroll. The screen unmounts
// when you go to the terminal; this is why you come back to the same place.
import type { AppController } from "../../app/controller";
import type { FsApi } from "../../files/api";
import { FileBrowser, savedPlace } from "../../files/browser";
import { UploadTracker } from "../../files/uploads";
import type { HostClient } from "../../net/hosts";

export interface FilesSession {
  /** The host's adapter handle: uploads and video take it. */
  handle: string;
  /** The host's name now: it is unknown until `/auth/info` answers, so it is read on each use. */
  readonly hostName: string;
  browser: FileBrowser;
  uploads: UploadTracker;
  /** Scroll position by folder path, so Back finds the list where it was. */
  scroll: Map<string, number>;
}

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
    scroll: new Map(),
  };
  app.persist.provideFiles(() => {
    const hostId = app.hosts.get(session.handle)?.hostId;
    return hostId ? { hostId, place: savedPlace(browser.snapshot.place) } : null;
  });
  sessions.set(host.fs, session);
  return session;
}

/**
 * The tap on Upload. The picker must open inside the tap, so `pick` is called here and
 * its stream followed afterwards. The tab active now is the one the saved path is offered to.
 */
export function startUpload(app: AppController, session: FilesSession): void {
  const target = app.snapshot.workspace.active;
  void session.uploads.track(app.platform.uploads.pick(session.handle, new AbortController().signal), target);
}
