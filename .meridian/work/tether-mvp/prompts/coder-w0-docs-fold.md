# Fold the W0 web skeleton into the design docs

The W0 web lane landed b11c82b 8033239 aaa5163 948868f and review fixes 395ed9e..b5086ab
without touching docs/design/, so the specs no longer describe the code. Bring them in line.
Sources:
- .meridian/work/tether-mvp/w0-notes.md: 12 departures from the spec, mockup departures, and the exact plan.md
  "Code structure and standards" edit (replace the web/ tree with client-architecture.md §3.2,
  the Frontend bullet with §3.3's five rules, extend the Tests bullet).
- .meridian/work/tether-mvp/design/client-architecture.md rev 4 (now with the §6.1 navigate effect, committed in b5086ab).
- Structure review /Users/jimmyyao/.meridian/projects/steep-lamp-cloud/spawns/p70/report.md: its verdict table on the 12 departures (make 2, 4, 5, 6
  the spec; 1 is a temporary hand-off that stays out of the spec; 3 needs the browser floor
  logged), L8's unlisted departures (the hostsKnown workspace event; lanes subscribing to the
  platform directly for input/compose/draft events; platform/browser/boot.ts folded into
  index.ts), departure 6's reliance on the hub serialising one-shots (src/hub/requests.rs
  answers busy), and L1 (amend §6.5 so the synchronous-focus rule covers only focus that must
  raise the keyboard).
- Fix report /Users/jimmyyao/.meridian/projects/steep-lamp-cloud/spawns/p75/report.md for what the fixes changed.

Tech-lead decisions to log in docs/design/decisions.md (each with alternatives rejected):
1. light-dark() carries both themes; the browser floor rises to Safari/iOS 17.5, Chrome 123,
   Firefox 120. Rejected: two scheme blocks (keeps 16.4, but doubles the token file and needs
   care against flashes). Reason: the only target device runs current iOS. Update every
   browser-minimums statement in docs/design/ (search for 16.4).
2. Accent is blue, not the mockup's green: status and selection stay on separate channels.
   Also the other W0 mockup departures (selected rows blue-tinted fill; phone toasts above the
   bottom toolbar) and the §8.5 ones listed in w0-notes.md.
3. The pre-push hook runs the full preflight on each pushed branch tip only, not every commit
   in the range; the lead preflights each commit on a clean export before pushing. Rejected:
   every commit in the hook (a full release build per commit on every push). Update AGENTS.md
   "Coherent commits" to say this accurately.
4. Reduced motion shortens the duration tokens; no global transition override (it made scheme
   changes animate and the a11y gate flaky).
Update docs/design/client/browser-behaviors.md for every deliberate behaviour departure, and
plan.md. Specs state the current rule only; history goes in decisions.md. Match the existing
style of each file (read neighbouring entries first).

Edit only docs/design/**, AGENTS.md and CHANGELOG.md (only if something user-visible lacks a
bullet under [Unreleased]). Do not commit or stage; the lead commits. Other agents may be reading
the checkout; don't touch src/, web/, tests/, scripts/. Report what you changed per file and any
place where the code and the notes disagreed (cite the code).
