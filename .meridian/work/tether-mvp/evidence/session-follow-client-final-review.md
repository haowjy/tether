# Session-follow client final review (round 2, Opus)

Reviewed: dirty `main` on base 3821927 (design 18ae3f2), production source frozen after p250.
The whole web/iOS session-follow surface as it stands (p245 integration plus p250 fixes), not
only the last delta. I read the source before p248, p250 and resume-plan. No source edited, no
suites run. I checked the real-suite flake against the macOS crash reports. Two Opus helpers ran
read-only: p258 (web research on the tmux crash) and p259 (investigator, private `-L` tmux
servers only).

**Verdict on the client: approve with notes.** The client has no blocking defect. The p250 fixes
are correct where they sit, and they removed state rather than adding it. **Outside the client:
one high finding.** The "former real terminal timeout" the gates treated as a flake was a tmux
3.4 server crash (SIGSEGV), not a timeout. That needs the lead's routing before daily use on tmux
< 3.7.

## High: the real-suite "timeout" was a tmux 3.4 server crash (not client code)

| | |
|---|---|
| Where | tmux ≤ 3.6b server, reached by the daemon's normal control-client traffic (`src/hub/owners.rs` attach/linger/detach, takes and selects in `src/tmux/command.rs`) |
| Evidence | `/tmp/e2e-real-final.log:191-213`: `[webkit] terminal.real.ts:202 tmux 3.4 reconnects after a socket kill` failed in `openTerminal` (tab stuck "connecting"); then `no server running on …/webkit-3.4` from afterAll's `kill-server`. The four remaining 3.4 webkit tests did not run. `~/Library/Logs/DiagnosticReports/tmux-2026-10-25-163029.ips`: tmux launched 16:30:08 by that stack and died 16:30:29 (the log's time), `EXC_BAD_ACCESS SIGSEGV at 0x20`, stack `control_write+36 ← control_notify_client_detached+88 ← notify_callback ← cmdq_next ← server_loop`. Binary UUID `e741492a…` is the same 3.4 build as p244's deliberate 3.4 crashes. The 3.7b ones are `ed14b864…`. This is the only crash report outside p244's probe window. |
| Verdict | CONFIRMED: crash report plus a deterministic and a natural-race repro on the same binary (p259). |
| Cause (p258, upstream) | tmux PR #4980, commit e5a2a25f, first released in **3.7**: `CONTROL_SHOULD_NOTIFY_CLIENT` lets through a control client that has sent `MSG_IDENTIFY_FLAGS` but not yet `MSG_IDENTIFY_DONE`, so its `control_state` is NULL. Any notification queued in that gap crashes the whole server; `all_blocks` sits at offset 0x20. Here the notification was `client-detached`, from a lingering control client being ended while another `tmux -C attach` was starting. That matches the test sequence: the previous test closed a second browser context (its client lingers, then detaches), and this test attached a new client for `s10`. Takes (`switch-client`), selects, `new-window` and session changes go through the same path. Notes: `research/tmux-3.4-control-write-null-crash.md`. |
| Consequence | Every tmux session on the server dies: Jimmy's work, not only tether's tabs. This breaks "tmux's life never depends on tether's". It comes from ordinary use: opening a tab while another tab's client lingers out, or a take while another owner attaches. tether runs one control client per watched session, so attaches are frequent. |
| Relation | Same class as p244 / `session-follow-tmux-risk.md` (NULL `control_state` / `%session-window-changed`) and GitHub issue #2. This is a second, *ordinary-use* trigger: issue #2's reproducer needed select + kill in one command list. Session-follow adds takes and selects that notify, which widens the exposure. |
| Not | A client timing problem. Raising the test timeout would hide a dead server. |
| Fix direction | (1) Settle issue #2 with this evidence: require tmux ≥ 3.7 (3.8 also fixes #5570, a `control_write` crash after `run-shell`), or detect < 3.7 and warn loudly. (2) A daemon mitigation that narrows the gap but cannot close it: issue nothing that notifies (take, select, new-window, ending a lingering client) between spawning a control client and its first `%begin/%end`, and never kill a client that has not started (#5004, the 3.4 `control_stop` crash). Jimmy's own tmux use can still trigger it, so (1) is the real fix. Daemon lane was approved at p251: this needs the lead's decision, not another claim-model cycle. |

**p259 reproduction (Opus investigator, private `-L p259-*` servers only, all cleaned up;
scripts and `FINDINGS.md` in `/tmp/p-detach-crash/`):**

- **Deterministic repro.** A socket client sends only `MSG_IDENTIFY_FLAGS(CLIENT_CONTROL)`, then
  attached control client A ends.
  - On 3.4 the server dies whether A ends by `detach-client` or by closing stdin, which is how
    tether ends a client. The stack is identical to the e2e crash.
  - 3.7b survives both.
  - On 3.4, `new-session`, `select-window`, `set-buffer`, `copy-mode` and `new-window` also kill
    the server while a half-identified client is present. `display -p`, which sends no
    notification, does not.
- **Natural race, real `tmux -C attach` clients.**
  - 3.4: up to 59 crashes in 300 runs when A ends 2.5-7 ms after B launches with a large
    environment, and 2 in 300 with the default environment. The window widens with the size of
    the environment the clients inherit; `src/tmux/mod.rs:113-131` passes the daemon's whole
    environment.
  - 3.7b: 0 in 300.
- **How the e2e case reaches it.** The 58 MiB tier allows one session, so `spawn_client` calls
  `make_room()` (`src/hub/owners.rs:284-299`). That closes the previous test's lingering client and
  spawns the new one in the same hub step. It is the tether path the crash needs. The exact e2e
  timing is unconfirmed because no daemon log survived.
- **Other ordinary paths on tmux < 3.7.**
  - A linger expiring (`time.rs`, `close_client`) while any attach is in progress.
  - Selects, pastes, `copy-mode -q`, `new-session` or `new-window` on one client while another
    attaches.
  - Anything Jimmy does in his own tmux during a phone attach.
  - A second crash (`control_stop` at 0x38, fixed by 31c93c48 in 3.7): tether's client process
    dying before it finishes identifying (`kill_on_drop`, a daemon restart mid-spawn) kills the
    3.4 server. In that case tmux's life directly depends on tether's.
- **Daemon mitigations, which narrow the window but cannot close it.**
  - Hold back notifying commands, including ending other clients, until the new client's first
    stdout byte.
  - In `make_room`, wait for the closed client's `Exited` before spawning.
  - Spawn control clients with a minimal environment.

## Client findings (all low, none blocking)

| # | Where | Issue and consequence | Check | Fix direction |
|---|---|---|---|---|
| L1 | `web/net/host.ts:337-361` | An `error` that answers a `request()` which already timed out (30 s `REPLY_TIMEOUT_MS`) now falls through to the watch route, because `history` and `newWindow` name a watch. The user sees the timeout ("Couldn't reach…" in the dialog, or a failed history fetch), then a later "Not sent: <tmux message>" toast. That is one refusal reported twice, but only when tmux answers after 30 s. | Trace: `expireIn` deletes the pending entry (`host.ts:~158`); `onMessage` then takes the `msg.type === "error"` fall-through to `case "error"` and `watchRoutes.get(watch)?.message`. Not run. | Accept as a rare residual, or keep the expired request ids. Don't reintroduce a per-select map for this. |
| L2 | `web/tabs/driver.ts:45`, `terminals.ts:291` | `onRefused` is a second optional callback into the same sink as `onNotice` (both become `app.notify`). Since the selects map is gone, the driver can't tell an input refusal from a window-switch refusal, so the "Not sent:" prefix also lands on a failed switch ("Not sent: can't find window"). | Read both callbacks. Only `Terminals.open` supplies them. | Delete `onRefused`. The driver calls `onNotice` with its wording (one sink, one fewer option). Optionally word it neutrally ("tmux refused: …"). |
| L3 | `.meridian/work/tether-mvp/design/client-architecture.md:848, 881, 956` | The banner says §6.1, the labels and the saved workspace were "corrected in place". But §6.1's event list still names `windowClosed` and `renamed`, the `SavedWorkspace` block (which already says `version: 2`) still has `expanded`, and line 956 still says the fetcher "forwards `windowRenamed`". A cold reader gets a v2 shape that the code doesn't have. | `grep -n "expanded\|windowClosed\|windowRenamed" design/client-architecture.md` | Edit those three lines (`sessionClosed`, no `renamed`, no `expanded`), or narrow the banner's claim. |
| L4 | `web/e2e/files/pathfield.spec.ts:134-140` (committed in 3821927, not this change) | "Straight through costs one listing" asserts an exact listing list while typing in real time against `SETTLE_MS = 250` (`files/folders.ts:9`). Under load, WebKit's gap between keystrokes can pass 250 ms, so a listing for an intermediate folder is correct behaviour and the test fails. That fits p250's "passes alone, fails under load". The production code is right, so a longer timeout is the wrong fix. | Read the spec and `folders.ts`. Not rerun. | Drive the settle with `page.clock` (install, type, `runFor(SETTLE_MS)`), or assert "≤ 1 listing per folder paused in". Do this when Files is next touched; it doesn't block this change. |

Nits, which I'd take or leave: `WindowList`/`WindowsState` are exported with no importer now that
the temporary fixture is gone. That is fine as the seam for the AGENTS.md fixture rule Jimmy
waived. `TabStatus.shown` holds a whole `ShownWindow` where only `.id` is read
(`WindowChoices.tsx:90`).

## The asked-about fixes, judged in the system

| Fix | Holds? | Why |
|---|---|---|
| Selects map deleted, async errors routed by watch | Yes | `host.ts`: pending, then pastes, then a late non-error is dropped, then `error` goes by `watch` to its owner. Every daemon refusal of `selectWindow`/`input` carries `watch` (`requests.rs:331,352,454,502`; `state.rs:653,674-676`). A paste refusal is caught by `pastes` first, and a `newWindow`/`history` refusal by its pending request, so each is delivered once (L1 is the only exception). Routes are cleared on `unwatch`/`watchEnded`/link loss, so a refusal for an ended watch is dropped and never reaches another tab. No unbounded state is left. |
| Immutable clipboard target | Yes | `Pastes.target()` captures `{id, window}` at the tap, before `clipboard.read`. Text, image and native `uploading` all take that target; `paste()` never re-reads the shown tab. A closed target says "that tab is closed". `window: null` (no `watching` yet) correctly falls back to the first window the tab shows, as browser-behaviors.md:230 says. Files Insert captures the window at the Insert tap (default argument), which matches "captured on click". |
| Keys and the line field target the window shown when typed | Yes | The batch flushes when `windowId` changes inside it. An explicit `null` window disables the default parameter, so keys typed before any `watching` are dropped, not redirected. The line field and native input use the window shown at send. |
| Reconnect decided by raw sizes | Yes | `claim = claimNext ‖ holdsWindow()`. `claimNext` is set only by user acts (construct, `uncover`, `paused`) and cleared by `watching`. `holdsWindow` compares `shown.size` with `sentSize`, so no mirrored flag exists. A pure network reconnect (linkLost/linkUp, daemon restart, backoff retry) claims only while the last `watching` matched the size the tab sent. Explicit reopening, a tab switch, returning from Home/Files/a native screen and foregrounding all claim. Known, accepted gaps: a resize sent but not yet echoed reads "not held", so it skips the claim and the next keystroke claims. A laptop take whose `watching` is lost with the socket reads "held". Both are narrower than one RTT. |
| Band timing is display only | Yes | `checkBand` reads the same two facts. The timer stops on reconnecting/limited/closed, so a stale wait can't raise the band, and nothing reads `sizedForOther` except `onSizedForOther` → `TabStatus`. The old 1 s timer map in `terminals.ts` is gone, so the wait has one owner. |
| Bounded, scrollable window menu | Yes | `max-height` is set from `top` on open; `overflow-y: auto`; resize and outside press close the menu, so the position can't go stale. Remounting with the active pill hides the popover in the effect cleanup. |
| `returnFocusTo` owned by Dialog | Yes | The ref and parent effect are gone. The flag is set before the await because `createAndOpen` closes every overlay before returning, and it is reset on open, so a later New session dialog can't inherit it. Escape during creation sends desktop focus to the terminal; that is harmless (p250 noted it). |

## Contracts and storage

- **Swift protocol 2 / bridge 3:** `DaemonProtocol.version = 2`, `BridgeContract.version = 3`,
  `SessionRef { server: String, session: Int }`, `TabKey { host, session }`. Web
  `BRIDGE_VERSION = 3` and refuses another version at boot. Nothing else in `ios/` names `WindowRef`
  or `.window` on a key.
- **Fixture parity:** all nine fixtures that carry a key use `"server": "main:42-7", "session": 2`,
  with `active: "host-01/main:42-7/$2"`, which is the web's `tabId` (`$` sigil). `bridge.test.ts`
  decodes the same directory Swift does.
- **v1 removal:** the browser clears only the `workspace` and `drafts` object stores, on reading
  a version-1 workspace. Native removes `tether.workspace.v1` and `tether.drafts.v1` and writes v2
  keys. `expanded` is gone from both `SavedWorkspace` types and the encoders.
- **Credentials:** host entries, Keychain tokens and browser auth are untouched. The CHANGELOG
  bullet says so. `ios-shell.md` and the CHANGELOG state the protocol/bridge lockstep.
- **Leftovers:** a grep of `web/` for `windowClosed|windowRenamed|onLarger|paneLarger|openWindow|
  Disclosure|sessionKey|findWindow` finds nothing. `WindowRef` remains only in the generated
  `created` type, which the protocol still carries. `proto/window.ts` and `Disclosure` were deleted.

## Bounded work (hot paths)

Each `watching` (window change, rename, size, cwd) costs one driver step, one `TabStatus`
patch and a no-op workspace step when the name is unchanged, with no save. Each claiming send
costs one `setTimeout` reset. Opening the menu or sheet fetches one listing. None of this grows
with history or with the number of windows beyond the rows drawn.

## Look past this round

- p248 L1–L7 are all closed or deliberately waived (L6 fixtures, Jimmy's instruction). No earlier
  finding recurs, and no client finding here points at a patching loop.
- The tmux crash is the second instance of one class, after p244: notifications reaching a
  half-built control client on tmux < 3.7. The move that ends the class is a tmux baseline
  decision (issue #2), not more daemon ordering. The ordering only narrows the window.

## Hypotheses (not checked)

- L1 not run: it needs a tmux reply later than 30 s.
- The iOS paste prompt holding the clipboard read was not exercised on a device; the capture is
  correct by construction.
- I didn't rerun the pathfield flake under load. L4's mechanism comes from reading the code.
