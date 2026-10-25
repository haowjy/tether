# Session-follow completion

Resume authorized by Jimmy: “ok, continue with them. reminder that use ur judgement if u think stuff are actually issues”. Existing edits belong to this interrupted task, recovered in recovery-c204.md; preserve and finish them. Primary checkout/main only, no worktrees, no push or release. No new permanent tests without request.

## Plan and gates

1. Inventory surviving client work and orphaned code against HEAD 3821927 (read-only explorer). Baseline web check runs before edits. Read review p237 directly and inspect state ownership.
2. Structure pre-dev review, informed by inventory: centralize claim transition rules rather than scattering fixes; keep shown window and pane coherent while Locate is pending. File length is not independently a defect. Choose the smallest model that removes invalid states. Existing design review p233 stands; do not reopen settled UX.
3. Fix daemon claims/selection and finish web and Swift contract integration. Sequential writers in the primary checkout; each gets explicit ownership. Verify each boundary before dependent runtime probes. User-authorized interrupted work is not unrelated dirt. Existing fixtures and generated TS are retained.
4. Integrated gate: full web/Rust/Swift checks, tmux 3.4/3.7b real suites and real browser workflows; independent correctness/alignment review and runtime prober, then strict structural review after fixes. Count daemon p237 as first code-review round. Inspect dead code before thermo review.
5. Finalize docs/changelog, post-dev knowledge capture, coherent local commit(s) with clean-export preflight. Phone-only checks requiring Jimmy are reported honestly, not substituted with Playwright. No push.

## Initial judgment

p237's claim targeting inconsistency and mixed watching payload are plausible correctness bugs confirmed by source inspection: resize/watch and CurrentWindow derive transitions separately, and current_window changes ID on the old metadata. Consolidate the responsibility, not merely duplicate another conditional. Pre-bind claims must survive until the first authoritative Locate. SelectWindow's unused optional vote and redundant fields/checks should be deleted if inventory confirms no callers; broad one-view-per-client redesign is not required merely to shorten files.

Before-state evidence: p237 repro report and /tmp/rev-sf/repo/tests/review_races.rs if present; current uncommitted client check captured by lead. This is resuming implementation, so prior before-state screenshots and probes remain in the work evidence directory.

## Pre-dev completed

Inventory p241 complete; structural plan review p242 approves with refinements. Baseline web check passes (406 unit tests, lint/typecheck/build); baseline harness E2E 826 pass / 12 fail, representing six cases in two browsers (/tmp/tether-resume-e2e.log). Swift baseline fails two cases (auth protocol and bridge key shape).

Accept p242's derived target model: claims carry watch/take, not an independently mutable window; one View owns target transitions. ShownWindow and Bound pane remain coherent until Locate. Target/observed window must be distinguished in Acted/subscriptions/layout vote bookkeeping. Adopt removal of duplicate NewWindow state and unused fields/branches after verifying the call chains. Reject splitting session.rs merely for line count. Keep Created.window in this change: it is a meaningful creation result and removing it is not necessary to resolve these defects. Validate the proposed transition model with p237's repros and reordered events, rather than treating reviewer pseudocode as settled implementation.

Next writer: daemon fixes only. Then client/Swift integration. Primary checkout ownership recovered, no other source writer active; pre-dev ready. No PR/worktree under project initial-build policy.

## Runtime risk found during daemon fixes

p244 isolated raw-tmux probe reproduced upstream whole-server crash on both 3.4 and 3.7b for same-command-list select-window + kill-session with any control client attached (including one on another session). Separate select and kill survived observed trials; not proof of general safety. Evidence/session-follow-tmux-risk.md records repetitions and upstream fix. This predates session-follow; removing new selection UI would not remove exposure. Do not silently upgrade Jimmy's tmux or claim supported old versions are safe for arbitrary commands. Continue implementation and integrated checks in isolated servers; flag deployment/version decision before daily use. Notification attempted once: all Meridian routes disabled, Nothing delivered; notice delivered in chat instead.

Lead reading of in-progress View refactor raises an edge case to verify after the writer finishes: an initial claim must survive multiple CurrentWindow reports before first authoritative Locate, not only the first report. target() deriving next before shown exists may make the second report drop it. This is a hypothesis from source reading, not a confirmed defect.

## Daemon fix complete; client integration next

p243 completed daemon refactor and Rust gates (full tests, clippy/fmt/MSRV and isolated real suites on 3.4/3.7b). Evidence/session-follow-daemon-resume.md. Source review still required; lead's multi-notification pre-bind hypothesis remains to check. p244 complete and cleaned up its private servers. Next: client writer (web/ios only) plus independent read-only daemon correctness review (src/tests stable). These are separate ownership domains; no parallel source writers. Integrated acceptance starts after writer/report drain.

Round-2 daemon review artifact (p246) confirms main original bugs fixed and reproduces the lead's multiple-prebind-notification case. Accept F1: target ignores observed next until a shown window exists, preserving the first-Locate claim invariant. Accept F2 despite currently unused web cwd: a response must not carry old-window cwd, and Session already owns window subscription paths; remove duplicate View.cwd and derive from that owner. Accept first current-window subscription emission: silently swallowing it can miss a swap between Locate and subscription. Hub already ignores a redundant matching observation, so emitting removes a special case. These are second-round fixes; if another claim-model correction is required, follow reviewer limit/root-cause escalation rather than cycling. Lead will apply after client writer finishes. Changelog needs deduplication and explicit protocol/workspace incompatibility note.

Jimmy explicitly chose **“Temporary verification only”** for new window-switch race and session/bridge regression tests. Remove new cases introduced by this session-follow implementation, including interrupted p235/p238 additions, after using them to verify. Preserve/migrate pre-existing tests for changed semantics. Forwarded decision to p245. Keep concise evidence of temporary checks, not executable scaffolding in production tree.

## Integrated implementation, lead fixes

p245 finished web/native integration: web check 406, harness838, Swift7 and Simulator build pass. Real suite145 pass/1 timeout/30skip/4blocked, then terminal group52pass covers timeout and blocked cases; not one single uninterrupted green run. Evidence/session-follow-web/ and p245 report explain stale test changes and actual menu clipping/new-window focus fixes. No new tests from p245.

Lead applied p246 F1/F2 and first subscription notification: target remains absent until shown exists; cwd derived from Session per-window state (View.cwd deleted); first c subscription emits CurrentWindow. Existing hub_state33/tmux_session17 passed; temporary three-case checks passed for two prebind notifications, first-value swap follow, and new-window cwd null-then-correct without stale old cwd. Early-Cwd injection in initial scratch was before subscription acknowledgment and correctly ignored, so this scratch does not claim the review's exact early-value ordering; ownership-based lookup removes the lost-copy path by construction. Scratch file removed. Changelog deduplicated and deployment/storage incompatibility made explicit. These are second-round fixes; final structural review next, no further claim fix loop without root-cause escalation.

Next gate lanes: remove new test cases per explicit user instruction (test-only writer); independent client correctness/alignment and runtime acceptance on built current production code. Final structural/dead-code review follows test cleanup. No production edits during runtime gate without invalidating affected evidence.

Daily-use tmux baseline decision filed as https://github.com/haowjy/tether/issues/2
(bug, decision-needed, work:tether-mvp). Installed binaries unchanged. The issue
contains the isolated reproduction and upstream fix, not private host data.

## Gate results and remaining client fixes

p247 removed 22 new cases (8 Rust / 14 web) and dedicated current-window fixture scenario; existing migrated cases retained. Rust 190 / web 392, clippy/fmt/MSRV pass. p248 approves client with notes; lead treats L1 unbounded select bookkeeping, L2 async clipboard wrong-window targeting, and L3 reconnect policy tied to display debounce as real fixes. p250 owns these plus bounded menu height, Dialog-owned return focus, and stale docs. Reject a mirrored mutable held flag where raw window/sent sizes already answer the question. L6 new permanent harness fixtures are not added under Jimmy's latest temporary-only instruction; states exercised temporarily instead.

p249 real-browser acceptance passed core flows on 3.4/3.7b, both larger/smaller PTYs, following and creation. Gaps: rapid selection/resize and async clipboard/upload target races; scratch Files listing setup unresolved. Follow-up prompt resume-regression.md closes those after p250. Real iPhone remains manual. Production unchanged during p249 despite test-only rebuild/artifact timestamp changes.

p251 final daemon thermo/correctness review runs against stable Rust; p252 resource probe uses immutable /tmp/tether-budget-source-c235 (656 files, SHA-256 223449c8470a0796d6a10f07045b5d5c8d6d7d19c2eb4d301287a2cd48cd930e), not the concurrently edited client. It includes final daemon and p245 client, before web-only p250 fixes; record that provenance distinction in any budget result.

## Reviewer model preference

Jimmy: “make sure to use opus reviewers instead of astra reviewers...” and “i consider oppus better at direction setting... and cutting stuff”. All reviewers launched in this session (p242, p246, p248, p251) used claude-opus-5-5. Keep Opus for subsequent reviews, particularly structural direction and deletion judgments; no Astra reviewer fallback. This is an explicit user model preference, not a quality-based escalation.

p251's final daemon artifact approves the model with no blocking finding and no further claim-model fix. Its scratch reproduced the previously unverified early-cwd ordering and confirmed correct final cwd. Lead will delete the orphaned fake SelectWindow parser and stale initial-subscription comment after the current gate drains. Keep Event::Cwd.path as a meaningful public event/recorder payload rather than churning a contract merely because the hub now reads cached state. Keep the small input/paste orchestration duplication at this gate: target/vote policy is shared, while their refusal/file cleanup lifecycles differ; do not introduce a new state carrier just for deduplication. Reconcile's duplicate vote emission can call the existing record_vote without changing policy. Tuple-return and lookup nits are not release blockers and do not justify another architectural cycle.

## Final freeze and verification

p250 fixed the client findings; web 392 and affected real 120 pass, with two Files path-field harness failures passing alone. Lead inspected exact failure: an extra HOME listing during supposedly uninterrupted synthetic typing; browser dispatch under load exceeded the 250 ms debounce. This is a test timing premise, not a product bug. Existing test now pauses Playwright's clock during keystrokes and advances 400 ms afterward, retaining per-key events and the exact one-listing assertion (not weakening it to allow extras). Temporary repeated runs passed 12/12 across both layouts and Chromium/WebKit; no new case retained.

p252 resource evidence is scoped: immutable pre-web-fixes release snapshot, Linux three-start idle RSS 6.29 MiB/PSS 5.09 MiB, near-zero interval CPU; 72 MiB/50% container-cgroup workload and 42 MiB refusal/recovery succeed with no runtime OOM. The cgroup includes daemon+tmux+driver, not a dedicated systemd service; idle RSS exceeds the approximate 5 MB target. No regression/bundle-equivalence claim. Evidence/session-follow-budget.md has measurement gaps.

Lead deleted dead fake SelectWindow parser/comment and replaced identical reconciliation vote emission with record_vote (no policy change). Final real Rust suites pass 4 hub_real + 18 tmux_real on each 3.4/3.7b after these cleanups. Production frozen for p253 (explicit --model opus final client review), p254 (remaining runtime edges/real Files), p255 (knowledge capture). Clean-export full preflight and final browser suites remain before local commit is ready; no push/release.

Final gate continuation: p254 returned after build without running its cases; this is not acceptance. Narrowed replacement p260 to real configured Files workflow and captured path insertion, with an execution goal and existing stack helper rather than the overbroad five-track brief. Existing p250 evidence still covers clipboard/reconnect/menu fixes; unexecuted independent cases remain gaps, not passes. p253 independently escalated a historical real-suite timeout to p259: crash report points to tmux control_notify_client_detached/control_write. Await raw-tmux root cause before classifying that timeout as a test flake. This is distinct from the known same-command-list crash in issue #2.

Lead reviewed p255 capture: settled ownership rules and superseded claim decision are consistent with current View code; reviewer preference is scoped correctly. Final MSRV all-target check and web check pass. Full browser suites remain running sequentially (ports5451/5452, /tmp/tether-final-{harness,browser-real}.log). No local commit yet.

Final browser gates completed on frozen production: harness **838 passed**, real **150 passed / 30 skipped** (WebKit gesture cases require Chromium CDP touch injection), no failures. Swift TetherKit **7 passed** rerun. p260 executed real Files root registration, completion/browse/Go/Back/Cancel, normal quoted path insertion, and insertion delayed across external window switch on tmux3.7b: correct captured old pane, new pane empty. Evidence was initially placed under checkout evidence/; lead moved report/screens to the work evidence directory and inspected screenshot. Private stack cleaned. Other independent p254 edges remain unexecuted; use p250 scoped reproductions, not fabricated duplicate acceptance.

p253 draft verdict approves client with nonblocking notes. L4 is already fixed by lead's clock-driven existing test and now full-suite green. L3 stale historical architecture excerpt corrected in place (workspace events, no expansion, watching labels). L1 rare late error after request timeout is accepted: retaining expired IDs solely to suppress a second notice adds state and lifecycle cost for a >30s delayed failure. L2 duplicate refusal callback is a straightforward deletion candidate after review drains; no need new architecture. High finding routes to tmux baseline issue, pending p259 raw reproduction. A green later suite does not erase the actual earlier server crash.

Probe infrastructure cleanup: p259's raw-tmux fuzz finished but its zsh load generator waited on 16 busy-loop children (scalar `$pids` does not split in zsh). Lead verified parent94239 and exact p259-fz-34i command, then SIGTERM'd only its children94242..94257; no shared service/tmux touched. This clears an orchestration hang, not a product failure. Note left in /tmp/p-detach-crash/lead-cleanup-note.txt.

All review/probe spawns drained. p253 approves client; p259 confirms ordinary-use upstream handshake crashes fixed in3.7, distinct from p244's destroyed-session bug still in3.7b. Added evidence and issue#2 comment; reject daemon-wide ordering/modes as an incomplete mitigation against external clients. Baseline/backport decision blocks daily-use sign-off, not local preservation of reviewed session-follow implementation. Installed binaries unchanged.

Final small source cleanup: removed TabDriver.onRefused callback; its sole caller fed the same app.notify sink as onNotice. Driver now supplies the identical `Not sent:` wording through onNotice. Lead checked all callsites; unrelated Host authentication onRefused remains. No new state or policy. L3 doc corrections and L4 deterministic existing test are fixed; L1 late duplicate notice explicitly accepted. Export/status-shape nits are not defects and no future refactor is promised.

Local implementation commit3372ba8 clean-export preflight caught a stale wildcard in the existing fake hub after the unused fake SelectWindow variant was removed: clippy -D warnings correctly reports an unreachable arm. Deleted that dead arm; the match is now exhaustive, so future enum variants require an explicit choice. No production behavior change. Re-running exact-commit export gate after amending.

Implementation committed locally as73c5102; exact clean-export full preflight PASS.
Final verification/dispositions/gaps recorded in evidence/session-follow-final-gate.md.
No push/release. Work remains open only for explicit deployment/device/resource gates;
do not repeat completed implementation or treat upstream baseline decision as resolved.
