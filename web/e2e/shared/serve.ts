// Starts one isolated stack (stack.ts) and prints its URL, for driving the app by hand against a
// real daemon and a private tmux without touching your own sessions. Ctrl-C stops it.
//   pnpm --dir web run e2e:stack            # tmux 3.4
//   TETHER_E2E_TMUX=3.7b pnpm --dir web run e2e:stack
import { startStack, type TmuxVersion } from "./stack.ts";

const tmux = (process.env["TETHER_E2E_TMUX"] ?? "3.4") as TmuxVersion;
const stack = await startStack({ tmux, name: "by-hand" });
console.log(`tether stack (tmux ${tmux}): ${stack.url}`);
console.log(`tmux: ${stack.tmux("-V").trim()}; drive its sessions with the tmux socket "by-hand"; files in ${stack.dir}`);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    void stack.stop().finally(() => { process.exit(0); });
  });
}
setInterval(() => undefined, 1 << 30);
