import { useState } from "preact/hooks";
import { useApp, useOverlay } from "../../app/context";
import type { SessionRef } from "../../proto/generated/messages";
import { parseCreation } from "../../sessions/creation";
import { Button } from "../../ui/primitives/Button";
import { Dialog } from "../../ui/primitives/Dialog";
import { TextField } from "../../ui/primitives/TextField";
import { createAndOpen, type Target } from "./create";
import styles from "./CreateDialog.module.css";

/** The overlay params a creation dialog is opened with. */
export interface CreateParams extends Record<string, unknown> {
  handle: string;
  /** The session a new window goes in; absent for a new session. */
  session?: SessionRef;
  sessionName?: string;
}

function Form({ params }: { params: CreateParams }) {
  const app = useApp();
  const [name, setName] = useState("");
  const [dir, setDir] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirError, setDirError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const host = app.hosts.get(params.handle);
  const target: Target = params.session ? { kind: "window", session: params.session } : { kind: "session" };

  const submit = async (e: Event): Promise<void> => {
    e.preventDefault();
    if (busy || !host) return;
    const parsed = parseCreation(name, dir);
    setDirError("error" in parsed ? parsed.error : null);
    setError(null);
    if ("error" in parsed) return;
    setBusy(true);
    const result = await createAndOpen(app, host, target, parsed.ok);
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
        <Button variant="primary" type="submit" disabledReason={busy ? "Creating" : undefined}>{busy ? "Creating…" : "Create"}</Button>
      </div>
    </form>
  );
}

/** New session and New window (the only overlays of Home): one dialog, two titles. */
export function CreateDialog() {
  const { open, params: overlayParams, close } = useOverlay("home");
  const params = open ? (overlayParams as CreateParams) : null;
  const title = params?.session ? `New window in ${params.sessionName ?? "session"}` : "New session";
  return (
    <Dialog open={open} title={title} onClose={close}>
      {params && <Form key={`${params.handle}/${String(params.session?.session)}`} params={params} />}
    </Dialog>
  );
}
