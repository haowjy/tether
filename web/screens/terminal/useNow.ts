import { useEffect, useState } from "preact/hooks";

/** The clock for countdowns and "Connecting…" while the tab on screen is not live. */
export function useNow(running: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = setInterval(() => { setNow(Date.now()); }, 1000);
    return () => { clearInterval(timer); };
  }, [running]);
  return running ? now : Date.now();
}
