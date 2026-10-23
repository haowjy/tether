import { useApp } from "../../app/context";
import type { HostClient } from "../../net/hosts";
import { admissionCopy } from "../../ui/hostProblem";
import { Button } from "../../ui/primitives/Button";
import { Icon } from "../../ui/primitives/Icon";
import styles from "./Enrol.module.css";

/**
 * The refusals with no form and no retry: the page is at the wrong origin, browsers can't
 * use the host, the node can never be admitted, or the protocol differs. Each says why, in
 * words, and what would fix it.
 */
export function HostProblem({ host }: { host: HostClient }) {
  const app = useApp();
  const copy = admissionCopy(host.admission, host.name ?? "the server", host.entry.pageOrigin === null);
  if (!copy) return null;
  const { admission } = host;
  return (
    <div class={styles.page}>
      <div class={styles.form}>
        <Icon name="alert" size={24} class={styles.glyph} />
        <h1 class={styles.title}>{copy.title}</h1>
        {copy.hint && <p class={styles.step}>{copy.hint}</p>}
        {admission.kind === "wrongOrigin" && <Button variant="primary" onClick={() => { app.platform.openURL(admission.origin); }} icon="external">Open {admission.origin}</Button>}
        {admission.kind === "incompatible" && app.platform.updates && <Button variant="primary" onClick={() => { app.applyUpdate(); }}>Update</Button>}
        {admission.kind === "incompatible" && !app.platform.updates && <p class={styles.step}>Update the app.</p>}
      </div>
    </div>
  );
}
