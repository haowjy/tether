import { useEffect, useState } from "preact/hooks";
import { useApp, useAppView, useOverlay } from "../../app/context";
import { parseCreation } from "../../sessions/creation";
import { Button } from "../../ui/primitives/Button";
import { Dialog } from "../../ui/primitives/Dialog";
import { TextField } from "../../ui/primitives/TextField";
import { createAndOpen, type Target } from "./create";
import styles from "./CreateDialog.module.css";

/** The overlay params a creation dialog is opened with. */
export interface CreateParams extends Record<string, unknown> {
  handle: string;
  /** The tab whose session gets a new window; absent for a new session. */
  tab?: string;
  sessionName?: string;
}

function Form({ params, onCreating }: { params: CreateParams; onCreating: (creating: boolean) => void }) {
  const app = useApp();
  const [name, setName] = useState("");
  const [dir, setDir] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirError, setDirError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const host = app.hosts.get(params.handle);
  const target: Target = params.tab ? { kind: "window", tab: params.tab } : { kind: "session" };

  const submit = async (e: Event): Promise<void> => {
    e.preventDefault();
    if (busy || !host) return;
    const parsed = parseCreation(name, dir);
    setDirError("error" in parsed ? parsed.error : null);
    setError(null);
    if ("error" in parsed) return;
    setBusy(true);
    onCreating(target.kind === "window"); // the dialog closes inside createAndOpen, so the flag must already stand
    const result = await createAndOpen(app, host, target, parsed.ok);
    setBusy(false);
    if ("error" in result) {
      onCreating(false);
      setError(result.error);
    }
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

/** New session and New window (the creation overlays; a window is created from its tab, not from Home): one dialog, two titles. */
export function CreateDialog() {
  const { open, params: overlayParams, close } = useOverlay("home");
  const params = open ? (overlayParams as CreateParams) : null;
  const touch = useAppView((v) => v.viewport.density === "touch");
  // A window created from the desktop leaves the keyboard in the terminal; the opener is gone with its menu, and a phone raises no keyboard unasked.
  const [createdWindow, setCreatedWindow] = useState(false);
  useEffect(() => { if (open) setCreatedWindow(false); }, [open]);
  const title = params?.tab ? `New window in ${params.sessionName ?? "session"}` : "New session";
  return (
    <Dialog open={open} title={title} returnFocusTo={createdWindow && !touch ? "terminal" : null} onClose={close}>
      {params && <Form key={`${params.handle}/${params.tab ?? ""}`} params={params} onCreating={setCreatedWindow} />}
    </Dialog>
  );
}
