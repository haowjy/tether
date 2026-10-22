import { render } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { createXtermRenderer } from "./term";
import { Tappable } from "./ui/Tappable";

// Dev stand-in until the tab UI exists: a terminal that shows the renderer works.
function App() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return;
    const term = createXtermRenderer(host.current);
    const enc = new TextEncoder();
    void term.snapshot({ cols: 60, rows: 12, restore: enc.encode("tether web\r\n\x1b[32mrenderer ok\x1b[0m\r\n") });
    return () => { term.dispose(); };
  }, []);
  return (
    <>
      <div ref={host} style={{ height: "70%" }} />
      <Tappable label="Reload" onTap={() => { location.reload(); }}>Reload</Tappable>
    </>
  );
}

const root = document.getElementById("app");
if (root) render(<App />, root);
