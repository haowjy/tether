// The I/O around the line field's drafts (client-architecture.md §7.4): the pure reducer in
// `drafts/` decides, and this reads storage once, debounces writes by 300 ms, flushes when the
// page is hidden (`persist now`), follows a draft another page changed, and claims the paste
// answers of the lines it sent, turning each into a send state. One per app.
import type { AppController } from "../../../app/controller";
import { checkEdit, initialDrafts, pendingKey, reduce, type DraftsEffect, type DraftsEvent, type DraftsState, type EditResult } from "../../../drafts/state";
import type { PasteResult } from "../../../net/host";
import type { TabKey } from "../../../platform/types";
import { Store } from "../../../ui/store";
import { terminalsOf } from "../terminals";

/** An edit settles this long after the last keystroke. */
const DEBOUNCE_MS = 300;

const instances = new WeakMap<AppController, LineDrafts>();

export function lineDraftsOf(app: AppController): LineDrafts {
  let drafts = instances.get(app);
  if (!drafts) {
    drafts = new LineDrafts(app);
    instances.set(app, drafts);
  }
  return drafts;
}

/** A paste's answer as the send state it means: Not sent for a refusal, May not have been sent for what may have run. */
function outcome(result: PasteResult): Extract<DraftsEvent, { type: "answered" }>["outcome"] {
  if (result.type === "pasted") return { kind: "pasted" };
  if (result.type === "pasteLost") return { kind: "maybe", message: "the connection was lost before tmux confirmed it" };
  return { kind: result.data.code === "tmux" ? "maybe" : "refused", message: result.data.message };
}

export class LineDrafts extends Store<DraftsState> {
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly app: AppController) {
    super(initialDrafts);
    const { storage } = app.platform;
    void storage.drafts.list().then((records) => { this.dispatch({ type: "listed", records }); });
    app.persist.onFlush(() => { this.flush(); });
    app.platform.subscribe((event) => {
      if (event.type !== "draftChanged") return;
      void storage.drafts.get(event.key).then((record) => { this.dispatch({ type: "remote", key: event.key, record }); });
    });
    // A closed tab's unanswered lines come back to its draft: its paste will never be answered.
    app.subscribe(() => {
      const open = this.openTabs();
      for (const line of Object.values(this.snapshot.pending)) if (!open.has(line.id)) this.dispatch({ type: "tabClosed", id: line.id, open });
    });
    // The one sink for paste answers is the terminal's: what this has no pending line for falls through to its notice.
    terminalsOf(app).claimPasteResults((id, result) => this.claim(id, result));
  }

  private openTabs(): ReadonlySet<string> {
    return new Set(this.app.snapshot.workspace.tabs.map((t) => t.id));
  }

  /** The user edited the field. A refused edit changes nothing; the caller puts the field back and says why. */
  edit(key: TabKey, text: string): EditResult {
    const open = this.openTabs();
    const result = checkEdit(this.snapshot, key, text, open);
    if (result !== "ok") return result;
    this.dispatch({ type: "edit", key, text, now: Date.now(), open });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.flush(); }, DEBOUNCE_MS);
    return "ok";
  }

  /** Return sent `text` to tab `key` as paste `req` (the caller got it from `Terminals.sendLine`). */
  sent(key: TabKey, text: string, req: number): void {
    this.dispatch({ type: "submit", key, text, req, now: Date.now() });
  }

  /** Whether `result` answers a line this sent, and so is not the terminal's to report. */
  private claim(id: string, result: PasteResult): boolean {
    const req = result.type === "pasteLost" ? result.req : result.data.req;
    if (req === undefined || !(pendingKey(id, req) in this.snapshot.pending)) return false;
    this.dispatch({ type: "answered", id, req, outcome: outcome(result), open: this.openTabs() });
    return true;
  }

  /** Hands every dirty draft to storage now. */
  flush(): void {
    clearTimeout(this.timer);
    this.dispatch({ type: "flush" });
  }

  private dispatch(event: DraftsEvent): void {
    const { state, effects } = reduce(this.snapshot, event);
    if (state !== this.snapshot) this.update(state);
    for (const effect of effects) this.write(effect);
  }

  private write(effect: DraftsEffect): void {
    const { drafts } = this.app.platform.storage;
    if (effect.type === "delete") {
      void drafts.delete(effect.key).catch(() => undefined);
      return;
    }
    const { record, base } = effect;
    void drafts.put(record, base).then(
      (result) => {
        if (result === "ok") this.dispatch({ type: "stored", key: record.key, revision: record.revision });
        else if (result === "failed") this.dispatch({ type: "failed", key: record.key });
        else void drafts.get(record.key).then((stored) => { this.dispatch({ type: "remote", key: record.key, record: stored }); });
      },
      () => { this.dispatch({ type: "failed", key: record.key }); },
    );
  }
}
