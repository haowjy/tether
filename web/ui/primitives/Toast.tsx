import { IconButton } from "./IconButton";
import styles from "./Toast.module.css";

interface ToastProps {
  /** One message at a time; null shows nothing but keeps the live region mounted so a new message is announced. */
  message: string | null;
  onDismiss: () => void;
}

/** The one polite live region for notices such as "2 tabs closed: their windows are gone". */
export function Toast({ message, onDismiss }: ToastProps) {
  return (
    <div class={styles.region} role="status" aria-live="polite">
      {message !== null && (
        <div class={styles.toast}>
          <span class={styles.text}>{message}</span>
          <IconButton icon="close" label="Dismiss" onClick={onDismiss} />
        </div>
      )}
    </div>
  );
}
