import { useEffect, useState } from "preact/hooks";
import { Tappable } from "../ui/Tappable";
import type { App, TabView } from "./app";

function useApp(app: App) {
  const [, rerender] = useState(0);
  useEffect(() => app.subscribe(() => { rerender((n) => n + 1); }), [app]);
  return app.snapshot;
}

function mark(tab: TabView): string {
  switch (tab.state.kind) {
    case "live":
      return "●";
    case "connecting":
      return "◌";
    case "reconnecting":
      return tab.state.halt ? `✕ ${tab.state.halt}` : "◌ reconnecting";
    case "closed":
      return "";
  }
}

/** Unstyled on purpose: enough to see and switch tabs until the visual UI lands. */
export function Chrome({ app }: { app: App }) {
  const { tabs, active, picker, notice } = useApp(app);
  return (
    <>
      {picker && (
        <div class="picker">
          {picker.kind === "loading" && <div>Loading windows…</div>}
          {picker.kind === "error" && <div>{picker.message}</div>}
          {picker.kind === "list" &&
            picker.listing.sessions.map((session) => (
              <div key={session.id}>
                <div>{session.name}</div>
                {session.windows.map((win) => (
                  <Tappable
                    key={win.id}
                    label={`Open ${session.name}:${String(win.index)} ${win.name}`}
                    onTap={() => { app.add(picker.host, { server: picker.listing.server, window: win.id }, `${session.name}:${win.name}`); }}
                  >
                    {String(win.index)}: {win.name}
                  </Tappable>
                ))}
              </div>
            ))}
          <Tappable label="Close" onTap={() => { app.closePicker(); }}>Close</Tappable>
        </div>
      )}
      {notice && <div class="notice">{notice}</div>}
      <div class="tabbar">
        {tabs.map((tab) => (
          <span key={tab.id} class={tab.id === active ? "tab active" : "tab"}>
            <Tappable label={`Tab ${tab.name}`} onTap={() => { app.activate(tab.id); }}>
              {mark(tab)} {tab.name}
            </Tappable>
            <Tappable label={`Close ${tab.name}`} onTap={() => { app.close(tab.id); }}>×</Tappable>
          </span>
        ))}
        <Tappable label="New tab" onTap={() => { void app.openPicker(); }}>+</Tappable>
      </div>
    </>
  );
}
