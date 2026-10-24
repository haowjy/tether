// Settings (client-architecture.md §4.3): the overlay behind Home's Settings row. Remove this
// device (a host that admits this device as a tailnet node), Clear local data, and, on a phone
// that hasn't installed the app, how to Add to Home Screen. Each destructive action confirms in
// its own overlay, so Back from the confirmation returns here.
import { useState } from "preact/hooks";
import { useApp, useAppView, useOverlay } from "../../app/context";
import type { HostClient } from "../../net/hosts";
import { Button } from "../../ui/primitives/Button";
import { Dialog } from "../../ui/primitives/Dialog";
import styles from "./Settings.module.css";

type Confirmation = "removeDevice" | "clearData";

function Confirm({ name, title, confirmLabel, run, children }: {
  name: Confirmation;
  title: string;
  confirmLabel: string;
  /** Resolves with an error to show, or null when done. */
  run: () => Promise<string | null>;
  children: string;
}) {
  const app = useApp();
  const { open, close } = useOverlay("settings", name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const failed = await run();
    setBusy(false);
    if (failed) setError(failed);
    else app.router.closeAllOverlays(); // a finished action leaves nothing open
  };
  return (
    <Dialog open={open} title={title} onClose={close}>
      {open && (
        <div class={styles.confirm}>
          <p>{children}</p>
          {error && <p class={styles.error} role="alert">{error}</p>}
          <div class={styles.actions}>
            <Button variant="quiet" onClick={close}>Cancel</Button>
            <Button variant="primary" disabledReason={busy ? "Working" : undefined} onClick={() => { void confirm(); }}>
              {busy ? "Working…" : confirmLabel}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

/** Hosts that admit this device as a tailnet node, and so can forget it. */
function removable(hosts: HostClient[]): HostClient[] {
  return hosts.filter((h) => h.entry.pageOrigin !== null && h.admission.kind === "admitted");
}

export function Settings() {
  const app = useApp();
  const { open, close } = useOverlay("settings");
  const hosts = useAppView((v) => v.hosts);
  const phone = useAppView((v) => v.viewport.layout === "phone");
  const keyboard = useAppView((v) => v.viewport.directInput === "xterm");
  const canRemove = removable(hosts);
  // The one host this device would be removed from. The browser has exactly one.
  const target = canRemove[0];
  const hostName = target?.name ?? "the server";
  const device = target?.admission.kind === "admitted" ? (target.admission.deviceName ?? "this device") : "this device";
  const install = app.platform.install;
  const showInstall = phone && install !== undefined && !install.installed();

  const manageHosts = app.platform.manageHosts;

  const ask = (name: Confirmation, from: Element): void => { app.openOverlay({ screen: "settings", name }, from); };

  return (
    <>
      <Dialog open={open} title="Settings" onClose={close}>
        {open && (
          <div class={styles.sections}>
            {manageHosts && (
              <section class={styles.section} aria-labelledby="settings-servers">
                <h3 id="settings-servers" class={styles.heading}>Servers</h3>
                <p class={styles.detail}>The servers this app connects to. Add one, pair it again with a code from <code>tether enroll</code>, or remove it.</p>
                <Button variant="secondary" onClick={manageHosts}>Manage servers</Button>
              </section>
            )}
            {target && (
              <section class={styles.section} aria-labelledby="settings-device">
                <h3 id="settings-device" class={styles.heading}>This device</h3>
                <p class={styles.detail}>
                  Every browser and app on {device} uses tether on {hostName}. Removing it signs them all out; enrol again with <code>tether enroll</code>.
                </p>
                <Button variant="secondary" class={styles.danger} onClick={(e) => { ask("removeDevice", e.currentTarget); }}>Remove this device</Button>
              </section>
            )}
            {keyboard && (
              <section class={styles.section} aria-labelledby="settings-keys">
                <h3 id="settings-keys" class={styles.heading}>Keyboard</h3>
                <p class={styles.detail}>
                  <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> leaves the terminal and focuses the tab strip; Enter on a tab returns. <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd> copies the selection and <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd> pastes. Every other key goes to tmux.
                </p>
              </section>
            )}
            <section class={styles.section} aria-labelledby="settings-data">
              <h3 id="settings-data" class={styles.heading}>Local data</h3>
              <p class={styles.detail}>Drafts and the saved tabs on this device. Nothing on {hostName} changes, and tmux keeps running.</p>
              <Button variant="secondary" class={styles.danger} onClick={(e) => { ask("clearData", e.currentTarget); }}>Clear local data</Button>
            </section>
            {showInstall && (
              <section class={styles.section} aria-labelledby="settings-install">
                <h3 id="settings-install" class={styles.heading}>Add to Home Screen</h3>
                <ol class={styles.steps}>
                  <li>Tap Share in Safari.</li>
                  <li>Tap Add to Home Screen.</li>
                </ol>
                <p class={styles.detail}>The installed app and Safari keep separate drafts and tabs, though one enrolment covers both.</p>
              </section>
            )}
          </div>
        )}
      </Dialog>
      {target && (
        <Confirm
          name="removeDevice"
          title="Remove this device?"
          confirmLabel="Remove this device"
          run={async () => ((await app.hosts.removeDevice(target.entry.handle)) ? null : `Couldn't reach ${hostName}. Nothing was removed.`)}
        >
          {`Every browser and app on ${device} will lose access to ${hostName}.`}
        </Confirm>
      )}
      <Confirm
        name="clearData"
        title="Clear local data?"
        confirmLabel="Clear local data"
        run={async () => {
          await app.platform.storage.clearLocalData();
          app.notify("Local data cleared");
          return null;
        }}
      >
        Drafts and the saved tabs on this device are deleted. Open tabs stay until you close them.
      </Confirm>
    </>
  );
}
