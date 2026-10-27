// The dock's line field is an editable browser control or a renderer for the app's native editor.
import { useEffect, useMemo, useRef } from "preact/hooks";
import { useApp, useAppView } from "../../../app/context";
import type { TextRange } from "../../../platform/types";
import { DockButton } from "../../../ui/primitives/DockButton";
import { LineInput } from "../../../ui/primitives/LineInput";
import { useStore } from "../../../ui/store";
import type { TerminalTab } from "../../../workspace/state";
import { readPaste } from "../paste";
import { terminalsOf } from "../terminals";
import { browserLineEditor } from "./lineEditor";
import { LineMirror } from "./LineMirror";
import { lineDraftsOf } from "./lineDrafts";
import { nativeLineOf } from "./nativeLine";
import styles from "./Dock.module.css";

export type LocalNote = { tone: "error" | "info"; text: string };

interface LineFieldProps {
  tab: TerminalTab | null;
  label: string;
  onNote: (note: LocalNote | null) => void;
}

/** The line is one logical line. One trailing paste break is dropped; multiple lines go to tmux. */
const withoutTrailingBreak = (text: string): string => text.replace(/\r?\n$/, "").replace(/\r$/, "");
const hasInnerBreak = (text: string): boolean => /[\r\n]/.test(withoutTrailingBreak(text));

export function LineField({ tab, label, onNote }: LineFieldProps) {
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
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Whether the textarea's IME is composing: the caret step and Send wait for it (the browser's twin of native's marked text).
  const composing = useRef(false);
  const editor = useMemo(() => browserLineEditor(inputRef, composing), []);
  // The key row edits this box through the controller.
  useEffect(() => {
    terminals.browserLine = editor;
    return () => { terminals.browserLine = null; };
  }, [terminals, editor]);
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

  const send = (forTab: TerminalTab, value: string): void => {
    const result = drafts.send(forTab, value);
    onNote(result === "notConnected" ? { tone: "error", text: "Not connected" } : null);
  };

  // Acts as Return does, and takes no focus: the box keeps the keyboard (DockButton). In the app native holds the text, so it submits.
  const sendButton = owner === "line" && (
    <DockButton
      kind="control"
      class={styles.send}
      disabled={!tab}
      onClick={() => {
        if (native) app.platform.input.submitLine();
        else if (tab && !composing.current) send(tab, inputText.current);
      }}
    >
      Send
    </DockButton>
  );

  if (native) {
    const bound = nativeState.tabId === tab?.id;
    const value = bound ? nativeState.text : text;
    const selection: TextRange = bound ? nativeState.selection : { start: value.length, end: value.length };
    return (
      <>
      <LineMirror
        label={label}
        placeholder={tab ? "Type or dictate a line" : "Open a window to type"}
        value={value}
        selection={selection}
        marked={bound ? nativeState.marked : null}
        active={owner === "line"}
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
      {sendButton}
      </>
    );
  }

  return (
    <>
    <LineInput
      label={label}
      placeholder={tab ? "Type or dictate a line" : "Open a window to type"}
      value={text}
      disabled={!tab}
      focusTarget="line"
      inputRef={inputRef}
      onInput={edit}
      onKeyDown={(event) => {
        // A hardware Esc goes where the key row's esc does (the same dispatch as the app's native line).
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        if (event.key === "Escape" && !event.isComposing && event.keyCode !== 229) {
          event.preventDefault();
          terminals.key({ name: "Escape" });
          return;
        }
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
        // Cancel only a real chord (sent to tmux); unchordable and multi-character inserts stay in the line.
        if (event.inputType === "insertText" && event.data && modifiers.route({ text: event.data }, "line").to === "terminal") {
          event.preventDefault();
        }
        if (event.inputType === "insertLineBreak" || event.inputType === "insertParagraph") {
          event.preventDefault();
          const imeReturn = event.isComposing || suppressImeReturn.current;
          suppressImeReturn.current = false;
          if (!imeReturn && tab) send(tab, inputText.current);
        }
      }}
      onCompositionStart={() => {
        composing.current = true;
        modifiers.disarm();
      }}
      onCompositionEnd={() => { composing.current = false; }}
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
    {sendButton}
    </>
  );
}
