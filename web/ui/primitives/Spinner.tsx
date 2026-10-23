import styles from "./Spinner.module.css";

/** Loading. Names itself for assistive technology; the screen says what is loading beside it. */
export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <span class={styles.spinner} role="status" aria-label={label}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
        <path d="M12 3a9 9 0 1 1-9 9" />
      </svg>
    </span>
  );
}
