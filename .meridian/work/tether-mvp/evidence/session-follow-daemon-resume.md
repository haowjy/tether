# Session-follow daemon: implementation and verification

## Result

The daemon now treats a session as one coherent `View`: it owns the last window/pane
shown by an accepted Locate, the pending reported target, selection state, and the
claim. A claim holds only its watch and pending take; its window is derived from the
view target (selection, pending target, shown window). `View::retarget` is the single
pure transition path that clears a claim when a known target moves away, while a
pre-bind claim survives from no target to the first target.

`CurrentWindow` changes the target and schedules Locate without editing shown metadata
or pane ownership. A Bound view and its old stream remain live during that Locate.
`watching` and shown-window event handling use only the coherent shown window; target
lookups are separate for `Acted`, layout-vote confirmation, subscriptions, and claims.
`watch`/`resize` claim the selected target; `input`/`paste` claim only when their
client-reported window is the target. Vote/take planning is shared by requests and
reconciliation. View-owned keys, Locate state, stream state, and vote records are
co-located with the View model, avoiding a View/State type dependency cycle.
Created-window claims require the watch still to belong to the view and force a Locate
even when one is already in flight.

The source/doc changes are in `src/hub/view.rs`, `src/hub/{state,owners,requests,
reconcile,mod}.rs`, `src/tmux/{mod,command}.rs`, `tests/support/script.rs`, existing
hub-state expectations, tmux fixtures and `examples/record-tmux-fixtures.rs`,
`docs/design/daemon-core.md`, `src/hub/AGENTS.md`, and `CHANGELOG.md`. Existing p235/p238
work elsewhere in the shared checkout was preserved; no web/ios files were edited in
this daemon change.

## Review decisions

- Accepted p242's derived-target and coherent-shown model, but implemented its intent
  against the current daemon code rather than copying its pseudocode. Rejected an
  unbound/`current = None` transition during every window switch: it would refuse
  input for the Locate round trip, release a pane that should keep streaming, and
  violate the spec's Bound-to-Bound behavior.
- Kept `Created.window` / `WindowRef`: it is the meaningful creation result and is not
  needed to remove the invalid duplicated claim state.
- Removed duplicate NewWindow hold/event bookkeeping, the unused view `session_name`,
  optional `SelectWindow.vote`, repeated checks, and the old leaving special case.
  Did not introduce a general `view_of(client)` ownership abstraction or split files
  merely to reduce line count; neither improves the responsibility boundary.
- Consolidated `vote_plan` because the request and reconcile paths must make the same
  take decision. Kept the current one-view-per-session/client ownership model rather
  than broadening the redesign.
- A mismatched `CurrentWindow` while a selection is unresolved records the observed
  window and triggers Locate but leaves the selected window as target until a matching
  notification or authoritative Locate resolves the selection. This prevents a late
  event from an earlier rapid selection from retargeting the new selection's claim.
  Real probes did not show that event arriving late: on tmux 3.4 the earlier
  notification preceded the second reply and Locate; on 3.7b it was coalesced/absent.
  The guard is retained because it is small and preserves the newer explicit selection
  if a future ordering differs. The authoritative Locate remains the final source of
  shown state.

## Race checks

A temporary strengthened fake-hub scratch test suite based on `/tmp/rev-sf/repo/tests/
review_races.rs` was run and removed afterward (no new permanent tests were retained).
All six checks passed:

1. `resize` during selection votes/takes the selected window, not the window being left.
2. A claiming watch during selection claims the selected window.
3. Layout for the target before Locate does not emit mixed `watching` metadata; the old
   shown pane continues streaming until Locate.
4. A pre-bind claim survives `CurrentWindow` and votes for the first authoritative
   target.
5. A `created` answer that wins a race with an in-flight Locate schedules a fresh
   Locate and claims the created target.
6. A watch that leaves before `created` gets no ghost claim; rapid consecutive selects
   retain the newer target against a stale earlier notification.

A temporary live-tmux ordering probe was also removed after use. It ran on isolated
private tmux servers, not the personal server. On 3.4, the first selection's
notification appeared before the second selection reply and the queued Locate reply;
on 3.7b, that earlier notification was absent/coalesced. The probe did not establish a
late notification; the guard above is defensive against that ordering, not a claimed
reproduction of it.

## Verification

- `cargo fmt --all -- --check` — passed.
- `cargo test` — passed after removing scratch tests: 97 library tests, 21 `http_auth`,
  4 `http_fs`, 6 `hub_real`, 33 `hub_state`, 20 `tmux_real`, 17 `tmux_session`, and doc
  tests. In this invocation real-tmux-gated tests were skipped by their normal env gate.
- `TETHER_TMUX_TESTS=1 TETHER_TMUX="$HOME/.cache/tether-tmux/3.4/bin/tmux" cargo test
  --test tmux_real --test hub_real -- --test-threads=1` — passed: 6 hub-real and 20
  tmux-real tests against tmux 3.4. The harness uses isolated `-L` servers.
- The same command with `3.7b/bin/tmux` — passed: 6 hub-real and 20 tmux-real tests
  against tmux 3.7b, also isolated.
- `cargo clippy --all-targets -- -D warnings` — passed after fixing one reported
  nonminimal-boolean lint.
- `cargo +1.85 check --locked --all-targets` — passed; no post-MSRV syntax slipped in.
- `git diff --check` — flags trailing spaces in the recorded tmux golden `.out` fixtures; these spaces are terminal screen contents needed for replay. `git diff --check` on source, docs, guidance, changelog, and Rust test-support files (excluding recorded output fixtures) passes.

## Not run / remaining

No web E2E, Swift suite, release build, or phone probe was run for this daemon-only
change. The task did not require full web E2E and no iOS source was touched. Permanent
race tests worth adding later: the six cases above as asserted hub-state tests, plus a
stable live test for selection notification ordering only if tmux guarantees it across
supported versions.
