import { useState } from "preact/hooks";
import { useApp } from "../../app/context";
import { describeError } from "../../files/browser";
import { shorten } from "../../files/format";
import { HttpRefusal } from "../../net/http";
import { useStore } from "../../ui/store";
import { Button } from "../../ui/primitives/Button";
import type { FilesSession } from "./session";
import styles from "./FolderList.module.css";

/**
 * Above the subfolders of a folder outside every root (fs.md "The picker"): it is not one of
 * the user's folders yet. Adding makes it one, and the list then shows its files too. The
 * daemon's refusals (outside $HOME, a read-only config.toml) show here in plain words.
 */
export function AddThisFolder({ session, path }: { session: FilesSession; path: string }) {
  const app = useApp();
  const roots = useStore(session.browser, (s) => s.roots);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const home = roots?.home ?? null;
  const reason = path === home ? "Open a folder inside your home folder first" : roots?.roots.some((r) => r.canonical === path) ? "Already in your folders" : undefined;

  const add = async (): Promise<void> => {
    setBusy(true);
    setRefused(null);
    try {
      await session.browser.addRoot(path);
      app.notify(`Added ${shorten(path, home)}`);
    } catch (error) {
      setRefused(describeError(error instanceof HttpRefusal ? error : new HttpRefusal(0, "internal"), session.hostName));
    }
    setBusy(false);
  };

  return (
    <div class={styles.notAdded}>
      <p>Not one of your folders</p>
      <Button variant="primary" icon="plus" disabledReason={reason} busy={busy} onClick={() => { void add(); }}>{busy ? "Adding…" : "Add this folder"}</Button>
      {refused && <p class={styles.refused} role="alert">{refused}</p>}
    </div>
  );
}
