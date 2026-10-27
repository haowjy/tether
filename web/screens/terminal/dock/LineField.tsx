// The dock's line field is an editable browser control or a renderer for the app's native editor.
import { useRef } from "preact/hooks";
import type { Ref } from "preact";
import { useApp, useAppView } from "../../../app/context";
import type { TextRange } from "../../../platform/types";
import { LineInput } from "../../../ui/primitives/LineInput";
import { useStore } from "../../../ui/store";
import type { Tab } from "../../../workspace/state";
import { readPaste } from "../paste";
import { terminalsOf } from "../terminals";
import { LineMirror } from "./LineMirror";
import { lineDraftsOf } from "./lineDrafts";
import { nativeLineOf } from "./nativeLine";

export type LocalNote = { tone: "error" | "info"; text: string };

interface LineFieldProps {
  tab: Tab | null;
  label: string;
  onNote: (note: LocalNote | null) => void;
  inputRef: Ref<HTMLTextAreaElement>;
}

/** The line is one logical line. One trailing paste break is dropped; multiple lines go to tmux. */
const withoutTrailingBreak = (text: string): string => text.replace(/\r?\n$/, "").replace(/\r$/, "");
const hasInnerBreak = (text: string): boolean => /[\r\n]/.test(withoutTrailingBreak(text));

export function LineField({ tab, label, onNote, inputRef }: LineFieldProps) {
  const app = useApp();
  const terminals = terminalsOf(app);
  const drafts = lineDraftsOf(app);
  const nativeLine = nativeLineOf(app);
  const { modifiers } = terminals;
  const text = useStore(drafts, (state) => (tab ? (state.drafts[tab.id]?.text ?? "") : ""));
  const draftsReady = useStore(drafts, (state) => state.ready);
  const native = useAppView((view) => view.viewport.directInput === "native");
  const owner = useStore(app.focus, (state) => state.owner);
  const nativeState = useStore(nativeLine, (state) => state);
  const inputText = useRef(text);
  const currentTab = useRef(tab);
  const currentOwner = useRef(owner);
  const suppressImeReturn = useRef(false);
  inputText.current = text;
  currentTab.current = tab;
  currentOwner.current = owner;

  const edit = (value: string, element: HTMLTextAreaElement): void => {
    if (!tab) return;
    if (/[\r\n]/.test(value)) {
      value = value.replace(/[\r\n]/g, "");
      element.value = value;
    }
    const result = drafts.edit(tab.key, value);
    if (result === "ok") {
      onNote(null);
      return;
    }
    element.value = text;
    element.style.height = `${String(Math.min(element.scrollHeight, 114))}px`;
    onNote({ tone: "error", text: result === "tooLarge" ? "Draft too large: the limit is 64 KiB" : "Too many saved drafts: clear one" });
  };

  const send = (forTab: Tab, value: string): void => {
    const result = drafts.send(forTab, value);
    onNote(result === "notConnected" ? { tone: "error", text: "Not connected" } : null);
  };

  if (native) {
    const bound = nativeState.tabId === tab?.id;
    const value = bound ? nativeState.text : text;
    const selection: TextRange = bound ? nativeState.selection : { start: value.length, end: value.length };
    return (
      <LineMirror
        label={label}
        placeholder={tab ? "Type or dictate a line" : "Open a window to type"}
        value={value}
        selection={selection}
        marked={bound ? nativeState.marked : null}
        disabled={!tab || !draftsReady}
        onCaret={(index) => {
          if (!tab) return;
          if (owner !== "line") {
            nativeLine.open(tab, text, index);
            app.focus.nativeLineFocus();
          } else nativeLine.caret(tab, text, index);
        }}
        onSelectAll={() => { if (tab) nativeLine.selectAll(tab, value); }}
        onClear={() => { if (tab) nativeLine.clear(tab); }}
        onPaste={() => {
          terminals.pastes.pasteFromMenu((pasted, pasteTarget) => {
            const stillTargetingLine = currentOwner.current === "line" && currentTab.current?.id === pasteTarget.id && nativeLine.isBound(pasteTarget.id);
            if (hasInnerBreak(pasted)) {
              terminals.pastes.paste({ kind: "text", text: pasted }, pasteTarget);
              app.notify("Pasted text has several lines: sent to the terminal as one paste, without Enter");
            } else {
              if (!stillTargetingLine) return false;
              app.platform.input.insertLine(withoutTrailingBreak(pasted));
            }
            return true;
          });
        }}
      />
    );
  }

  return (
    <LineInput
      label={label}
      placeholder={tab ? "Type or dictate a line" : "Open a window to type"}
      value={text}
      disabled={!tab}
      focusTarget="line"
      inputRef={inputRef}
      onInput={edit}
      onKeyDown={(event) => {
        // Return confirming an IME candidate is the IME's, not a send. Safari reports it after
        // `compositionend`, as keyCode 229 with isComposing already false.
        if (event.key !== "Enter") return;
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        if (event.isComposing || event.keyCode === 229) {
          suppressImeReturn.current = true;
          setTimeout(() => { suppressImeReturn.current = false; }, 0);
          return;
        }
        event.preventDefault();
        if (tab) send(tab, inputText.current);
      }}
      onBeforeInput={(event) => {
        // Cancel only a real chord; unchordable and multi-character inserts stay in the line.
        if (event.inputType === "insertText" && event.data && modifiers.chord([{ text: event.data }])) {
          event.preventDefault();
        }
        if (event.inputType === "insertLineBreak" || event.inputType === "insertParagraph") {
          event.preventDefault();
          const imeReturn = event.isComposing || suppressImeReturn.current;
          suppressImeReturn.current = false;
          if (!imeReturn && tab) send(tab, inputText.current);
        }
      }}
      onCompositionStart={() => { modifiers.disarm(); }}
      onPaste={(event) => {
        const pasted = readPaste(event.clipboardData);
        if (pasted.kind === "image" || (pasted.kind === "text" && hasInnerBreak(pasted.text))) {
          event.preventDefault();
          terminals.pastes.paste(pasted);
          app.notify(pasted.kind === "image" ? "Image sent to the terminal, not the line" : "Pasted text has several lines: sent to the terminal as one paste, without Enter");
        } else if (pasted.kind === "text" && /[\r\n]/.test(pasted.text)) {
          event.preventDefault();
          const field = event.currentTarget;
          const start = field.selectionStart;
          const end = field.selectionEnd;
          field.setRangeText(withoutTrailingBreak(pasted.text), start, end, "end");
          field.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }}
    />
  );
}
