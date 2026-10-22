import type { TmuxListing } from "../proto/generated/messages";
import { sameWindow } from "../proto/window";
import { ago } from "../ui/format";
import { useStore } from "../ui/store";
import { Tappable } from "../ui/Tappable";
import { ChevronRight, Close, Folder, Plus, Refresh } from "../ui/icons";
import { CloseButton, Empty, Sheet, SheetHeader } from "../ui/Sheet";
import { FilesSheet } from "../files/FilesSheet";
import type { App } from "./app";
import { describe, hostProblem } from "./status";
import { Dot } from "./TabBar";
import type { Draft, WindowList, WindowsSheet } from "./windows";

/** The last two segments of a path, enough to recognise a project. */
function shortPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.length <= 2 ? path : `…/${parts.slice(-2).join("/")}`;
}

/** The list, or why there is none. */
function Windows({ app, windows, list, creates }: { app: App; windows: WindowsSheet; list: WindowList; creates: boolean }) {
  const host = windows.hostName;
  const retry = <Tappable class="action action-quiet" label="Try again" onTap={() => { void windows.refresh(); }}>Try again</Tappable>;
  switch (list.kind) {
    case "list":
      return <SessionList app={app} windows={windows} listing={list.listing} creates={creates} />;
    case "loading":
      return <div class="loading">Loading windows…</div>;
    case "noServer":
      return <Empty title={`No tmux server on ${host}`} hint="Start tmux on the server. tether attaches to it, and never starts one." />;
    case "problem": {
      const { title, hint } = hostProblem(list.problem, host);
      return <Empty title={title} hint={hint ?? undefined}>{list.problem === "unreachable" && retry}</Empty>;
    }
    case "error":
      return <Empty title={list.message}>{retry}</Empty>;
  }
}

/** Sessions and their windows; a tap opens a window as a tab. */
function SessionList({ app, windows, listing, creates }: { app: App; windows: WindowsSheet; listing: TmuxListing; creates: boolean }) {
  const { tabs } = app.snapshot;
  const host = windows.hostId;
  const now = Date.now();
  return (
    <div class="sessions">
      {listing.sessions.map((session) => (
        <section key={session.id} class="session">
          <div class="session-head">
            <span class="session-name">{session.name}</span>
            {session.attachedElsewhere && <span class="tag">attached on laptop</span>}
            {creates && (
              <Tappable
                class="session-new"
                label={`New window in ${session.name}`}
                onTap={() => { windows.startCreate({ kind: "window", session: { server: listing.server, session: session.id } }, session.name); }}
              >
                <Plus /> Window
              </Tappable>
            )}
          </div>
          {session.windows.map((win) => {
            const window = { server: listing.server, window: win.id };
            const open = tabs.some((t) => t.host === host && sameWindow(t.window, window));
            return (
              <Tappable
                key={win.id}
                class="row"
                label={`${open ? "Go to" : "Open"} ${session.name}:${win.name}`}
                onTap={() => { if (host) app.add(host, window, `${session.name}:${win.name}`); }}
              >
                <span class="row-index">{win.index}</span>
                <span class="row-main">
                  <span class="row-title">{win.name}</span>
                  {win.active && <span class="row-sub">current window</span>}
                </span>
                {open && <span class="tag tag-open">open</span>}
                <span class="row-meta">{ago(win.activity, now)}</span>
              </Tappable>
            );
          })}
        </section>
      ))}
    </div>
  );
}

/** `[+]`: attach to a window, or start a new window or session. */
function AttachSheet({ app, windows }: { app: App; windows: WindowsSheet }) {
  const { list, draft } = useStore(windows);
  if (draft) return <CreateSheet app={app} windows={windows} draft={draft} />;
  return (
    <Sheet onClose={() => { app.closeSheet(); }} label="Open a window">
      <SheetHeader
        title="Open a window"
        sub={windows.hostName}
        actions={
          <>
            <Tappable class="icon-tap" label="Refresh" onTap={() => { void windows.refresh(); }}><Refresh /></Tappable>
            <CloseButton onClose={() => { app.closeSheet(); }} />
          </>
        }
      />
      <div class="sheet-body">
        <Windows app={app} windows={windows} list={list} creates />
      </div>
      <div class="sheet-foot">
        <Tappable class="action" label="New session" disabled={list.kind !== "list"} onTap={() => { windows.startCreate({ kind: "session" }, null); }}>
          <Plus /> New session
        </Tappable>
      </div>
    </Sheet>
  );
}

function Choice({ label, sub, path = false, chosen, onTap }: { label: string; sub?: string | null; path?: boolean; chosen: boolean; onTap: () => void }) {
  return (
    <Tappable class={`row choice${chosen ? " choice-on" : ""}`} label={label} onTap={onTap}>
      <span class="choice-mark" aria-hidden="true" />
      <span class="row-main">
        <span class="row-title">{label}</span>
        {sub && <span class={path ? "row-sub mono" : "row-sub"}>{sub}</span>}
      </span>
    </Tappable>
  );
}

/** The new-window or new-session form. Text comes from native prompts. */
function CreateSheet({ app, windows, draft }: { app: App; windows: WindowsSheet; draft: Draft }) {
  const { cwd } = windows;
  const what = draft.target.kind === "window" ? "window" : "session";
  const title = draft.target.kind === "window" ? `New window in ${draft.sessionName ?? "session"}` : "New session";
  const custom = draft.dir !== null && draft.dir !== cwd;
  return (
    <Sheet onClose={() => { app.closeSheet(); }} label={title}>
      <SheetHeader title={title} sub={windows.hostName} onBack={() => { windows.cancelCreate(); }} actions={<CloseButton onClose={() => { app.closeSheet(); }} />} />
      <div class="sheet-body">
        <div class="field-label">Name</div>
        <Tappable class="row" label={`Name: ${draft.name ?? "tmux chooses"}. Tap to change`} onTap={() => { void windows.promptName(); }}>
          <span class="row-main">
            <span class={draft.name ? "row-title" : "row-title row-placeholder"}>{draft.name ?? "tmux chooses"}</span>
          </span>
          <ChevronRight size={18} />
        </Tappable>
        <div class="field-label">Start in</div>
        {cwd && <Choice label="This tab's folder" sub={shortPath(cwd)} path chosen={draft.dir === cwd} onTap={() => { windows.chooseDir(cwd); }} />}
        <Choice label="tmux default" sub={what === "window" ? "the session's folder" : null} chosen={draft.dir === null} onTap={() => { windows.chooseDir(null); }} />
        <Choice label="Another folder…" sub={custom ? draft.dir : null} path chosen={custom} onTap={() => { void windows.askDir(); }} />
        {draft.error && <div class="form-error" role="alert">{draft.error}</div>}
      </div>
      <div class="sheet-foot">
        <Tappable class="action action-primary" label={`Create ${what}`} disabled={draft.busy} onTap={() => { void windows.submitCreate(); }}>
          {draft.busy ? "Creating…" : `Create ${what}`}
        </Tappable>
      </div>
    </Sheet>
  );
}

/** `[<]`: the host, its open tabs, and every window to reopen. */
function HomeSheet({ app, windows }: { app: App; windows: WindowsSheet }) {
  const { list } = useStore(windows);
  const { tabs, active } = app.snapshot;
  const name = windows.hostName;
  const now = Date.now();
  const mine = tabs.filter((t) => t.host === windows.hostId);
  const { cwd } = windows;
  return (
    <Sheet onClose={() => { app.closeSheet(); }} full label="Home">
      <SheetHeader title={name} sub={hostLine(list)} actions={<CloseButton onClose={() => { app.closeSheet(); }} />} />
      <div class="sheet-body">
        <Tappable class="row" label="Files" onTap={() => { app.openFiles(); }}>
          <Folder />
          <span class="row-main">
            <span class="row-title">Files</span>
            <span class="row-sub mono">{cwd ? shortPath(cwd) : "Your folders on the server"}</span>
          </span>
          <ChevronRight size={18} />
        </Tappable>
        {mine.length > 0 && (
          <section class="session">
            <h2 class="home-section">Open tabs</h2>
            {mine.map((tab) => {
              const status = describe(tab.state, tab.downSince ?? now, tab.retryAt, now, name, tab.id === active);
              return (
                <div key={tab.id} class="row-split">
                  <Tappable class={`row${tab.id === active ? " row-current" : ""}`} label={`Go to ${tab.name}`} onTap={() => { app.activate(tab.id); }}>
                    <Dot tone={status.tone} />
                    <span class="row-main">
                      <span class="row-title">{tab.name}</span>
                      <span class="row-sub mono">{status.detail ?? (tab.cwd ? shortPath(tab.cwd) : tab.id === active ? "on screen" : "")}</span>
                    </span>
                  </Tappable>
                  <Tappable class="icon-tap" label={`Close ${tab.name}`} onTap={() => { app.close(tab.id); }}><Close size={16} /></Tappable>
                </div>
              );
            })}
          </section>
        )}
        <h2 class="home-section">Windows</h2>
        <Windows app={app} windows={windows} list={list} creates={false} />
      </div>
    </Sheet>
  );
}

function hostLine(list: WindowList): string | null {
  if (list.kind !== "list") return null;
  const n = list.listing.sessions.length;
  return `tmux ${list.listing.version}, ${String(n)} session${n === 1 ? "" : "s"}`;
}

export function Sheets({ app }: { app: App }) {
  const { sheet } = app.snapshot;
  if (!sheet) return null;
  switch (sheet.kind) {
    case "home":
      return <HomeSheet app={app} windows={sheet.windows} />;
    case "attach":
      return <AttachSheet app={app} windows={sheet.windows} />;
    case "files":
      return <FilesSheet app={app} host={sheet.host} browser={sheet.browser} />;
  }
}
