import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { useApp, useOverlay } from "../../app/context";
import type { FilesPlace } from "../../platform/types";
import { Button } from "../../ui/primitives/Button";
import { PathInput } from "../../ui/primitives/PathInput";
import { CompletionList } from "./CompletionList";
import { useCompletion } from "./completion";
import type { FilesSession } from "./session";
import pane from "./FilesScreen.module.css";
import styles from "./PathField.module.css";

interface Props {
  session: FilesSession;
  /** The text at rest: the folder on screen, `~/…` under home. */
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
  const input = useRef<HTMLInputElement>(null);
  /** The typed text; null at rest. */
  const [text, setText] = useState<string | null>(null);
  const editing = text !== null;
  const find = useOverlay("files", "find");
  /** Set and cleared synchronously, so a blur that an end of editing causes does not end it twice. */
  const active = useRef(false);

  /** The field is at rest again and the keyboard is down; the history entry is the caller's. */
  const endEditing = (): void => {
    active.current = false;
    setText(null);
    field.reset();
    if (input.current && document.activeElement === input.current) app.focus.blurElement(input.current);
  };
  /** Ends editing from the field (Escape, Cancel): Back's step. */
  const cancel = (): void => {
    if (!active.current) return;
    endEditing();
    app.router.closeOverlay();
  };
  const field = useCompletion({
    session,
    text,
    setText,
    enterOpens: true,
    onOpen: (path) => {
      endEditing();
      app.router.closeOverlay(() => { onOpen({ kind: "dir", path }); });
    },
  });

  useEffect(() => { onEditing(editing); }, [editing, onEditing]);
  // Starting puts the caret after the trailing `/`, where typing narrows. iOS places the caret at the tap
  // once focus lands, after this runs, so it is set again on the next frame and once more after the tap settles.
  useLayoutEffect(() => {
    const el = input.current;
    if (!editing || !el) return undefined;
    const toEnd = (): void => { if (document.activeElement === el) el.setSelectionRange(el.value.length, el.value.length); };
    toEnd();
    const frame = requestAnimationFrame(toEnd);
    const later = setTimeout(toEnd, 120);
    return () => { cancelAnimationFrame(frame); clearTimeout(later); };
  }, [editing]);
  // Back (or Forward) moved off the edit's entry; or an entry that held the edit came back without its text.
  useEffect(() => {
    if (active.current && !find.open) endEditing();
    else if (!active.current && find.open) app.router.closeOverlay();
  }, [find.open]);
  // Where you are changed some other way: the field is at rest again.
  useEffect(cancel, [rest]);

  return (
    <>
      <div class={styles.find}>
        <PathInput
          label="Go to folder"
          placeholder="Go to folder"
          value={text ?? rest}
          {...field.input}
          inputRef={input}
          focusTarget="path"
          onFocus={() => {
            if (active.current || field.home === null) return;
            active.current = true;
            app.router.openOverlay({ screen: "files", name: "find" });
            setText(rest.endsWith("/") ? rest : `${rest}/`);
          }}
          // Losing focus (the keyboard hidden, a tap elsewhere) only lowers the keyboard: the edit and its text
          // stay, and a tap on the field resumes it. Cancel, Escape and Back end it.
          onKeyDown={(e) => {
            if (editing && e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              cancel();
            } else field.input.onKeyDown(e);
          }}
        />
        {editing && (
          <Button variant="quiet" onMouseDown={(e) => { e.preventDefault(); }} onClick={cancel}>Cancel</Button>
        )}
      </div>
      {field.said && <p class={styles.said} role="alert">{field.said}</p>}
      {field.completion && field.home !== null && (
        <div class={pane.scroll}>
          <CompletionList completion={field.completion} home={field.home} hostName={session.hostName} {...field.list} />
        </div>
      )}
    </>
  );
}
