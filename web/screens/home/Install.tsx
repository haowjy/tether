import { useApp, useAppView } from "../../app/context";
import styles from "./Install.module.css";

/** On a phone that hasn't installed the app: how to Add to Home Screen. Nothing otherwise. */
export function Install() {
  const install = useApp().platform.install;
  const phone = useAppView((v) => v.viewport.layout === "phone");
  if (!phone || install === undefined || install.installed()) return null;
  return (
    <section class={styles.install} aria-labelledby="install-heading">
      <h2 id="install-heading" class={styles.heading}>Add to Home Screen</h2>
      <ol class={styles.steps}>
        <li>Tap Share in Safari.</li>
        <li>Tap Add to Home Screen.</li>
      </ol>
      <p class={styles.detail}>The installed app and Safari keep separate drafts and tabs, though one enrolment covers both.</p>
    </section>
  );
}
