// How a tab's connection reads on its pill, in the status band and on the host label.
import { initialState } from "../../tabs/connection";
import { describe, type Status, type Tone } from "../../tabs/status";
import type { Pill, PillTone } from "../../ui/primitives/TabStrip";
import { tabLabels } from "../../workspace/labels";
import type { Tab } from "../../workspace/state";
import type { TabStatus } from "./terminals";

export interface TabLook {
  tone: PillTone;
  /** The connection in words, so colour is never the only signal. */
  state: string;
  status: Status;
}

const PILL: Record<Tone, { tone: PillTone; state: string }> = {
  live: { tone: "live", state: "connected" },
  idle: { tone: "idle", state: "open" },
  connecting: { tone: "reconnecting", state: "connecting" },
  waiting: { tone: "reconnecting", state: "reconnecting" },
  halted: { tone: "error", state: "disconnected" },
  limited: { tone: "error", state: "session limit" },
  gone: { tone: "gone", state: "closed" },
};

/** `onScreen`: the active tab on the Terminal destination, the only one that watches. */
export function lookOf(tab: Tab, status: TabStatus | undefined, host: string, onScreen: boolean, now: number): TabLook {
  const known = status ?? { state: initialState, downSince: now, retryAt: null };
  const described = describe(known.state, known.downSince, known.retryAt, now, host, onScreen);
  // A restored tab is unproven until the daemon finds its session: reconnecting colour, "Checking…", no input.
  if (tab.restoring && known.state.kind !== "closed") {
    const checking = described.tone === "connecting" || described.tone === "idle" || described.tone === "live";
    return {
      tone: "reconnecting",
      state: "checking",
      status: checking ? { ...described, tone: "connecting", detail: onScreen && now - known.downSince >= 1_500 ? "Checking…" : null } : described,
    };
  }
  return { ...PILL[described.tone], status: described };
}

/** The open tabs as pills; `onScreen` is the tab that is on the Terminal destination, if any. */
export function tabPills(
  tabs: readonly Tab[],
  statuses: Readonly<Record<string, TabStatus>>,
  hostName: (hostId: string) => string,
  onScreen: string | null,
  now: number,
): Pill[] {
  // tabLabels keeps the order of `tabs`, so the two line up.
  return tabLabels(tabs, hostName).flatMap((l, i) => {
    const tab = tabs[i];
    if (!tab) return [];
    const look = lookOf(tab, statuses[tab.id], hostName(tab.key.host), tab.id === onScreen, now);
    return [{ id: tab.id, session: l.session, window: l.window, full: l.full, tone: look.tone, state: look.state }];
  });
}

/** The band's colour: halted and limited tabs are errors, a tab still trying is reconnecting. */
export function bandTone(tone: Tone): "reconnecting" | "error" {
  return tone === "halted" || tone === "limited" || tone === "gone" ? "error" : "reconnecting";
}
