# Browser auth revision 6: apply review 5 (deletions)

Revise `.meridian/work/tether-mvp/design/browser-auth.md` per
`design/browser-auth-review-5.md` (verdict: approve with notes). Apply M1 (`serve.sock`
must appear exactly once in the whole serve config, as the only handler of one HTTPS
entry; delete the uid rule, its state, accept-time close and test row), M2 (delete the
≥1.100 version gate; floor at 1.94; describe sudo as a fact of tailscaled ≥ 1.100;
correct every "only root can re-point" claim), M3 (the dev proxy must not reopen D1:
choose the simpler of a Unix socket in a 0700 dir or no injected token, and say why),
and L1–L5 (one tailnet-state cache with background retry; upgrade detection matches only
the old `127.0.0.1:<port>` target; startup with LocalAPI down; the allowlist wording;
list `client-architecture.md` drift in the notes — don't edit that file). The aim is a
smaller doc: the §3.3 table should shrink. Edit only browser-auth.md and the notes file;
commit them by pathspec with a message ending
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Report what changed.
