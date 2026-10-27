import { useEffect, useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import { useApp, useOverlay } from "../../app/context";
import { accept, complete, go, slashAccepts, type CompleteContext, type Completion } from "../../files/pathfield";
import type { FilesPlace } from "../../platform/types";
import { useStore } from "../../ui/store";
import { Button } from "../../ui/primitives/Button";
import { PathInput } from "../../ui/primitives/PathInput";
import { CompletionList, rowId } from "./CompletionList";
import type { FilesSession } from "./session";
import pane from "./FilesScreen.module.css";
import styles from "./PathField.module.css";

interface Props {
  session: FilesSession;
  /** The text at rest: the folder on screen, `~/…` under home; empty on the roots list. */
  rest: string;
  /** The list below is the field's while it is editing. */
  onEditing: (editing: boolean) => void;
  /** Go named a folder: the pane opens it in its tab. */
  onOpen: (to: FilesPlace) => void;
}

/**
 * The path field (browser-behaviors.md "Files"): at rest it reads where you are; focused, it
 * completes the typed path against the subfolders `Folders` holds, and Go opens the folder
 * it names. The completion rules are `files/pathfield.ts`'s; this wires keys, taps and focus.
 * Editing is a router overlay (`files/find`), so Back ends the edit before it leaves the folder.
 */
export function PathField({ session, rest, onEditing, onOpen }: Props) {
  const app = useApp();
  const { browser } = session;
  const roots = useStore(browser, (s) => s.roots);
  const showHidden = useStore(browser, (s) => s.hidden);
  const held = useStore(browser.folders, (s) => s.held);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  /** The typed text; null at rest. */
  const [text, setText] = useState<string | null>(null);
  /** A row picked with the arrow keys; otherwise the prediction is the highlight. */
  const [chosen, setChosen] = useState<string | null>(null);
  /** Why Go opened nothing. */
  const [said, setSaid] = useState<string | null>(null);
  const editing = text !== null;
  const latest = useRef(text);
  latest.current = text;
  const find = useOverlay("files", "find");
  /** Set and cleared synchronously, so a blur that an end of editing causes does not end it twice. */
  const active = useRef(false);

  const where = browser.where();
  const ctx: CompleteContext | null = where && { where, showHidden, folder: (key) => held.get(key)?.names ?? undefined };
  const c: Completion | null = ctx && text !== null ? complete(text, ctx) : null;
  const highlighted = c && (c.rows.find((row) => row.name === chosen) ?? c.predicted);

  /** The field is at rest again and the keyboard is down; the history entry is the caller's. */
  const endEditing = (): void => {
    active.current = false;
    setText(null);
    setChosen(null);
    setSaid(null);
    if (input.current && document.activeElement === input.current) app.focus.blurElement(input.current);
  };
  /** Ends editing from the field (Escape, Cancel, blur): Back's step. */
  const cancel = (): void => {
    if (!active.current) return;
    endEditing();
    app.router.closeOverlay();
  };

  useEffect(() => { onEditing(editing); }, [editing, onEditing]);
  // Back (or Forward) moved off the edit's entry; or an entry that held the edit came back without its text.
  useEffect(() => {
    if (active.current && !find.open) endEditing();
    else if (!active.current && find.open) app.router.closeOverlay();
  }, [find.open]);
  // Where you are changed some other way: the field is at rest again.
  useEffect(cancel, [rest]);
  // The folder the field names is listed once typing settles; leaving cancels a pending one.
  const ask = c?.ask ?? null;
  useEffect(() => { browser.folders.ask(ask); }, [browser, ask?.path, ask?.hidden]);
  // Starting puts the caret after the trailing `/`, where typing narrows.
  useLayoutEffect(() => {
    const el = input.current;
    if (editing && el) el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);
  useEffect(() => {
    if (highlighted) document.getElementById(rowId(listId, highlighted.name))?.scrollIntoView({ block: "nearest" });
  }, [listId, highlighted?.name]);

  const take = (name: string): void => {
    if (!c?.typed) return;
    setText(accept(c.typed, name));
    setChosen(null);
    setSaid(null);
  };

  const submit = async (): Promise<void> => {
    if (!ctx || text === null || !c) return;
    let result = go(text, highlighted ?? null, ctx);
    if ("wait" in result && c.ask) {
      await browser.folders.load(c.ask.path, c.ask.hidden);
      if (latest.current !== text) return;
      result = go(text, highlighted ?? null, { ...ctx, folder: (key) => browser.folders.snapshot.held.get(key)?.names ?? undefined });
    }
    if ("open" in result) {
      endEditing();
      app.router.closeOverlay(() => { onOpen({ kind: "dir", path: result.open }); });
    } else if ("say" in result) setSaid(result.say);
  };

  const step = (by: 1 | -1): void => {
    if (!c) return;
    const at = highlighted ? c.rows.findIndex((row) => row.name === highlighted.name) : -1;
    const next = at + by;
    setChosen(next < 0 ? null : (c.rows[Math.min(next, c.rows.length - 1)]?.name ?? null));
  };

  return (
    <>
      <div class={styles.find}>
        <PathInput
          label="Go to folder"
          placeholder="Go to folder"
          value={text ?? rest}
          ghost={c?.ghost ?? ""}
          listId={c && c.rows.length > 0 ? listId : undefined}
          activeId={highlighted ? rowId(listId, highlighted.name) : undefined}
          inputRef={input}
          focusTarget="path"
          onFocus={() => {
            if (active.current || !where) return;
            active.current = true;
            app.router.openOverlay({ screen: "files", name: "find" });
            setText(rest === "" ? "~/" : rest.endsWith("/") ? rest : `${rest}/`);
          }}
          // Losing focus ends editing, but not when the whole window lost it (the element is still the active one).
          onBlur={(e) => { if (document.activeElement !== e.currentTarget) cancel(); }}
          onInput={(value, el) => {
            setChosen(null);
            setSaid(null);
            // A `/` typed at the end after a partial name accepts the prediction in its place.
            const accepted = ctx && text !== null && value === `${text}/` && el.selectionStart === value.length ? slashAccepts(text, ctx) : null;
            setText(accepted ?? value);
          }}
          onKeyDown={(e) => {
            if (!editing) return;
            const atEnd = e.currentTarget.selectionStart === e.currentTarget.value.length && e.currentTarget.selectionEnd === e.currentTarget.value.length;
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              cancel();
            } else if (e.key === "Enter") {
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
          }}
        />
        {editing && (
          <Button variant="quiet" onMouseDown={(e) => { e.preventDefault(); }} onClick={cancel}>Cancel</Button>
        )}
      </div>
      {said && <p class={styles.said} role="alert">{said}</p>}
      {c && roots && (
        <div class={pane.scroll}>
          <CompletionList
            listId={listId}
            completion={c}
            home={roots.home}
            hostName={session.hostName}
            highlighted={highlighted?.name ?? null}
            onAccept={take}
            onRetry={() => { if (c.ask) { browser.folders.drop(c.ask.path); void browser.folders.load(c.ask.path, c.ask.hidden); } }}
          />
        </div>
      )}
    </>
  );
}
