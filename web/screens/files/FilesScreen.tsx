// Stub: W3 owns screens/files/. On desktop Files is a rail destination; on phone it is
// Home's Files pane (Home.tsx renders it there).
import { EmptyState } from "../../ui/primitives/EmptyState";
import styles from "./FilesScreen.module.css";

export function FilesScreen() {
  return (
    <div class={styles.files}>
      <header class={styles.header}><h1 class={styles.title}>Files</h1></header>
      <EmptyState icon="folder" title="Files">The folder list and previews arrive with the Files screen.</EmptyState>
    </div>
  );
}
