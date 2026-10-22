import type { Native } from "../native/bridge";
import { RequestError } from "../net/host";
import type { SessionRef, TmuxListing, WindowRef } from "../proto/generated/messages";
import { Store } from "../ui/store";
import type { HostClient } from "./hosts";
import { hostProblem, type HostProblem } from "../ui/hostProblem";
import { listWindows } from "./sync";

/** A host's tmux windows as the sheets show them, or why there are none. */
export type WindowList =
  | { kind: "loading" }
  | { kind: "list"; listing: TmuxListing }
  | { kind: "noServer" }
  | { kind: "problem"; problem: HostProblem }
  | { kind: "error"; message: string };

export type CreateTarget = { kind: "window"; session: SessionRef } | { kind: "session" };

/** The new-window or new-session form. `null` name or dir lets tmux choose. */
export interface Draft {
  target: CreateTarget;
  /** The session's name, for a new window. */
  sessionName: string | null;
  name: string | null;
  dir: string | null;
  busy: boolean;
  error: string | null;
}

export interface WindowsView {
  list: WindowList;
  /** The create form, shown over the list while set. */
  draft: Draft | null;
}

export interface WindowsOptions {
  /** The host listed; null when native knows none yet. */
  host: Pick<HostClient, "entry" | "socket"> | null;
  native: Pick<Native, "prompt">;
  /** The directory of the tab on screen, when it is on this host: the form offers it. */
  cwd: string | null;
  /** Every listing this sheet gets, so the app can close the tabs whose window is gone. */
  onListing(listing: TmuxListing | null): void;
  /** A window was made; `title` is its `session:window`. */
  onCreated(window: WindowRef, title: string): void;
}

/** The Home and `[+]` sheets' state: one host's tmux windows, and the form that makes new ones. */
export class WindowsSheet extends Store<WindowsView> {
  constructor(private readonly opts: WindowsOptions) {
    super({ list: { kind: "loading" }, draft: null });
  }

  get hostId(): string | null {
    return this.opts.host?.entry.id ?? null;
  }

  get hostName(): string {
    return this.opts.host?.entry.name ?? "host";
  }

  get cwd(): string | null {
    return this.opts.cwd;
  }

  async refresh(): Promise<void> {
    const host = this.opts.host;
    if (!host) {
      this.update({ list: { kind: "error", message: "No host yet. Add one in the app's Hosts screen." } });
      return;
    }
    if (!host.entry.enrolled) {
      this.update({ list: { kind: "problem", problem: "unauthorized" } });
      return;
    }
    if (this.snapshot.list.kind !== "list") this.update({ list: { kind: "loading" } });
    try {
      const listing = await listWindows(host.socket);
      this.opts.onListing(listing);
      this.listed(listing);
    } catch (error) {
      // The app lists again when it comes back.
      if (error instanceof RequestError && error.reason === "background") return;
      this.update({ list: failed(error) });
    }
  }

  /** A listing of this sheet's host, from whoever asked for it. */
  listed(listing: TmuxListing | null): void {
    this.update({ list: listing ? { kind: "list", listing } : { kind: "noServer" } });
  }

  /** The new-window (in `session`) or new-session form. */
  startCreate(target: CreateTarget, sessionName: string | null): void {
    this.update({ draft: { target, sessionName, name: null, dir: null, busy: false, error: null } });
  }

  /** Back from the form to the list. */
  cancelCreate(): void {
    this.update({ draft: null });
  }

  /** Asks native for the name: the web has no text fields (plan.md "Standards"). */
  async promptName(): Promise<void> {
    const draft = this.snapshot.draft;
    if (!draft) return;
    const what = draft.target.kind === "window" ? "window" : "session";
    const typed = await this.opts.native.prompt(`Name the ${what}`, "Leave empty to let tmux choose.", draft.name ?? "");
    if (typed !== null) this.patchDraft({ name: typed.trim() || null });
  }

  /** A start directory, or null for tmux's default. */
  chooseDir(dir: string | null): void {
    this.patchDraft({ dir });
  }

  /** A start directory typed into a native prompt. */
  async askDir(): Promise<void> {
    const draft = this.snapshot.draft;
    if (!draft) return;
    const typed = await this.opts.native.prompt("Start directory", "An absolute path on the server.", draft.dir ?? this.opts.cwd ?? "");
    if (typed !== null) this.patchDraft({ dir: typed.trim() || null });
  }

  async submitCreate(): Promise<void> {
    const { draft } = this.snapshot;
    const host = this.opts.host;
    if (!draft || draft.busy || !host) return;
    this.patchDraft({ busy: true, error: null });
    const opts = { ...(draft.name !== null && { name: draft.name }), ...(draft.dir !== null && { dir: draft.dir }) };
    const { target } = draft;
    try {
      const window = await host.socket.request(
        (req) => (target.kind === "window" ? { type: "newWindow", data: { req, session: target.session, ...opts } } : { type: "newSession", data: { req, ...opts } }),
        (reply) => (reply.type === "created" ? reply.data.window : undefined),
      );
      // `created` carries no names: a listing has them.
      const listing = await listWindows(host.socket).catch(() => null);
      if (listing) this.opts.onListing(listing);
      this.opts.onCreated(window, titleOf(listing, window) ?? `${draft.sessionName ?? draft.name ?? "tmux"}:${draft.name ?? String(window.window)}`);
    } catch (error) {
      const list = failed(error);
      const message = list.kind === "noServer" ? "tmux isn't running on the server."
        : list.kind === "problem" ? hostProblem(list.problem, host.entry.name).title
        : list.message;
      this.patchDraft({ busy: false, error: message });
    }
  }

  private patchDraft(patch: Partial<Draft>): void {
    const draft = this.snapshot.draft;
    if (draft) this.update({ draft: { ...draft, ...patch } });
  }
}

/** What a failed request leaves the list showing. */
function failed(error: unknown): Exclude<WindowList, { kind: "loading" | "list" }> {
  if (error instanceof RequestError) {
    switch (error.reason) {
      case "unauthorized":
      case "incompatible":
        return { kind: "problem", problem: error.reason };
      case "lost":
      case "timeout":
        return { kind: "problem", problem: "unreachable" };
      case "noServer":
        return { kind: "noServer" };
      default:
        break;
    }
  }
  return { kind: "error", message: error instanceof Error ? error.message : String(error) };
}

/** `session:window` for a window in a listing. */
function titleOf(listing: TmuxListing | null, window: WindowRef): string | null {
  if (listing?.server !== window.server) return null;
  for (const session of listing.sessions) {
    const win = session.windows.find((w) => w.id === window.window);
    if (win) return `${session.name}:${win.name}`;
  }
  return null;
}
