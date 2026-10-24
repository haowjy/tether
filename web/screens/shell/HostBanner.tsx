import { useEffect, useState } from "preact/hooks";
import { useApp } from "../../app/context";
import type { HostClient } from "../../net/hosts";
import { admissionCopy, hostProblem } from "../../ui/hostProblem";
import { Banner } from "../../ui/primitives/Banner";

/** "Checking access…" appears only after the daemon has been undecided this long. */
const CHECKING_AFTER_MS = 10_000;

/** What is wrong with one host, when it is something the rest of the app keeps working through. */
export function HostBanner({ host }: { host: HostClient }) {
  const app = useApp();
  const [now, setNow] = useState(() => Date.now());
  const { admission } = host;

  useEffect(() => {
    if (admission.kind !== "deciding" || host.checkingSince === null) return;
    const timer = setTimeout(() => { setNow(Date.now()); }, Math.max(0, host.checkingSince + CHECKING_AFTER_MS - Date.now()) + 50);
    return () => { clearTimeout(timer); };
  }, [admission.kind, host.checkingSince]);

  const name = host.name ?? "the server";
  const byToken = host.entry.pageOrigin === null;
  if (admission.kind === "unreachable") {
    const copy = admissionCopy(admission, name, byToken);
    return copy && <Banner tone="warning" title={copy.title} action={{ label: "Retry", onAction: () => { app.hosts.recheck(host.entry.handle); } }}>{copy.hint}</Banner>;
  }
  if (admission.kind === "admitted" && host.overCap) {
    const copy = hostProblem("overCap", name);
    return <Banner tone="warning" title={copy.title} action={{ label: "Retry", onAction: () => { host.socket.nudge(); } }}>{copy.hint}</Banner>;
  }
  if (admission.kind === "deciding" && host.checkingSince !== null && now - host.checkingSince >= CHECKING_AFTER_MS) {
    return <Banner tone="info" title="Checking access…" />;
  }
  if (admission.kind === "notEnrolled" && byToken) {
    const copy = admissionCopy(admission, name, true);
    const manage = app.platform.manageHosts;
    return copy && <Banner tone="error" title={copy.title} {...(manage && { action: { label: "Servers", onAction: manage } })}>{copy.hint}</Banner>;
  }
  return null;
}
