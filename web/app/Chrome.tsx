import { useEffect, useState } from "preact/hooks";
import { Tappable } from "../ui/Tappable";
import { Lock, Plus, ToBottom } from "../ui/icons";
import type { App, AppView } from "./app";
import { Sheets } from "./Sheets";
import { describe } from "./status";
import { TabBar } from "./TabBar";

function useApp(app: App): AppView {
  const [, rerender] = useState(0);
  useEffect(() => app.subscribe(() => { rerender((n) => n + 1); }), [app]);
  return app.snapshot;
}

/** The clock, ticking once a second only while some tab is down and counting. */
function useNow(ticking: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!ticking) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => { setNow(Date.now()); }, 1000);
    return () => { clearInterval(timer); };
  }, [ticking]);
  return ticking ? now : Date.now();
}

/** Over the terminal's bottom rows, never beside them, so it never changes the tmux size. */
function StatusStrip({ app, now }: { app: App; now: number }) {
  const tab = app.activeTab();
  if (!tab) return null;
  const status = describe(tab.state, tab.downSince ?? now, tab.retryAt, now, app.hostName(tab.host), true);
  if (!status.detail) return null;
  const body = (
    <>
      <span class={`strip-dot dot dot-${status.tone}`} aria-hidden="true" />
      <span class="strip-text">
        <span class="strip-detail">{status.detail}</span>
        {status.hint && <span class="strip-hint">{status.hint}</span>}
      </span>
      {status.action && <span class="strip-action">{status.action}</span>}
    </>
  );
  return status.action
    ? <Tappable class={`strip strip-${status.tone}`} label={`${status.detail} ${status.action}`} onTap={() => { app.activate(tab.id); }}>{body}</Tappable>
    : <div class={`strip strip-${status.tone}`} role="status">{body}</div>;
}

/** The web UI over and around the terminal: bar, strip, sheets, and the whole-screen states. */
export function Chrome({ app }: { app: App }) {
  const view = useApp(app);
  const { tabs, notice, keyboard, locked, scrolledUp } = view;
  const active = app.activeTab();
  // Off-screen tabs rest in `connecting`; only a countdown or a slow connect needs the clock.
  const now = useNow(tabs.some((t) => t.state.kind === "reconnecting") || active?.state.kind === "connecting");
  return (
    <>
      {tabs.length === 0 && (
        <div class="no-tabs">
          <div class="empty-title">No tabs open</div>
          <div class="empty-hint">Each tab is one tmux window.</div>
          <Tappable class="action action-primary" label="Open a window" onTap={() => { app.openSheet("attach"); }}>
            <Plus /> Open a window
          </Tappable>
        </div>
      )}
      <div class={`bottom${keyboard ? " bottom-keyboard" : ""}`}>
        <div class="floats">
          {scrolledUp && active?.state.kind === "live" && (
            <Tappable class="jump" label="Jump to the newest output" onTap={() => { app.scrollToBottom(); }}>
              <ToBottom />
            </Tappable>
          )}
          {notice
            ? <Tappable class="strip strip-notice" label={`${notice} Dismiss`} onTap={() => { app.dismissNotice(); }}><span class="strip-text"><span class="strip-detail">{notice}</span></span></Tappable>
            : <StatusStrip app={app} now={now} />}
        </div>
        <TabBar app={app} now={now} />
      </div>
      <Sheets app={app} />
      {locked && (
        <div class="lock" role="alert">
          <Lock />
          <div class="empty-title">tether is locked</div>
          <div class="empty-hint">Unlock with Face ID to reconnect.</div>
        </div>
      )}
    </>
  );
}
