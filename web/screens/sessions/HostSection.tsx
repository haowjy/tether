// One server's block in the picker: "On pop-os" and its status, then the side's list. Both sides
// (sessions, folders) draw their servers the same way.
import type { ComponentChildren } from "preact";
import { useAppView } from "../../app/context";
import type { HostClient } from "../../net/hosts";
import { Spinner } from "../../ui/primitives/Spinner";
import styles from "./HostSection.module.css";

/** Hosts whose sessions or folders can be listed or are about to be; the others show a banner or the Enrol screen instead. */
const LISTABLE = new Set(["admitted", "deciding", "unreachable"]);

/** The servers a picker side draws: every listable one, or only the one with handle `only` (a server's own sheet). */
export function useListedHosts(only?: string): HostClient[] {
  return useAppView((v) => v.hosts).filter((h) => LISTABLE.has(h.admission.kind) && (only === undefined || h.entry.handle === only));
}

export function HostSection({ hostName, label, status, children }: { hostName: string; label: string; status?: ComponentChildren; children: ComponentChildren }) {
  return (
    <section class={styles.section} aria-label={label}>
      <div class={styles.heading}>
        <h2 class={styles.title}>On {hostName}</h2>
        <span class={styles.status} role="status">{status}</span>
      </div>
      {children}
    </section>
  );
}

export function Loading({ what }: { what: string }) {
  return (
    <div class={styles.loading}>
      <Spinner label={what} />
      <span>{what}</span>
    </div>
  );
}
