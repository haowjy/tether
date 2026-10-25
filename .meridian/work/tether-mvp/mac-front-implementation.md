# Mac front implementation (M1–M4)

Implemented the Mac LocalAPI transport, opt-in LaunchAgent loopback front, conditional
Serve publication/withdrawal plan, and LaunchAgent plist/docs. The M2 gate rejects
absolute-form requests and compares the raw secret prefix in constant time; rejected
paths get an empty 404 before routing. Handler/target/front debug output redacts the
secret. The published authority watch uses `Arc<str>` so gate reads don't allocate a
new string per request. M3 publication re-reads and re-plans after `If-Match`
conflicts. Linux's Unix front and LocalAPI transport remain on their existing paths.
No design divergence.

Verification: `cargo test`, `scripts/preflight.sh full`, `cargo check --target
x86_64-unknown-linux-gnu --all-targets`, `cargo +1.85 check --locked --all-targets`,
and the same +1.85 cross-check for x86_64 Linux all passed. The aarch64 macOS
all-targets check and `plutil -lint contrib/com.jimmyyao.tether.plist` passed. The
18-test real-tmux suite passed against both tmux 3.4 and 3.7b. The Loopback
integration uses only a TCP fake LocalAPI, verifies Basic auth, and injects a
concurrent ETag conflict to prove re-planning preserves the concurrent edit.

Not run by design: M0–M8 and any real Serve publication or LaunchAgent load. The
Linux `--publish` exit path was cross-compiled but not run on a Linux host. After
review and Jimmy's log-upload opt-out, the Mac probe gates remain necessary.

## 2026-10-24: log opt-out isn't available, Jimmy accepts the logged secret
- **What happened:** Jimmy set `TS_NO_LOGS_NO_SUPPORT=true` in the extension's `tailscaled-env.txt`.
- **What we saw:** `tailscale bugreport` still printed a normal ID. The extension process (pid 23448) had not restarted since Oct 23 08:00.
- **What Tailscale's docs say:** https://tailscale.com/docs/features/logging.md says the opt-out works on macOS only with the open-source tailscaled variant, not the Standalone or App Store app (tracked in tailscale#5114). Our `tailscaled-env.txt` step for the app was an unverified assumption.
- **Jimmy's decision:** keep the app and accept that the rotating secret is logged. The secret only works from inside the tailnet and changes on every start.
- **Rejected:** switching the Mac to Homebrew tailscaled, and dropping Mac hosting.
- **Doc work after p187 lands:**
  - Remove the opt-out step from running.md.
  - Fix auth.md ~420 and gate M7 (M7 becomes: confirm the secret rotates per start).
  - Rewrite the decisions.md log-upload entry.
- **Side effect:** the lead ran `tailscale bugreport` twice without the opt-out in effect, which uploaded two bug reports.

## 2026-10-24: tether setup (new task)
- **Jimmy's ask:** one command that runs tether as a background service, publishes it on the tailnet, and prints the link. The name is `tether setup`.
- **Sharing:** asked whether "others" means Jimmy's own devices or other people. Not answered yet; the default is his own devices. Multi-user would need its own design.
- **Status:** p190 is researching whether a Linux Tailscale operator can POST serve-config without root.
- **Next:** a design spec in docs/design, review, then build.
- **Lead's leanings:**
  - Embed `contrib/tether.service` and the plist with `include_str!`, so there is one source.
  - Reuse the publish plan with a `ServeTarget::Unix` target.
  - Make it idempotent.
  - Print the enrol URL and code, plus a terminal QR.

## 2026-10-25: setup runs in the foreground by default (Jimmy)
- **Jimmy's call:** "1. but forgroudn default with --backgroud".
- **The new shape:**
  - `tether setup` checks, publishes, prints the link, QR and code, then runs the daemon in the terminal until Ctrl-C.
  - `tether setup --background` installs the service, which is what the spec at f86c943 describes.
- **Mac:** phone access needs launchd's socket, so a foreground run on a Mac has no phone access. The lead's plan: on the Mac, plain `tether setup` refuses and points to `--background`.
- **Sequencing:** p195 is building the background path from f86c943. A follow-up lane adds the foreground default after it lands, to avoid two lanes editing setup.md and main.rs at once.

## 2026-10-25: setup build landed, review round 1
- p195 committed 9343b6a and ae13307 (unpushed, on top of unpushed f86c943).
- Reviews p196 (correctness) and p197 (alignment): request changes. Real bugs: Web-entry
  `HTTPS` field tailscaled drops (every Linux rerun rewrites Serve), no-TTY rerun refused,
  `print-disabled` format (`=> disabled`) on current macOS, Linux refusal text, decision log gaps.
- p198 coder fixing all as fixup commits (brief: prompts/setup-fixes.md). Lead autosquashes.
- Next: foreground lane from setup-foreground-spec.md, then thermo + correctness review of the
  whole, then S9 on the Mac, then push.
- p198 fixes autosquashed: setup commits are now 5adb000 and d548423. p199 building the
  foreground default (prompts/setup-foreground.md): refactor commit + feature commit.
- p199 landed ef6fb08 (daemon into src/daemon.rs) and d1a6f7b (foreground default). Round 2:
  p200 approve-with-notes (bg setup vs a terminal run, runtime-dir mismatch, exit 78), p201
  request-changes (mod.rs structure; grant before open). Fix lane launched (prompts/setup-fixes-r2.md),
  two commits on top. Round 3 = last review round for this target before investigating design.
- Round 3: p203 approve-with-notes (S1 seam + D1–D6, nothing blocking). p204 S9/S13 on the real
  Mac pass, state restored (evidence/setup-s9/README.md). p205 doing S1+D1–D6 as one commit; the
  lead reads that diff directly (no 4th review round), then preflights each commit and pushes.
- p205 landed e21d039 "Collapse setup's foreground daemon seam"; lead read the daemon/setup diff
  (open does all fallible steps; foreground = open → grant → publish → refresh → finish → run).
  Per-commit preflight running for fcba751..HEAD. Then: fold CHANGELOG bullets 3–4 into 1–2
  (they describe fixes to unshipped setup), commit work-dir records, push.
- Still owed: S1–S8, S12 on pop-os (ssh host key not accepted from the Mac); S9 hand items;
  kb-lead capture via /post-dev.
