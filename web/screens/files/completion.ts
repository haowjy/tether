// The completing path field's behaviour, shared by every place a folder is typed: the Files tab's
// path field, the picker's search (in path mode) and New session's Start directory. It owns the
// highlight and the keys; the caller owns the text, the caret and what a chosen folder does.
import { useEffect, useId, useRef, useState } from "preact/hooks";
import { accept, complete, go, slashAccepts, type CompleteContext, type Completion, type CompletionRow } from "../../files/pathfield";
import { useStore } from "../../ui/store";
import { rowId } from "./CompletionList";
import type { FilesSession } from "./session";

interface Options {
  session: FilesSession;
  /** The typed text; null when nothing is being typed (the list stays away). */
  text: string | null;
  setText: (text: string) => void;
  /** A folder was chosen: a tap on a row, or Go on the text. */
  onOpen: (path: string) => void | Promise<void>;
  /** Enter is Go. Off where Enter belongs to a form around the field. */
  enterOpens: boolean;
}

export function useCompletion({ session, text, setText, onOpen, enterOpens }: Options) {
  const { browser } = session;
  const favorites = useStore(browser, (s) => s.favorites);
  const showHidden = useStore(browser, (s) => s.hidden);
  const held = useStore(browser.folders, (s) => s.held);
  const listId = useId();
  /** A row picked with the arrow keys; otherwise the prediction is the highlight. */
  const [chosen, setChosen] = useState<string | null>(null);
  /** Why Go opened nothing. */
  const [said, setSaid] = useState<string | null>(null);
  const latest = useRef(text);
  latest.current = text;

  // A form asks for the host's home, which `~` names, itself: no Files tab has opened it.
  useEffect(() => { void browser.favorites().catch(() => undefined); }, [browser]);
  const home = favorites?.home ?? null;
  const ctx: CompleteContext | null = home === null ? null : { home, showHidden, folder: (key) => held.get(key)?.names ?? undefined };
  const c: Completion | null = ctx && text !== null ? complete(text, ctx) : null;
  const highlighted = c && (c.rows.find((row) => row.name === chosen) ?? c.predicted);

  // The folder the field names is listed once typing settles; leaving cancels a pending one.
  const ask = c?.ask ?? null;
  useEffect(() => { browser.folders.ask(ask); }, [browser, ask?.path, ask?.hidden]);

  useEffect(() => {
    if (highlighted) document.getElementById(rowId(listId, highlighted.name))?.scrollIntoView({ block: "nearest" });
  }, [listId, highlighted?.name]);

  const reset = (): void => { setChosen(null); setSaid(null); };
  const fill = (to: string): void => { setText(to); reset(); };
  const take = (name: string): void => { if (c?.typed) fill(accept(c.typed, name)); };

  /** Go: opens `row`, else the highlighted folder, else the folder the text names. */
  const submit = async (row?: CompletionRow): Promise<void> => {
    if (!ctx || text === null || !c) return;
    const target = row ?? highlighted ?? null;
    let result = go(text, target, ctx);
    if ("wait" in result && c.ask) {
      await browser.folders.load(c.ask.path, c.ask.hidden);
      if (latest.current !== text) return;
      result = go(text, target, { ...ctx, folder: (key) => browser.folders.snapshot.held.get(key)?.names ?? undefined });
    }
    if ("open" in result) await onOpen(result.open);
    else if ("say" in result) setSaid(result.say);
  };

  const step = (by: 1 | -1): void => {
    if (!c) return;
    const at = highlighted ? c.rows.findIndex((row) => row.name === highlighted.name) : -1;
    const next = at + by;
    setChosen(next < 0 ? null : (c.rows[Math.min(next, c.rows.length - 1)]?.name ?? null));
  };

  return {
    home,
    completion: c,
    said,
    setSaid,
    fill,
    reset,
    submit,
    /** Props for the `PathInput`, besides its value, name and focus. */
    input: {
      ghost: c?.ghost ?? "",
      listId: c && c.rows.length > 0 ? listId : undefined,
      activeId: highlighted ? rowId(listId, highlighted.name) : undefined,
      onInput: (value: string, el: HTMLInputElement | undefined): void => {
        reset();
        // A `/` typed at the end after a partial name accepts the prediction in its place.
        const accepted = ctx && text !== null && value === `${text}/` && el?.selectionStart === value.length ? slashAccepts(text, ctx) : null;
        setText(accepted ?? value);
      },
      /** Enter, Tab and →, ↑ and ↓. Escape is the caller's. */
      onKeyDown: (e: KeyboardEvent & { currentTarget: HTMLInputElement }): void => {
        if (text === null) return;
        const el = e.currentTarget;
        const atEnd = el.selectionStart === el.value.length && el.selectionEnd === el.value.length;
        if (e.key === "Enter") {
          if (!enterOpens) return;
          e.preventDefault();
          void submit();
        } else if ((e.key === "Tab" && !e.shiftKey) || (e.key === "ArrowRight" && atEnd && !e.metaKey && !e.ctrlKey && !e.altKey)) {
          if (highlighted) {
            e.preventDefault();
            take(highlighted.name);
          }
        } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          step(e.key === "ArrowDown" ? 1 : -1);
        }
      },
    },
    /** Props for the `CompletionList`. */
    list: {
      listId,
      highlighted: highlighted?.name ?? null,
      onOpen: (row: CompletionRow): void => { void submit(row); },
      onUp: fill,
      onRetry: (): void => { if (c?.ask) { browser.folders.drop(c.ask.path); void browser.folders.load(c.ask.path, c.ask.hidden); } },
    },
  };
}
