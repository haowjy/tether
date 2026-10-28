// One server's block in the picker: "On pop-os" and its status, then the side's list. Both sides
// (sessions, folders) draw their servers the same way. The heading tells servers apart, so it is
// drawn only when several are listed; a lone server's status stands on its own line when it has one.
import type { ComponentChildren } from "preact";
import { useAppView } from "../../app/context";
import type { HostClient } from "../../net/hosts";
import { Spinner } from "../../ui/primitives/Spinner";
import styles from "./HostSection.module.css";

/** Hosts whose sessions or folders can be listed or are about to be; the others show a banner or the Enrol screen instead. */
const LISTABLE = new Set(["admitted", "deciding", "unreachable"]);

/** The servers a picker side draws: every listable one, grouped when several. */
export function useListedHosts(): HostClient[] {
  return useAppView((v) => v.hosts).filter((h) => LISTABLE.has(h.admission.kind));
}

interface HostSectionProps {
  hostName: string;
  label: string;
  /** Several servers are listed: head this one's block with its name. */
  titled: boolean;
  status?: ComponentChildren;
  children: ComponentChildren;
}

export function HostSection({ hostName, label, titled, status, children }: HostSectionProps) {
  const note = <span class={styles.status} role="status">{status}</span>;
  return (
    <section class={styles.section} aria-label={label}>
      {titled ? (
        <div class={styles.heading}>
          <h2 class={styles.title}>On {hostName}</h2>
          {note}
        </div>
      ) : note}
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
