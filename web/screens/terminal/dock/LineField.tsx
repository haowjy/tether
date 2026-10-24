// The dock's line field (client-architecture.md §7.4): a one-line field with the platform's
// autocorrect and dictation. Return sends its line and then Enter, as one paste the daemon
// runs in a single tmux group; the line leaves the field and comes back, marked, if the
// daemon refuses it. Each tab keeps its own draft.
import type { Ref } from "preact";
import { useApp } from "../../../app/context";
import { LineInput } from "../../../ui/primitives/LineInput";
import { useStore } from "../../../ui/store";
import { readPaste } from "../paste";
import { terminalsOf } from "../terminals";
import { lineDraftsOf } from "./lineDrafts";
import type { Tab } from "../../../workspace/state";

export type LocalNote = { tone: "error" | "info"; text: string };

interface LineFieldProps {
  /** The active tab; null when none is open. */
  tab: Tab | null;
  label: string;
  /** What the dock says about the field, besides the draft's own marks. */
  onNote: (note: LocalNote | null) => void;
  inputRef: Ref<HTMLInputElement>;
}

/** Text with a line break inside it cannot be one line. One trailing break is dropped by the field, as the platform does. */
const hasInnerBreak = (text: string): boolean => /[\r\n]/.test(text.replace(/\r?\n$/, ""));

export function LineField({ tab, label, onNote, inputRef }: LineFieldProps) {
  const app = useApp();
  const terminals = terminalsOf(app);
  const { modifiers } = terminals;
  const drafts = lineDraftsOf(app);
  const text = useStore(drafts, (s) => (tab ? (s.drafts[tab.id]?.text ?? "") : ""));

  const edit = (value: string, el: HTMLInputElement): void => {
    if (!tab) return;
    const result = drafts.edit(tab.key, value);
    if (result === "ok") {
      onNote(null);
      return;
    }
    el.value = text; // the edit was refused: the field keeps what it had
    onNote({ tone: "error", text: result === "tooLarge" ? "Draft too large: the limit is 64 KiB" : "Too many saved drafts: clear one" });
  };

  const send = (): void => {
    if (!tab) return;
    // The tab is captured now: a tab switch before the answer never retargets the line.
    const { id, key } = tab;
    if (text === "") {
      // An empty Return is Enter.
      if (!terminals.sendKeys(id, [{ key: "Enter" }])) onNote({ tone: "error", text: "Not connected" });
      return;
    }
    const req = terminals.sendLine(id, text);
    if (req === null) {
      onNote({ tone: "error", text: "Not connected" });
      return;
    }
    drafts.sent(key, text, req);
    onNote(null);
  };

  return (
    <LineInput
      label={label}
      placeholder={tab ? "Type or dictate a line" : "Open a window to type"}
      value={text}
      disabled={!tab}
      focusTarget="line"
      inputRef={inputRef}
      onInput={edit}
      onKeyDown={(e) => {
        // Return confirming an IME candidate is the IME's, not a send. Safari reports it after
        // `compositionend`, as keyCode 229 with isComposing already false.
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        if (e.key !== "Enter" || e.isComposing || e.keyCode === 229) return;
        e.preventDefault();
        send();
      }}
      onBeforeInput={(e) => {
        // With ctrl or alt armed, the next character is a chord for the terminal. A multi-character insert only disarms.
        if (e.inputType === "insertText" && e.data && modifiers.chord(e.data)) e.preventDefault();
      }}
      onCompositionStart={() => { modifiers.disarm(); }}
      onPaste={(e) => {
        const pasted = readPaste(e.clipboardData);
        if (pasted.kind === "image" || (pasted.kind === "text" && hasInnerBreak(pasted.text))) {
          // The field is one line: more than a line goes to the terminal as one paste, without Enter.
          e.preventDefault();
          terminals.paste(pasted);
          app.notify(pasted.kind === "image" ? "Image sent to the terminal, not the line" : "Pasted text has several lines: sent to the terminal as one paste, without Enter");
        }
      }}
    />
  );
}
