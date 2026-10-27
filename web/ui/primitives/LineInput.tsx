import type { TargetedClipboardEvent, TargetedInputEvent, TargetedKeyboardEvent, TargetedEvent } from "preact";
import type { Ref } from "preact";
import { useCallback, useLayoutEffect, useRef } from "preact/hooks";
import { cx } from "../cx";
import { useFocusRef, type FocusTarget } from "../focus";
import styles from "./LineInput.module.css";

interface LineInputProps {
  /** The accessible name: the field has a placeholder, not a visible label. */
  label: string;
  value: string;
  /** The new text, and the element, so a refused edit can put its text back. */
  onInput: (value: string, el: HTMLTextAreaElement) => void;
  /** Registers the input with the focus controller under this name. */
  focusTarget?: FocusTarget;
  inputRef?: Ref<HTMLTextAreaElement>;
  placeholder?: string;
  disabled?: boolean;
  class?: string;
  onKeyDown?: (e: TargetedKeyboardEvent<HTMLTextAreaElement>) => void;
  onBeforeInput?: (e: TargetedInputEvent<HTMLTextAreaElement>) => void;
  onCompositionStart?: (e: TargetedEvent<HTMLTextAreaElement, CompositionEvent>) => void;
  onCompositionEnd?: (e: TargetedEvent<HTMLTextAreaElement, CompositionEvent>) => void;
  onPaste?: (e: TargetedClipboardEvent<HTMLTextAreaElement>) => void;
}

/**
 * The browser/PWA dock's one logical line. It wraps to five visual lines, then scrolls;
 * Return and multiline paste are handled by the dock, not by this textarea.
 */
export function LineInput({ label, value, onInput, focusTarget, inputRef, class: className, ...rest }: LineInputProps) {
  const registered = useFocusRef(focusTarget);
  const field = useRef<HTMLTextAreaElement | null>(null);
  // Stable: a new ref callback each render would withdraw and register the field every time, and each registration is a focus-owner change that renders again.
  const attach = useCallback(
    (el: HTMLTextAreaElement | null) => {
      registered(el);
      if (typeof inputRef === "function") inputRef(el);
      else if (inputRef) inputRef.current = el;
    },
    [registered, inputRef],
  );
  const element = useCallback((el: HTMLTextAreaElement | null) => {
    field.current = el;
    attach(el);
    if (el) resize(el);
  }, [attach]);
  useLayoutEffect(() => {
    if (field.current) resize(field.current);
  }, [value]);
  useLayoutEffect(() => {
    const element = field.current;
    if (!element) return;
    let width = element.getBoundingClientRect().width;
    const observer = new ResizeObserver(([entry]) => {
      const nextWidth = entry?.contentRect.width;
      if (nextWidth === undefined || nextWidth === width) return;
      width = nextWidth;
      resize(element);
    });
    observer.observe(element);
    return () => { observer.disconnect(); };
  }, []);
  return (
    <textarea
      rows={1}
      enterkeyhint="send"
      autocapitalize="off"
      autocomplete="off"
      autocorrect="off"
      spellcheck={false}
      {...rest}
      value={value}
      onInput={(e) => { resize(e.currentTarget); onInput(e.currentTarget.value, e.currentTarget); }}
      aria-label={label}
      class={cx(styles.input, className)}
      ref={element}
    />
  );
}

/** The fixed line-height, five-row ceiling plus the field's fixed padding and border. */
const MAX_HEIGHT = 114;

function resize(element: HTMLTextAreaElement): void {
  element.style.height = "34px";
  element.style.height = `${String(Math.min(element.scrollHeight, MAX_HEIGHT))}px`;
  element.style.overflowY = element.scrollHeight > MAX_HEIGHT ? "auto" : "hidden";
}
