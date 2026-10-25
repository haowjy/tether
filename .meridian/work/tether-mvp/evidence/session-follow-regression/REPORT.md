# Session-follow regression/edge probe — incomplete gate

## Scope and provenance

Read the requested resume plan, review, fixes and p249 acceptance notes, plus repository and `web/AGENTS.md` instructions. No source edits, suites, permanent tests, tmux operations, browser sessions, or services were started. No existing process/service was reset. Existing checkout was already heavily dirty when inspected; this probe made no source changes. Because no full source hash was captured before the initial read/build, I cannot certify that no external production change occurred during the run.

Built the integrated current tree with `pnpm --dir web run build` and `cargo build --bin tether --locked` (both exit 0; these are build commands, not suites). Web build emitted its existing >500 kB chunk warning. Binary SHA-256: `ec6a2762714107556da32400e5d207b8cbddeba0b9cd62e7c6119225593a21be`; `target/debug/tether`, 30,272,200 bytes, mtime `2026-10-25 17:24:06 -0400`. HEAD: `3821927c3c37c1760bf52f0128db2f3cd636d791`. Vite production output was built to `/tmp/sfr-web-dist`; the normal `pnpm build` also refreshed ignored `web/dist` as required by the daemon embed build. No daemon/browser proxy or tmux server was started.

## Runtime outcomes

**No requested runtime case was executed.** There are no case-level pass/fail observations, screenshots, or actual tmux size/pane evidence from this run. Specifically unverified here:

- delayed clipboard Paste and delayed image/Files insertion target retention, including closed-tab refusal;
- reconnect-only inside the sizing band and explicit Fit/open return, including actual tmux dimensions;
- rapid select/resize overlap, coherent final window/name/pane/size, and selection tracking accumulation;
- short desktop viewport with many windows, scrolling/keyboard reachability, New window focus return, and touch-emulated focus;
- controlled loading/refusal Try again states;
- configured scratch-root setup, listing, create/browse/Go/Back/Cancel/insert, and v1 credential preservation;
- behavior on isolated tmux 3.4 and 3.7b.

Prior evidence in `evidence/session-follow-client-fixes.md` contains disposable unit/browser probes for several fixes, and p249 covers baseline behavior, but neither is a substitute for the independently requested runtime cases above. Native iPhone clipboard permission prompt and keyboard behavior remain a separate physical-device gate; this run does not certify them.

## Cleanup / handoff

No process, browser, tmux server, or persistent test was left running. `/tmp/sfr-web-dist` contains only disposable generated output. This is an incomplete verification run, not acceptance. Follow-up should provision a spawn-id-scoped private daemon/proxy/browser setup and isolated `-L` tmux servers before claiming any of the requested cases.
