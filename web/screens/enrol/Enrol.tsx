import { useState } from "preact/hooks";
import { useApp } from "../../app/context";
import type { HostClient } from "../../net/hosts";
import { Button } from "../../ui/primitives/Button";
import { CodeField } from "../../ui/primitives/CodeField";
import { TextField } from "../../ui/primitives/TextField";
import styles from "./Enrol.module.css";

const CODE_LENGTH = 8;

/**
 * Enrolment for a host that admits this device as a tailnet node. One enrolment covers the
 * whole machine (Safari, the installed PWA and any other browser on it), but storage is not
 * shared: each keeps its own drafts and workspace.
 */
export function Enrol({ host }: { host: HostClient }) {
  const app = useApp();
  const nodeName = host.admission.kind === "notEnrolled" ? (host.admission.nodeName ?? "this device") : "this device";
  const hostName = host.name ?? "the server";
  const origin = host.entry.pageOrigin;
  // A setup link's code prefills the field and waits: it enrols only when the reader taps.
  const [code, setCode] = useState(app.enrolCode ?? "");
  const [deviceName, setDeviceName] = useState(nodeName);
  // The code step first either way: a link fills the cells and the reader sees what it carried.
  const [step, setStep] = useState<"code" | "name">("code");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    if (busy || code.length !== CODE_LENGTH) return;
    setBusy(true);
    setError(null);
    const result = await app.hosts.enrol(host.entry.handle, code, deviceName.trim() || nodeName);
    setBusy(false);
    if (result.kind === "badCode") setError("That code is wrong or has expired");
    else if (result.kind === "tryAgain") setError("tether is busy, try again");
    else if (result.kind === "enrolled") app.enrolled(origin);
    // `enrolled` and `nodeRefused` change the host's admission, which swaps this screen out.
  };

  const { openInApp } = app.platform;
  const handoff = openInApp && origin && code.length === CODE_LENGTH && (
    <Button onClick={() => { openInApp(origin, code); }}>Open in the tether app</Button>
  );

  const onCode = step === "code";
  return (
    <div class={styles.page}>
      <form
        class={styles.form}
        // Enter moves a step on, then enrols: one handler, so the keyboard's key does what the button says.
        onSubmit={(e) => { e.preventDefault(); if (onCode) { if (code.length === CODE_LENGTH) setStep("name"); } else void submit(); }}
      >
        <h1 class={styles.title}>Set up {hostName}</h1>
        <p>
          This lets every browser and app on <strong>{nodeName}</strong> use tether on <strong>{hostName}</strong>.
          Safari and the installed app keep their own drafts and tabs.
        </p>
        {onCode ? (
          <>
            <p class={styles.step}>On the server, run <code>tether enroll</code> and enter the code it prints.</p>
            <CodeField label="Code" value={code} onInput={setCode} />
            <Button variant="primary" type="submit" disabledReason={code.length === CODE_LENGTH ? undefined : "Enter all eight characters of the code"}>Next</Button>
          </>
        ) : (
          <>
            <TextField label="Device name" value={deviceName} onInput={setDeviceName} hint="Shown in the server's device list." />
            {error && <p class={styles.error} role="alert">{error}</p>}
            <div class={styles.actions}>
              <Button onClick={() => { setError(null); setStep("code"); }} busy={busy}>Back</Button>
              <Button variant="primary" type="submit" busy={busy}>
                {busy ? "Enrolling…" : "Enrol this device"}
              </Button>
            </div>
          </>
        )}
        {handoff}
      </form>
    </div>
  );
}
