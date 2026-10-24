import { useApp } from "../../app/context";
import { Button } from "../../ui/primitives/Button";
import styles from "./Enrol.module.css";

/** The app has no server yet: pairing happens in the platform's own screen. */
export function NoServers() {
  const app = useApp();
  return (
    <div class={styles.page}>
      <div class={styles.form}>
        <h1 class={styles.title}>Add a server</h1>
        <p class={styles.step}>On the server, run <code>tether enroll</code>, then enter its address and the code it prints.</p>
        <Button variant="primary" onClick={() => { app.platform.manageHosts?.(); }}>Add a server</Button>
      </div>
    </div>
  );
}
