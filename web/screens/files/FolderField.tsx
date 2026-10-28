import { PathInput } from "../../ui/primitives/PathInput";
import { CompletionList } from "./CompletionList";
import type { useCompletion } from "./completion";
import type { FilesSession } from "./session";
import styles from "./FolderField.module.css";

interface Props {
  session: FilesSession;
  /** The completing field's behaviour, from `useCompletion`: the caller drives it, so it can act on the text. */
  field: ReturnType<typeof useCompletion>;
  label: string;
  value: string;
  placeholder?: string;
  hint?: string;
  /** Under the field, in the error colour: the caller's own refusal; the field's own ("No folder …") shows too. */
  error?: string | null;
  initialFocus?: boolean;
}

/** A labelled path field with its completions under it, for the forms (the Files tab's own is `PathField`). */
export function FolderField({ session, field, label, value, placeholder, hint, error, initialFocus }: Props) {
  const problem = error ?? field.said;
  return (
    <div class={styles.field}>
      <label class={styles.label}>
        {label}
        <PathInput
          label={label}
          value={value}
          {...field.input}
          {...(placeholder !== undefined && { placeholder })}
          {...(initialFocus && { "data-initial-focus": "" })}
        />
      </label>
      {problem ? <p class={styles.error} role="alert">{problem}</p> : hint && <p class={styles.note}>{hint}</p>}
      {field.completion && field.home !== null && (
        <div class={styles.completions}>
          <CompletionList completion={field.completion} home={field.home} hostName={session.hostName} {...field.list} />
        </div>
      )}
    </div>
  );
}
