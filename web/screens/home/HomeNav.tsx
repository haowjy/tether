import { useApp } from "../../app/context";
import { NavButton } from "../../ui/primitives/NavButton";
import styles from "./Home.module.css";

/** Phone Home's bottom navigation: Sessions and Files, with small captions. */
export function HomeNav({ pane }: { pane: "sessions" | "files" }) {
  const app = useApp();
  return (
    <nav class={styles.nav} aria-label="Home">
      <NavButton icon="sessions" label="Sessions" current={pane === "sessions"} onClick={() => { app.router.go("home"); }} />
      <NavButton icon="folder" label="Files" current={pane === "files"} onClick={() => { app.router.go("files"); }} />
    </nav>
  );
}
