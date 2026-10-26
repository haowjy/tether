# Review: the enrolment code now travels in the setup link

Repo `/Users/jimmyyao/repos/tether`, uncommitted working tree on top of `f2ad25e` (local
main, pushed). Review the code as it stands. **Edit nothing; commit nothing.** Do not
restart the deployed LaunchAgent (`com.jimmyyao.tether`) or run `tether setup` /
`tether enroll` against the live state — a daemon is serving Jimmy's tailnet and he is
using it from his phone.

## What changed and why

Jimmy, on his iPhone: the enrolment code field only offered numbers although codes are
letters plus digits, and "u should include the code in the link". So:

- `src/setup/report.rs`: the printed link, the QR and the OSC 52 clipboard now carry
  `<origin>/#code=<CODE>`.
- `src/main.rs`: `tether enroll` prints a bare `Host:` (MagicDNS name) and a coded
  `Browser:` link. It also lost the `(label)` suffix and the `config` parameter.
- `web/app/router.ts` + `web/app/controller.ts`: the code is read once from the fragment
  before the router replaces the hash, kept on the controller, and taken once.
- `web/screens/enrol/Enrol.tsx`: the field is a text field with
  `autocapitalize="characters"` instead of `inputMode="numeric"`, prefilled from the
  link, and it submits itself once when a link supplied the code.
- `web/ui/primitives/TextField.tsx`: an opt-in `autocapitalize` prop.
- `ios/Tether/Hosts/HostViews.swift`: *Add server* accepts a pasted setup link and fills
  the host and code from it.
- Docs and `CHANGELOG.md`: `docs/design/setup.md`, `decisions.md` (new entry, and the
  earlier "A code in the QR" rejection marked superseded), `running.md`, `ios-shell.md`.

The decision record is `.meridian/work/tether-mvp/enrol-link-and-keyboard.md`; read it
before judging the design.

## Risks I want checked

- **The one-shot code's lifetime on the client.** Is the code ever consumed twice, or
  left somewhere it can be replayed (a re-render, a second host, a StrictMode double
  render, a back navigation)? Does an already-enrolled device really never use it?
- **Auto-submit.** It runs in an effect on mount with the default device name. Is there a
  state where it submits with a stale or empty code, fires twice, or races the admission
  fetch that decided to show the screen?
- **The URL rewrite.** The router replaces the hash on construction. Does reading in the
  controller actually precede that in every entry point (browser, native shell, harness
  fake history, unit tests)? Is the code lost if an admission failure re-mounts the
  screen?
- **The iOS parse.** `AddHostView.link` and `target` split a pasted link. Check off-by-one
  behaviour on `https://host/#code=CODE`, a bare host, a host with a path, a link with no
  code, and a code containing `-`. Is the Add button's disabled state right for a pasted
  link with an empty code field?
- **The Rust change.** One link on screen and in the QR; no daemon-side parsing of the
  fragment; `Host:` still usable by the app; anything the `tether enroll` refactor broke
  (it dropped `config` and the `(label)` suffix — was either load-bearing?).
- **Regression risk for enrolled users.** Nothing here should change the enrolled path.

Report findings by severity with file:line, and say what you checked by reading versus by
running. If a finding is a matter of taste rather than a defect, say so.
