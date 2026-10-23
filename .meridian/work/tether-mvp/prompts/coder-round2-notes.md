# Apply the round-2 review notes

Two round-2 reviews approved with notes; read both: browser admission /Users/jimmyyao/.meridian/projects/steep-lamp-cloud/spawns/p87/report.md, limits and
wrap /Users/jimmyyao/.meridian/projects/steep-lamp-cloud/spawns/p88/report.md. Apply:
1. **N1 (medium)**: refused auth.toml rows live outside the store's name rules. unique_name treats
   refused rows' names as taken, and `tether device list` shows refused rows (e.g. "refused
   (unknown field)") so their names are visible. Fix the class at the shared name check.
2. **N2**: AuthError::Busy maps to HttpError::Busy (503 busy with Retry-After: 1) per auth.md; Store
   stays AuthUnavailable.
3. **N3**: merge the tailnet cell's always-equal failed/retrying flags into one and delete the
   unreachable branch.
4. **N4**: the native welcome and manifest take the machine name from last_known(), never waiting on
   LocalAPI; take the fresh value only when already fresh.
5. **N5**: stale comment ws.rs:383.
6. **Deferred low**: `tether device list` shows the stored stable ID only; delete the full /status
   fetch (main.rs ~283) and LocalApi::known_nodes() if nothing else uses it. Update auth.md/§3.14 text
   if it describes peer status.
7. **Limits low**: delete SPEC_CEILINGS_TENTHS_MIB and its assert_eq! (the parsed spec ceilings vs
   ceiling_kib is the guard).
8. **Cosmetic**: escape_end's redundant ESC check (pick one place); daemon-core §3.5 step 3 says
   first_character skips leading CSI/OSC and two-byte ESC sequences.

You are the only coder in the checkout now. Commit each coherent change with
`git commit --only -m ... -- <paths>` (one change per commit; group 2-5 as one auth-cell commit if
that is cleaner), each passing `scripts/preflight.sh full --commit <sha>`. The web client uses
pnpm, never npm. Never touch the installed tether service, Tailscale serve config, or real tmux
sessions. Verify N1 with the CLI against temporary state, and N2 with a probe. No new tests beyond
extending existing ones where a changed behaviour already has coverage. Don't push. Commit messages
end `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Report commits and verification.
