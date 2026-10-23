import { useState } from "preact/hooks";
import { useApp } from "../../app/context";
import type { HostClient } from "../../net/hosts";
import { Button } from "../../ui/primitives/Button";
import { TextField } from "../../ui/primitives/TextField";
import styles from "./Enrol.module.css";

/**
 * Enrolment for a host that admits this device as a tailnet node. One enrolment covers the
 * whole machine (Safari, the installed PWA and any other browser on it), but storage is not
 * shared: each keeps its own drafts and workspace.
 */
export function Enrol({ host }: { host: HostClient }) {
  const app = useApp();
  const nodeName = host.admission.kind === "notEnrolled" ? (host.admission.nodeName ?? "this device") : "this device";
  const hostName = host.name ?? "the server";
  const [code, setCode] = useState("");
  const [deviceName, setDeviceName] = useState(nodeName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: Event): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await app.hosts.enrol(host.entry.handle, code.trim(), deviceName.trim() || nodeName);
    setBusy(false);
    if (result.kind === "badCode") setError("That code is wrong or has expired");
    else if (result.kind === "tryAgain") setError("tether is busy, try again");
    // `enrolled` and `nodeRefused` change the host's admission, which swaps this screen out.
  };

  return (
    <div class={styles.page}>
      <form class={styles.form} onSubmit={(e) => { void submit(e); }}>
        <h1 class={styles.title}>Set up {hostName}</h1>
        <p>
          This lets every browser and app on <strong>{nodeName}</strong> use tether on <strong>{hostName}</strong>.
          Safari and the installed app keep their own drafts and tabs.
        </p>
        <p class={styles.step}>On the server, run <code>tether enroll</code> and enter the code it prints.</p>
        <TextField label="Code" value={code} onInput={setCode} inputMode="numeric" error={error} />
        <TextField label="Device name" value={deviceName} onInput={setDeviceName} hint="Shown in the server's device list." />
        <Button variant="primary" type="submit" disabledReason={busy ? "Enrolling" : code.trim() === "" ? "Enter the code from the server" : undefined}>
          {busy ? "Enrolling…" : "Enrol this device"}
        </Button>
      </form>
    </div>
  );
}
