// Remove (fs.md "The picker"): an overlay on a Files tab, so Back, Escape and the
// backdrop close it like every other overlay. Adding a folder is the path field's (PathField.tsx).
import { useEffect, useState } from "preact/hooks";
import { useApp, useOverlay } from "../../app/context";
import { describeError } from "../../files/browser";
import { shorten } from "../../files/format";
import { HttpRefusal } from "../../net/http";
import { useStore } from "../../ui/store";
import { Button } from "../../ui/primitives/Button";
import { Dialog } from "../../ui/primitives/Dialog";
import { TitleBar } from "../../ui/primitives/DialogBars";
import type { FilesSession } from "./session";
import styles from "./FolderDialogs.module.css";

const refusal = (error: unknown): HttpRefusal => (error instanceof HttpRefusal ? error : new HttpRefusal(0, "internal"));

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
    <Dialog open={open} title="Remove this folder?" header={<TitleBar title="Remove this folder?" onClose={close} />} returnFocusTo={removed ? "addFolder" : null} onClose={close}>
      {open && (
        <div class={styles.body}>
          <p>{label} will no longer show in Files on {session.hostName}. Nothing in the folder is deleted.</p>
          {error && <p class={styles.error} role="alert">{error}</p>}
          <div class={styles.actions}>
            <Button variant="quiet" onClick={close}>Cancel</Button>
            <Button variant="secondary" class={styles.danger} busy={busy} onClick={() => { void remove(); }}>{busy ? "Removing…" : "Remove folder"}</Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
