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
