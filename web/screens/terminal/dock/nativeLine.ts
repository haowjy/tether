// The app's native line editor (client-architecture.md §7.4). It owns the bridge's
// generation checks, draft hydration and Return-to-send path; the dock only renders it.
import type { AppController } from "../../../app/controller";
import type { NativeLineSnapshot, PlatformEvent, TabKey, TextRange } from "../../../platform/types";
import { tabId } from "../../../platform/tabKey";
import { Store } from "../../../ui/store";
import type { Tab } from "../../../workspace/state";
import type { LineDrafts } from "./lineDrafts";
import { terminalsOf } from "../terminals";

type NativeLineEvent = Extract<PlatformEvent, { type: "lineEdit" | "lineReturn" }>;

export interface NativeLineNote {
  tone: "error" | "info";
  text: string;
}

interface NativeLineView {
  /** The native editing copy shown in the mirror, including during draft hydration. */
  text: string;
  tabId: string | null;
  selection: TextRange;
  marked: TextRange | null;
  note: NativeLineNote | null;
}

interface NativeTarget {
  id: string;
  key: TabKey;
  text: string;
}

const END: TextRange = { start: 0, end: 0 };
const instances = new WeakMap<AppController, NativeLineInput>();

/** Created with the app, before its first render or native line event. */
export function startNativeLine(app: AppController, drafts: LineDrafts, snapshot: NativeLineSnapshot | null): NativeLineInput {
  const input = new NativeLineInput(app, drafts, snapshot);
  instances.set(app, input);
  return input;
}

export function nativeLineOf(app: AppController): NativeLineInput {
  const input = instances.get(app);
  if (!input) throw new Error("native line owner was not started with the app");
  return input;
}

export class NativeLineInput extends Store<NativeLineView> {
  private target: NativeTarget | null;
  private restored: NativeLineSnapshot | null;
  private restoredAdoptionAttempted = false;
  private readonly generations = new Map<string, number>();
  /** A new native set invalidates edits already in flight from the generation it replaces. */
  private readonly blockedThrough = new Map<string, number>();
  /** Return retires its captured generation; a late edit from it is already represented by Return. */
  private readonly retiredThrough = new Map<string, number>();
  private pending: NativeLineEvent[] = [];

  constructor(
    private readonly app: AppController,
    private readonly drafts: LineDrafts,
    snapshot: NativeLineSnapshot | null,
  ) {
    const target = snapshot ? { id: tabId(snapshot.tab), key: snapshot.tab, text: snapshot.text } : null;
    super({
      text: snapshot?.text ?? "",
      tabId: target?.id ?? null,
      selection: snapshot?.selection ?? END,
      marked: snapshot?.marked ?? null,
      note: null,
    });
    this.target = target;
    this.restored = snapshot;
    if (snapshot) this.generations.set(target?.id ?? "", snapshot.gen);

    // The platform's one event channel delivers native line events here, not through a screen.
    app.platform.subscribe((event) => {
      if (event.type === "lineEdit" || event.type === "lineReturn") this.receive(event);
    });
    drafts.subscribe(() => { this.draftsChanged(); });
    app.subscribe(() => { this.reconcileTarget(); });
    app.focus.subscribe(() => { this.reconcileTarget(); });
    this.reconcileTarget();
  }

  /** Bind before raising UIKit from the mirror's tap, so the first key names the right tab. */
  open(tab: Tab, text: string, caret: number): void {
    if (this.target?.id !== tab.id) this.bind(tab.key, text, caret);
    else if (this.target.text !== text) this.setNative(tab.key, text, caret);
    else {
      this.update({ selection: { start: caret, end: caret }, marked: null, note: null });
      this.app.platform.input.setLineCaret(caret);
    }
  }

  caret(tab: Tab, text: string, index: number): void {
    if (this.target?.id !== tab.id) this.bind(tab.key, text, index);
    else {
      this.update({ selection: { start: index, end: index }, marked: null });
      this.app.platform.input.setLineCaret(index);
    }
  }

  selectAll(tab: Tab, text: string): void {
    if (this.target?.id !== tab.id) this.bind(tab.key, text, 0);
    this.update({ selection: { start: 0, end: text.length }, marked: null });
    this.app.platform.input.selectAllLine();
  }

  clear(tab: Tab): void {
    const id = tabId(tab.key);
    const restoringThisTab = this.restored !== null && tabId(this.restored.tab) === id;
    const result = this.drafts.edit(tab.key, "");
    if (result !== "ok") return;
    if (restoringThisTab) {
      this.restored = null;
      this.setNative(tab.key, "", 0);
    } else this.update({ selection: END, marked: null, note: null });
  }

  isBound(id: string): boolean {
    return this.target?.id === id;
  }

  private receive(event: NativeLineEvent): void {
    if (!this.drafts.snapshot.ready) {
      const last = this.pending[this.pending.length - 1];
      if (last?.type === "lineEdit" && event.type === "lineEdit" && last.gen === event.gen) this.pending[this.pending.length - 1] = event;
      else this.pending.push(event);
      return;
    }
    this.handle(event);
  }

  private draftsChanged(): void {
    const ready = this.drafts.snapshot.ready;
    if (!ready) return;
    this.adoptRestoredLine();
    this.reconcileTarget();
    this.syncBoundText();
    const pending = this.pending;
    this.pending = [];
    for (const event of pending) this.handle(event);
  }

  private adoptRestoredLine(): void {
    const snapshot = this.restored;
    if (!snapshot || this.restoredAdoptionAttempted) return;
    this.restoredAdoptionAttempted = true;
    this.restored = null;
    const stored = this.drafts.snapshot.drafts[tabId(snapshot.tab)]?.text;
    if (stored === snapshot.text || (stored === undefined && snapshot.text === "")) return;
    const result = this.drafts.editNative(snapshot.tab, snapshot.text);
    if (result !== "ok") {
      // Keep the native copy visible and editable if an unusually large restored line exceeds the draft cap.
      this.restored = snapshot;
      this.setNote({ tone: "error", text: this.editError(result) });
    }
  }

  private reconcileTarget(): void {
    if (this.app.snapshot.viewport.directInput !== "native" || this.app.focus.snapshot.owner !== "line") return;
    const workspace = this.app.snapshot.workspace;
    const tab = workspace.tabs.find((item) => item.id === workspace.active);
    if (!tab || !this.drafts.snapshot.ready) return;
    const text = this.drafts.snapshot.drafts[tab.id]?.text ?? "";
    if (this.target?.id !== tab.id) this.bind(tab.key, text, text.length);
    else this.syncBoundText();
  }

  private bind(key: TabKey, text: string, caret: number): void {
    if (!this.drafts.snapshot.ready) return;
    const id = tabId(key);
    this.target = { id, key, text };
    this.update({ text, tabId: id, selection: { start: caret, end: caret }, marked: null, note: null });
    this.setNative(key, text, caret);
  }

  private setNative(key: TabKey, text: string, caret: number): void {
    const id = tabId(key);
    if (this.target?.id !== id) this.target = { id, key, text };
    else this.target.text = text;
    const generation = this.generations.get(id);
    if (generation !== undefined) this.blockedThrough.set(id, Math.max(generation, this.blockedThrough.get(id) ?? -1));
    this.update({ text, tabId: id, selection: { start: caret, end: caret }, marked: null, note: null });
    void this.app.platform.input.setLine(text, caret, key).then((generation) => {
      const current = this.generations.get(id);
      if (current !== undefined && current >= generation) return;
      this.generations.set(id, generation);
      this.blockedThrough.delete(id);
      if (this.target?.id !== id) return;
      this.target.text = text;
      this.update({ text, selection: { start: caret, end: caret }, marked: null });
      const stored = this.drafts.snapshot.drafts[id]?.text ?? "";
      if (stored !== text) {
        const result = this.drafts.editNative(key, text);
        if (result !== "ok") this.setNote({ tone: "error", text: this.editError(result) });
      }
    }, () => undefined);
  }

  private syncBoundText(): void {
    const target = this.target;
    if (!target || !this.drafts.snapshot.ready) return;
    // Keep an unpersistable boot snapshot in native instead of reloading stale storage over it.
    if (this.restored && tabId(this.restored.tab) === target.id) return;
    const stored = this.drafts.snapshot.drafts[target.id]?.text ?? "";
    // Native already cleared its copy after Return. Only a draft change not reported by native loads it.
    if (stored !== target.text) this.setNative(target.key, stored, stored.length);
  }

  private handle(event: NativeLineEvent): void {
    if (event.type === "lineReturn") {
      this.returned(event);
      return;
    }
    this.edited(event);
  }

  private edited(event: Extract<NativeLineEvent, { type: "lineEdit" }>): void {
    const id = tabId(event.tab);
    const known = this.generations.get(id);
    const retired = this.retiredThrough.get(id) ?? -1;
    const blocked = this.blockedThrough.get(id) ?? -1;
    if (event.gen <= Math.max(retired, blocked) || (known !== undefined && event.gen < known)) return;
    if (known === undefined && this.target?.id !== id) return;
    this.generations.set(id, event.gen);
    if (event.gen > blocked) this.blockedThrough.delete(id);

    const isBound = this.target?.id === id;
    const isCurrentLine = isBound && this.app.focus.snapshot.owner === "line";
    const before = this.drafts.snapshot.drafts[id]?.text ?? "";
    const previousNativeText = isBound ? this.target?.text : undefined;
    if (isBound && this.target) this.target.text = event.text;
    if (isCurrentLine) {
      const modifiers = this.terminals().modifiers;
      if (modifiers.snapshot.armed !== null) {
        modifiers.disarm();
        this.app.platform.input.setArmedModifier(null);
      }
    }
    if (event.text !== before && event.text !== previousNativeText) {
      const result = this.drafts.editNative(event.tab, event.text);
      if (result !== "ok") {
        if (isCurrentLine) this.setNote({ tone: "error", text: this.editError(result) });
        this.syncBoundText();
        return;
      }
      if (this.restored && tabId(this.restored.tab) === id) this.restored = null;
      if (isCurrentLine) this.setNote(null);
    }
    if (isBound) this.update({ text: event.text, tabId: id, ...(isCurrentLine ? { selection: event.selection, marked: event.marked } : {}) });
  }

  private returned(event: Extract<NativeLineEvent, { type: "lineReturn" }>): void {
    const id = tabId(event.tab);
    const latest = this.generations.get(id) ?? event.gen;
    const preserveNativeLine = latest > event.gen || (this.blockedThrough.get(id) ?? -1) >= event.gen;
    const currentDraft = this.drafts.snapshot.drafts[id]?.text ?? "";
    const continuation = preserveNativeLine ? currentDraft : "";
    if (!preserveNativeLine && currentDraft !== event.text) {
      const result = this.drafts.editNative(event.tab, event.text);
      if (result !== "ok") this.setNote({ tone: "error", text: this.editError(result) });
    }

    if (!preserveNativeLine) this.retiredThrough.set(id, Math.max(event.gen, this.retiredThrough.get(id) ?? -1));
    if (this.target?.id === id && !preserveNativeLine) {
      this.target.text = "";
      if (this.restored && tabId(this.restored.tab) === id) this.restored = null;
      this.update({ text: "", selection: END, marked: null });
    }

    const tab = this.app.snapshot.workspace.tabs.find((item) => item.id === id) ?? {
      id,
      key: event.tab,
      session: "",
      window: "",
      restoring: true,
    } satisfies Tab;
    const result = this.drafts.send(tab, event.text, continuation);
    this.setNote(result === "notConnected" ? { tone: "error", text: "Not connected" } : null);
  }

  private terminals(): ReturnType<typeof terminalsOf> {
    // The terminal object is normally already mounted; native can restore a line target before
    // its first render, so create the same app-owned terminal core only if an edit needs it.
    return terminalsOf(this.app);
  }

  private setNote(note: NativeLineNote | null): void {
    this.update({ note });
  }

  private editError(result: "tooLarge" | "full"): string {
    return result === "tooLarge" ? "Draft too large: the limit is 64 KiB" : "Too many saved drafts: clear one";
  }
}
