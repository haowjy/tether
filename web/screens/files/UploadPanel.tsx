import { useApp, useAppView } from "../../app/context";
import { baseName } from "../../files/browser";
import type { UploadItem } from "../../files/uploads";
import { useStore } from "../../ui/store";
import { Button } from "../../ui/primitives/Button";
import { Icon } from "../../ui/primitives/Icon";
import { IconButton } from "../../ui/primitives/IconButton";
import { Spinner } from "../../ui/primitives/Spinner";
import { insertPath, insertTarget } from "./insert";
import type { FilesSession } from "./session";
import styles from "./UploadPanel.module.css";

function Item({ session, item, onPreview }: { session: FilesSession; item: UploadItem; onPreview: (path: string) => void }) {
  const app = useApp();
  // The offer follows the tab the upload began in, never the one active now.
  useAppView((v) => v.workspace.tabs);
  const dismiss = (): void => { session.uploads.dismiss(item.id); };

  if (item.state === "uploading") {
    const percent = Math.round(item.progress * 100);
    return (
      <li class={styles.item}>
        <Spinner label="Uploading" />
        <div class={styles.text}>
          <p class={styles.title}>{item.progress === 0 ? "Waiting to upload" : `Uploading ${String(percent)}%`}</p>
          <progress class={styles.progress} max={100} value={percent} aria-label="Upload progress" />
        </div>
      </li>
    );
  }
  if (item.state === "failed") {
    return (
      <li class={styles.item}>
        <Icon name="alert" class={styles.error} />
        <div class={styles.text}>
          <p class={styles.title} role="alert">{item.message}</p>
        </div>
        <IconButton icon="close" label="Dismiss" onClick={dismiss} />
      </li>
    );
  }
  const target = insertTarget(app, item.target);
  return (
    <li class={styles.item}>
      <Icon name="check" class={styles.ok} />
      <div class={styles.text}>
        <p class={styles.title} role="status">Saved {baseName(item.path)}</p>
        <div class={styles.actions}>
          <Button
            variant="primary"
            icon="terminal"
            disabledReason={target ? undefined : item.target === null ? "Open a terminal tab first" : "That tab was closed"}
            onClick={() => { if (insertPath(app, item.target ?? "", item.path)) dismiss(); }}
          >
            {target ? `Insert path into ${target.label}` : "Insert path"}
          </Button>
          <Button variant="quiet" onClick={() => { onPreview(item.path); }}>Preview</Button>
        </div>
      </div>
      <IconButton icon="close" label="Dismiss" onClick={dismiss} />
    </li>
  );
}

/** The uploads this screen started: progress, then Insert path for the tab each began in. */
export function UploadPanel({ session, onPreview }: { session: FilesSession; onPreview: (path: string) => void }) {
  const { items } = useStore(session.uploads, (s) => s);
  if (items.length === 0) return null;
  return (
    <ul class={styles.panel} aria-label="Uploads">
      {items.map((item) => <Item key={item.id} session={session} item={item} onPreview={onPreview} />)}
    </ul>
  );
}
