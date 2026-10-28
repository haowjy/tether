// The picker's New session page (browser-behaviors.md "Picker"): the "New session" row replaces the
// list, in the picker's own container, with this form; Back (the page's ‹, the system Back, Escape)
// returns to the list. Create does not close the picker: the new tab opens behind it and the picker
// comes back from the form to its list, where the tab's row reads "here".
import { useState } from "preact/hooks";
import { useApp } from "../../app/context";
import { absolute } from "../../files/pathfield";
import type { HostClient } from "../../net/hosts";
import { parseCreation } from "../../sessions/creation";
import { Button } from "../../ui/primitives/Button";
import { TextField } from "../../ui/primitives/TextField";
import { useCompletion } from "../files/completion";
import { FolderField } from "../files/FolderField";
import { filesSession } from "../files/session";
import { createAndOpen } from "./createSession";
import styles from "./NewSessionPage.module.css";

export const pageTitle = (hostName: string): string => `New session on ${hostName}`;

export function NewSessionPage({ host, initialName }: { host: HostClient; initialName: string }) {
  const app = useApp();
  const session = filesSession(app, host);
  const [name, setName] = useState(initialName);
  const [dir, setDir] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirError, setDirError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const field = useCompletion({
    session,
    text: dir === "" ? null : dir,
    setText: setDir,
    // Enter creates; a tap on a folder steps into it, so the path can go deeper before Create.
    enterOpens: false,
    onOpen: (path) => { setDir(`${path === "/" ? "" : path}/`); field.reset(); },
  });

  const submit = async (e: Event): Promise<void> => {
    e.preventDefault();
    if (busy) return;
    // The daemon's `newSession` takes an absolute path: `~` is the host's home.
    const parsed = parseCreation(name, field.home === null ? dir : absolute(dir, field.home));
    setDirError("error" in parsed ? parsed.error : null);
    setError(null);
    if ("error" in parsed) return;
    setBusy(true);
    const result = await createAndOpen(app, host, parsed.ok);
    setBusy(false);
    if ("error" in result) setError(result.error);
  };

  return (
    <form class={styles.page} onSubmit={(e) => { void submit(e); }}>
      <TextField label="Name" data-initial-focus="" value={name} onInput={setName} placeholder="Let tmux choose" hint="Optional." />
      <FolderField session={session} field={field} label="Start directory" value={dir} placeholder="tmux's default" hint="Optional. Starts with ~ or /." error={dirError} />
      {error && <p class={styles.error} role="alert">{error}</p>}
      <div class={styles.actions}>
        <Button variant="primary" type="submit" busy={busy}>{busy ? "Creating…" : "Create"}</Button>
      </div>
    </form>
  );
}
