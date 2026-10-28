import { useState } from "preact/hooks";
import { useApp, useOverlay } from "../../app/context";
import { parseCreation } from "../../sessions/creation";
import { Button } from "../../ui/primitives/Button";
import { Dialog } from "../../ui/primitives/Dialog";
import { TitleBar } from "../../ui/primitives/DialogBars";
import { TextField } from "../../ui/primitives/TextField";
import { createAndOpen } from "./create";
import styles from "./CreateDialog.module.css";

/** The overlay params a creation dialog is opened with. */
export interface CreateParams extends Record<string, unknown> {
  handle: string;
}

function Form({ params }: { params: CreateParams }) {
  const app = useApp();
  const [name, setName] = useState("");
  const [dir, setDir] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirError, setDirError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const host = app.hosts.get(params.handle);

  const submit = async (e: Event): Promise<void> => {
    e.preventDefault();
    if (busy || !host) return;
    const parsed = parseCreation(name, dir);
    setDirError("error" in parsed ? parsed.error : null);
    setError(null);
    if ("error" in parsed) return;
    setBusy(true);
    const result = await createAndOpen(app, host, parsed.ok);
    setBusy(false);
    if ("error" in result) setError(result.error);
  };

  return (
    <form class={styles.form} onSubmit={(e) => { void submit(e); }}>
      <TextField label="Name" data-initial-focus="" value={name} onInput={setName} placeholder="Let tmux choose" hint="Optional." />
      <TextField label="Start directory" value={dir} onInput={setDir} placeholder="tmux's default" hint="Optional. An absolute path on the server." error={dirError} />
      {error && <p class={styles.error} role="alert">{error}</p>}
      <div class={styles.actions}>
        <Button variant="quiet" onClick={() => { app.router.closeOverlay(); }}>Cancel</Button>
        <Button variant="primary" type="submit" busy={busy}>{busy ? "Creating…" : "Create"}</Button>
      </div>
    </form>
  );
}

/** The New session overlay. */
export function CreateDialog() {
  const { open, params: overlayParams, close } = useOverlay("home");
  const params = open ? (overlayParams as CreateParams) : null;
  return (
    <Dialog open={open} title="New session" header={<TitleBar title="New session" onClose={close} />} onClose={close}>
      {params && <Form key={params.handle} params={params} />}
    </Dialog>
  );
}
