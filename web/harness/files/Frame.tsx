import type { FunctionComponent } from "preact";
import { useEffect, useMemo } from "preact/hooks";
import { useApp, useAppView } from "../../app/context";
import { FileBrowser } from "../../files/browser";
import { UploadTracker } from "../../files/uploads";
import { FilesPane } from "../../screens/files/FilesPane";
import type { FilesSession } from "../../screens/files/session";
import { Toast } from "../../ui/primitives/Toast";
import { FilesFs, UploadScript } from "./fakes";
import type { FakeTree } from "../../platform/test/fs";
import { filesTree, UPLOADS } from "./fakes";
import styles from "./Frame.module.css";

/** What a spec reads and drives on the page. */
export interface FilesHarness {
  fs: FilesFs;
  uploads: UploadScript;
  /** Each `[tab id, path]` the screen asked to insert. */
  inserted: [string, string][];
  /** The listing calls the fake fs answered, for "no refetch" checks. */
  calls: string[];
}

declare global {
  interface Window {
    __files?: FilesHarness;
  }
}

/**
 * Files in the app's context with fakes behind it: the screen as Home's phone pane or the
 * desktop destination would frame it, the notice toast, and the controller's `insertPath`
 * replaced by a recorder (no terminal driver is attached here).
 */
interface FrameProps {
  tree?: FakeTree;
  configure?: (fs: FilesFs) => void;
}

export const Frame: FunctionComponent<FrameProps> = ({ tree, configure }) => {
  const app = useApp();
  const notice = useAppView((v) => v.notice);
  const session = useMemo<FilesSession>(() => {
    const fs = new FilesFs(tree ?? filesTree(), 8);
    configure?.(fs);
    const browser = new FileBrowser({ api: fs, hidden: false });
    const uploads = new UploadScript();
    const harness: FilesHarness = { fs, uploads, inserted: [], calls: fs.calls };
    window.__files = harness;
    Object.assign(app.platform.uploads, { pick: () => uploads.pick() });
    Object.assign(app, {
      insertPath: (id: string, path: string) => {
        harness.inserted.push([id, path]);
        return true;
      },
    });
    return {
      handle: "h1",
      hostName: "pop-os",
      browser,
      uploads: new UploadTracker((path) => { if (path.startsWith(UPLOADS)) void browser.uploaded(path); }),
      scroll: new Map(),
    };
      // One session for the page: the props only seed it.
  }, [app]);
  useEffect(() => () => { delete window.__files; }, []);
  return (
    <>
      <main class={styles.frame}><FilesPane session={session} /></main>
      <Toast message={notice} onDismiss={() => { app.dismissNotice(); }} />
    </>
  );
};
