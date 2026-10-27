// Settings (client-architecture.md §4.3): a full-screen page behind the gear in Home's header,
// the router overlay `{ screen: "settings", name: "settings" }` (an overlay and not a route: Back,
// Escape and focus return to the gear are the router's and `Dialog`'s already, and a route would
// add a Route, a hash and a saved form for a screen that never holds state). Servers, this
// device (Remove this device, where the host admits it as a tailnet node), the keyboard, Clear
// local data, and the preferences the platform keeps: appearance, terminal text size and, in the
// app, when Face ID asks again. Each destructive action confirms in its own overlay, so Back from
// the confirmation returns here.
import type { ComponentChildren } from "preact";
import { useId, useState } from "preact/hooks";
import { useApp, useAppView, useOverlay } from "../../app/context";
import type { HostClient } from "../../net/hosts";
import type { Appearance, Relock, TextSize } from "../../platform/types";
import { Button } from "../../ui/primitives/Button";
import { Choice } from "../../ui/primitives/Choice";
import { Dialog } from "../../ui/primitives/Dialog";
import { PageBar, TitleBar } from "../../ui/primitives/DialogBars";
import styles from "./Settings.module.css";

const APPEARANCES: Array<{ value: Appearance; label: string }> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];
const TEXT_SIZES: Array<{ value: TextSize; label: string }> = [
  { value: "small", label: "Small" },
  { value: "default", label: "Default" },
  { value: "large", label: "Large" },
  { value: "larger", label: "Larger" },
];
const RELOCKS: Array<{ value: Relock; label: string }> = [
  { value: "5min", label: "5 min" },
  { value: "1hour", label: "1 hour" },
  { value: "launch", label: "At launch" },
];

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
    <Dialog open={open} title={title} header={<TitleBar title={title} onClose={close} />} onClose={close}>
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

/** One group on the page: a heading, what it covers, and its controls. */
function Section({ title, detail, children }: { title: string; detail: ComponentChildren; children?: ComponentChildren }) {
  const id = useId();
  return (
    <section class={styles.section} aria-labelledby={id}>
      <h3 id={id} class={styles.heading}>{title}</h3>
      <p class={styles.detail}>{detail}</p>
      {children}
    </section>
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
  const preferences = useAppView((v) => v.preferences);
  const keyboard = useAppView((v) => v.viewport.directInput === "xterm");
  const canRemove = removable(hosts);
  // The one host this device would be removed from. The browser has exactly one.
  const target = canRemove[0];
  const hostName = target?.name ?? "the server";
  const device = target?.admission.kind === "admitted" ? (target.admission.deviceName ?? "this device") : "this device";

  const manageHosts = app.platform.manageHosts;

  const ask = (name: Confirmation, from: Element): void => { app.openOverlay({ screen: "settings", name }, from); };

  return (
    <>
      <Dialog open={open} title="Settings" variant="page" header={<PageBar back="Back to Home" onBack={close} title="Settings" />} onClose={close}>
        {open && (
          <div class={styles.sections}>
            <Section title="Appearance" detail="System follows your device's light or dark setting.">
              <Choice label="Appearance" options={APPEARANCES} value={preferences.appearance} onChange={(v) => { app.platform.setPreference("appearance", v); }} />
            </Section>
            <Section title="Terminal text size" detail="Applies to every terminal. The window you open next is resized to fit this screen at that size.">
              <Choice label="Terminal text size" options={TEXT_SIZES} value={preferences.textSize} onChange={(v) => { app.platform.setPreference("textSize", v); }} />
            </Section>
            {preferences.relock !== undefined && (
              <Section title="Ask for Face ID" detail="How long tether can stay in the background before it asks for Face ID again. At launch asks once each time the app starts.">
                <Choice label="Ask for Face ID" options={RELOCKS} value={preferences.relock} onChange={(v) => { app.platform.setPreference("relock", v); }} />
              </Section>
            )}
            {manageHosts && (
              <Section
                title="Servers"
                detail={<>The servers this app connects to. Add one, pair it again with a code from <code>tether enroll</code>, or remove it.</>}
              >
                <Button variant="secondary" onClick={manageHosts}>Manage servers</Button>
              </Section>
            )}
            {target && (
              <Section
                title="This device"
                detail={<>Every browser and app on {device} uses tether on {hostName}. Removing it signs them all out; enrol again with <code>tether enroll</code>.</>}
              >
                <Button variant="secondary" class={styles.danger} onClick={(e) => { ask("removeDevice", e.currentTarget); }}>Remove this device</Button>
              </Section>
            )}
            {keyboard && (
              <Section
                title="Keyboard"
                detail={<><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> leaves the terminal and focuses the tab strip; Enter on a tab returns. <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd> copies the selection and <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd> pastes. Every other key goes to tmux.</>}
              />
            )}
            <Section title="Local data" detail={`Drafts and the saved tabs on this device. Nothing on ${hostName} changes, and tmux keeps running.`}>
              <Button variant="secondary" class={styles.danger} onClick={(e) => { ask("clearData", e.currentTarget); }}>Clear local data</Button>
            </Section>
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
          await app.persist.clearLocalData();
          app.notify("Local data cleared");
          return null;
        }}
      >
        Drafts and the saved tabs on this device are deleted. Tabs open now stay until you close them, and are not saved again.
      </Confirm>
    </>
  );
}
