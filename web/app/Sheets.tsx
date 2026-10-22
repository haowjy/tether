import type { ComponentChildren } from "preact";
import type { TmuxListing } from "../proto/generated/messages";
import { Tappable } from "../ui/Tappable";
import { ChevronLeft, ChevronRight, Close, Plus, Refresh } from "../ui/icons";
import type { App, Draft, Listing } from "./app";
import { describe } from "./status";
import { Dot } from "./TabBar";

/** Seconds since the epoch → "now", "5m", "3h", "2d". */
function ago(unixSeconds: number, now: number): string {
  const s = Math.max(0, Math.round(now / 1000 - unixSeconds));
  if (s < 60) return "now";
  if (s < 3600) return `${String(Math.floor(s / 60))}m`;
  if (s < 86400) return `${String(Math.floor(s / 3600))}h`;
  return `${String(Math.floor(s / 86400))}d`;
}

/** The last two segments of a path, enough to recognise a project. */
function shortPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.length <= 2 ? path : `…/${parts.slice(-2).join("/")}`;
}

/** An overlay in the page: a scrim and a panel, rising from the bottom or filling the screen. */
function Sheet({ app, full = false, label, children }: { app: App; full?: boolean; label: string; children: ComponentChildren }) {
  return (
    <div class={`sheet-layer${full ? " sheet-layer-full" : ""}`}>
      <Tappable class="scrim" label="Close" onTap={() => { app.closeSheet(); }} />
      <div class="sheet" role="dialog" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

function Header({ title, sub, onBack, actions }: { title: string; sub?: string | null | undefined; onBack?: () => void; actions: ComponentChildren }) {
  return (
    <div class="sheet-head">
      {onBack && (
        <Tappable class="icon-tap" label="Back" onTap={onBack}>
          <ChevronLeft />
        </Tappable>
      )}
      <div class="sheet-title">
        <div class="sheet-title-main">{title}</div>
        {sub && <div class="sheet-title-sub">{sub}</div>}
      </div>
      {actions}
    </div>
  );
}

function CloseAction({ app }: { app: App }) {
  return (
    <Tappable class="icon-tap" label="Close" onTap={() => { app.closeSheet(); }}>
      <Close />
    </Tappable>
  );
}

/** A full-width message for a listing with nothing to show. */
function Empty({ title, hint, children }: { title: string; hint?: string; children?: ComponentChildren }) {
  return (
    <div class="empty">
      <div class="empty-title">{title}</div>
      {hint && <div class="empty-hint">{hint}</div>}
      {children}
    </div>
  );
}

function ListingProblem({ app, listing, host }: { app: App; listing: Exclude<Listing, { kind: "list" }>; host: string }) {
  switch (listing.kind) {
    case "loading":
      return <div class="loading">Loading windows…</div>;
    case "noServer":
      return <Empty title={`No tmux server on ${host}`} hint="Start tmux on the server. tether attaches to it, and never starts one." />;
    case "halted":
      return listing.halt === "incompatible"
        ? <Empty title={`tether on ${host} is a different version`} hint="Update the app or the daemon so they speak the same protocol." />
        : <Empty title={`This iPhone isn't enrolled on ${host}`} hint="Enrol it from the app's Hosts screen, with a code from tether device add on the server." />;
    case "error":
      return (
        <Empty title={listing.message}>
          <Tappable class="action action-quiet" label="Try again" onTap={() => { void app.refresh(); }}>Try again</Tappable>
        </Empty>
      );
  }
}

/** Sessions and their windows; a tap opens a window as a tab. */
function SessionList({ app, listing, creates }: { app: App; listing: TmuxListing; creates: boolean }) {
  const { tabs, host } = app.snapshot;
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
                onTap={() => { app.startCreate({ kind: "window", session: { server: listing.server, session: session.id } }, session.name); }}
              >
                <Plus /> Window
              </Tappable>
            )}
          </div>
          {session.windows.map((win) => {
            const open = tabs.some((t) => t.host === host?.id && t.window.server === listing.server && t.window.window === win.id);
            return (
              <Tappable
                key={win.id}
                class="row"
                label={`${open ? "Go to" : "Open"} ${session.name}:${win.name}`}
                onTap={() => { if (host) app.add(host.id, { server: listing.server, window: win.id }, `${session.name}:${win.name}`); }}
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
function AttachSheet({ app }: { app: App }) {
  const { listing, host } = app.snapshot;
  const name = host?.name ?? "host";
  const canCreate = listing?.kind === "list";
  return (
    <Sheet app={app} label="Open a window">
      <Header
        title="Open a window"
        sub={name}
        actions={
          <>
            <Tappable class="icon-tap" label="Refresh" onTap={() => { void app.refresh(); }}><Refresh /></Tappable>
            <CloseAction app={app} />
          </>
        }
      />
      <div class="sheet-body">
        {listing?.kind === "list" ? <SessionList app={app} listing={listing.listing} creates /> : listing && <ListingProblem app={app} listing={listing} host={name} />}
      </div>
      <div class="sheet-foot">
        <Tappable class="action" label="New session" disabled={!canCreate} onTap={() => { app.startCreate({ kind: "session" }, null); }}>
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
function CreateSheet({ app, draft }: { app: App; draft: Draft }) {
  const { host } = app.snapshot;
  const cwd = app.activeTab()?.cwd ?? null;
  const what = draft.target.kind === "window" ? "window" : "session";
  const title = draft.target.kind === "window" ? `New window in ${draft.sessionName ?? "session"}` : "New session";
  const custom = draft.dir !== null && draft.dir !== cwd;
  return (
    <Sheet app={app} label={title}>
      <Header title={title} sub={host?.name} onBack={() => { app.cancelCreate(); }} actions={<CloseAction app={app} />} />
      <div class="sheet-body">
        <div class="field-label">Name</div>
        <Tappable class="row" label={`Name: ${draft.name ?? "tmux chooses"}. Tap to change`} onTap={() => { void app.promptName(); }}>
          <span class="row-main">
            <span class={draft.name ? "row-title" : "row-title row-placeholder"}>{draft.name ?? "tmux chooses"}</span>
          </span>
          <ChevronRight size={18} />
        </Tappable>
        <div class="field-label">Start in</div>
        {cwd && <Choice label="This tab's folder" sub={shortPath(cwd)} path chosen={draft.dir === cwd} onTap={() => { app.chooseDir(cwd); }} />}
        <Choice label="tmux default" sub={what === "window" ? "the session's folder" : null} chosen={draft.dir === null} onTap={() => { app.chooseDir(null); }} />
        <Choice label="Another folder…" sub={custom ? draft.dir : null} path chosen={custom} onTap={() => { void app.askDir(); }} />
        {draft.error && <div class="form-error" role="alert">{draft.error}</div>}
      </div>
      <div class="sheet-foot">
        <Tappable class="action action-primary" label={`Create ${what}`} disabled={draft.busy} onTap={() => { void app.submitCreate(); }}>
          {draft.busy ? "Creating…" : `Create ${what}`}
        </Tappable>
      </div>
    </Sheet>
  );
}

/** `[<]`: the host, its open tabs, and every window to reopen. */
function HomeSheet({ app }: { app: App }) {
  const { listing, host, tabs, active } = app.snapshot;
  const name = host?.name ?? "host";
  const now = Date.now();
  const mine = tabs.filter((t) => t.host === host?.id);
  return (
    <Sheet app={app} full label="Home">
      <Header title={name} sub={hostLine(listing)} actions={<CloseAction app={app} />} />
      <div class="sheet-body">
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
        {listing?.kind === "list" ? <SessionList app={app} listing={listing.listing} creates={false} /> : listing && <ListingProblem app={app} listing={listing} host={name} />}
      </div>
    </Sheet>
  );
}

function hostLine(listing: Listing | null): string | null {
  if (listing?.kind === "list") {
    const n = listing.listing.sessions.length;
    return `tmux ${listing.listing.version}, ${String(n)} session${n === 1 ? "" : "s"}`;
  }
  return null;
}

export function Sheets({ app }: { app: App }) {
  const { sheet } = app.snapshot;
  if (!sheet) return null;
  switch (sheet.kind) {
    case "home":
      return <HomeSheet app={app} />;
    case "attach":
      return <AttachSheet app={app} />;
    case "create":
      return <CreateSheet app={app} draft={sheet.draft} />;
  }
}
