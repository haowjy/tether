# Review slice 1 of the client redesign (commits da1373b, 450b454 on main)

Repo `/Users/jimmyyao/repos/tether`. Two local commits, not pushed: `da1373b` (Swift stores
the saved workspace as raw JSON; one web parser) and `450b454` (Files opens as tabs: one
tab model, routes `home | tab`, derived screen, desktop top row replacing the rail,
launch opens Home). Review the code as it stands at HEAD, not just the diff.

What it was meant to do: `.meridian/work/tether-mvp/redesign/plan.md` D1 (structural
decisions, made after structure review p320: `meridian spawn show p320`). Behaviour:
`docs/design/client/browser-behaviors.md` (Home, Terminal, Files, Persistence,
Keyboard ownership and navigation history). The writer's report, including where it
adjusted D1: `meridian spawn show p321`.

Check correctness, regressions and behaviour across desktop browser, phone browser/PWA
and the iOS app's web view. Risks I want checked, beside anything else you find:
- History: stamp-before-push, the stale-entry skip (`go(-n)` to Home), the writer's
  change that closing an overlay lands on its base entry after a tab switch, canonical
  path `onResolved` replacing entries; Back/forward sequences across two Files tabs and
  a terminal tab; reload with history entries from before it.
- `navigated` as the only writer of route and Files place; any path where the
  workspace place and `FileBrowser`'s shown place can disagree.
- Focus: terminal ↔ Files tab switches with no navigation must change focus mode
  (native `setFocus`, `activeTab` null) and cover/uncover terminal drivers; the watch
  must stop/resume correctly.
- `lastTerminal`: the writer seeds each host's first terminal tab after restore. Could
  an inserted path or an upload go into a session the user didn't mean? Would saving
  `lastTerminal` in v3 be the correct fix instead?
- Saved workspace parser at the trust boundary; v1/v2 discard; Swift's raw JSON key
  migration (`tether.workspace`, old keys removed at launch) losing nothing it must keep.
- `hostsKnown` pruning Files tabs on unknown hosts; listings never touching Files tabs.
- Drafts keyed by `TabKey` unaffected.

Edit nothing. Report findings ranked by severity, each with path:line, a concrete
failure scenario, and the fix you'd make.
