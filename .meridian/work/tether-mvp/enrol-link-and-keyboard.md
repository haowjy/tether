# Code in the enrolment link, and the mobile code field

Reported by Jimmy while walking the device checklist, 2026-10-26:

1. "on mobile, the 'code' can only be numbers, but the actual code is letters plus numbers"
2. "u should include the code in the link"

## What is actually wrong

- `web/screens/enrol/Enrol.tsx:44` renders the code field with `inputMode="numeric"`, so iOS
  shows a digits-only keyboard and a code like `1D8K-4WX6` cannot be typed. The field is
  the only one in the app with that mode. `TextField` already sets `autocapitalize="off"`,
  `autocomplete="off"` and `spellcheck={false}`.
- The setup link and QR encode the origin alone (`src/setup/report.rs`), so enrolling always
  means transcribing eight characters by hand. `docs/design/setup.md` listed "A code in the
  QR" under *Not in setup*; Jimmy has now asked for it, so that entry is superseded.

Server-side facts that make this cheap: `token::normalize_code` strips `-` and whitespace,
uppercases, and maps `O`→`0`, `I`/`L`→`1`, and it is applied both when the code is issued and
when it is presented (`src/auth/store.rs:216`, `:329`). So the code is already insensitive to
case, dashes and those lookalikes; only the keyboard was wrong, not the matching.

## Decision

**Link format: `<origin>/#code=<CODE>`, code as printed (`7KQ4-XM2P`).**

- The **fragment**, not a query string: it never reaches the daemon (no request line, no
  access log) and is not sent as `Referer` to anything the page loads. It does land in the
  phone's browser history, which is the cost of the feature, accepted by Jimmy. The earlier
  rejection reasoned from that history cost alone; the value of not transcribing a code on a
  phone keyboard outweighs it.
- **Both** the printed link line and the QR carry the code, so the QR is enrol-on-scan.
- `tether enroll` keeps its plain `Host:` line (that is what the iOS *Add server* field
  wants) and puts the code in its `Browser:` link.
- The web app reads the code **once at startup**, immediately rewrites the URL to `#/`, then
  the Enrol screen prefills the field and submits once. A replayed or expired code lands on
  the existing "That code is wrong or has expired" path; an already-enrolled device never
  shows the screen and the code is simply dropped.
- The iOS app has no deep-link handling and is not getting any for this. Instead *Add server*
  accepts a pasted link: if the text contains `#code=`, the host and code fields fill from it.
  Typing a bare MagicDNS name still works unchanged.

Keyboard fix: the code field becomes a text field with autocapitalisation of characters
(`autocapitalize="characters"`), so the letters are reachable and the keyboard starts shifted.
`TextField` gains that as an opt-in; the code field is its only user.

## Lanes

- Rust + docs: report/enroll link, `setup.md`, `decisions.md`, `running.md`, `CHANGELOG.md`,
  existing tests that pin the report text.
- Web: code field keyboard, code from the fragment, prefill + one submit, existing harness
  cases that assert the enrol screen.
- iOS: *Add server* parses a pasted link.

No new permanent tests (Jimmy's standing instruction); update the existing cases the change
falsifies, and verify the new behaviour by running it.

## Verification plan

- Rust tests, plus the real report from `tether setup --background` and `tether enroll`.
- Web unit/build checks, plus a real-daemon browser run that opens `/#code=…` and lands
  enrolled with the code field never touched.
- `ios/scripts/check.sh` for Swift; the device build is re-installed and the link pasted into
  *Add server* on the phone.
- Rebuild the daemon (web assets are embedded) and the app bundle, then reinstall both.
