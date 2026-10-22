import { useEffect, useRef } from "preact/hooks";
import { Tappable } from "../ui/Tappable";
import { ChevronLeft, Close, Keyboard, KeyboardHide, Plus } from "../ui/icons";
import type { App, TabView } from "./app";
import { describe, type Tone } from "./status";

/** The state dot: ● live, ◌ connecting or (pulsing) reconnecting, red halted, ✕ gone. */
export function Dot({ tone }: { tone: Tone }) {
  return <span class={`dot dot-${tone}`} aria-hidden="true" />;
}

function Pill({ app, tab, active, now }: { app: App; tab: TabView; active: boolean; now: number }) {
  const status = describe(tab.state, tab.downSince ?? now, tab.retryAt, now, app.hostName(tab.host), active);
  const gone = status.tone === "gone";
  const ref = useRef<HTMLDivElement>(null);
  // Keep the tab on screen in view when it changes or opens off the edge. Not
  // scrollIntoView: that also scrolls the overflow-hidden ancestors, shifting the page.
  useEffect(() => {
    const pill = ref.current;
    const row = pill?.parentElement;
    if (!active || !pill || !row) return;
    const left = pill.offsetLeft - row.offsetLeft;
    const right = left + pill.offsetWidth;
    if (left < row.scrollLeft) row.scrollLeft = left;
    else if (right > row.scrollLeft + row.clientWidth) row.scrollLeft = right - row.clientWidth;
  }, [active]);
  return (
    <div ref={ref} class={`pill${active ? " pill-active" : ""}${gone ? " pill-gone" : ""}`}>
      <Tappable
        class="pill-body"
        label={`${tab.name}${status.short ? `, ${status.short}` : ""}${status.action ? `. Tap to ${status.action.toLowerCase()}` : ""}`}
        onTap={() => { app.activate(tab.id); }}
        disabled={gone}
      >
        <Dot tone={status.tone} />
        <span class="pill-name">{tab.name}</span>
        {active && status.short && <span class={`pill-short pill-short-${status.tone}`}>{status.short}</span>}
      </Tappable>
      {!gone && (
        <Tappable class="pill-close" label={`Close ${tab.name}`} onTap={() => { app.close(tab.id); }}>
          <Close size={14} />
        </Tappable>
      )}
    </div>
  );
}

/** The bottom bar (plan.md "Layout"): `[<]`, the tab pills scrolling sideways, `[+]`, `[⌨]`. */
export function TabBar({ app, now }: { app: App; now: number }) {
  const { tabs, active, keyboard } = app.snapshot;
  return (
    <div class="bar">
      <Tappable class="bar-icon" label="Home" onTap={() => { app.openSheet("home"); }}>
        <ChevronLeft />
      </Tappable>
      <div class="pills">
        {tabs.map((tab) => <Pill key={tab.id} app={app} tab={tab} active={tab.id === active} now={now} />)}
      </div>
      <Tappable class="bar-icon" label="Open a window" onTap={() => { app.openSheet("attach"); }}>
        <Plus />
      </Tappable>
      <Tappable class="bar-icon" label={keyboard ? "Hide keyboard" : "Show keyboard"} onTap={() => { app.toggleKeyboard(); }}>
        {keyboard ? <KeyboardHide /> : <Keyboard />}
      </Tappable>
    </div>
  );
}
