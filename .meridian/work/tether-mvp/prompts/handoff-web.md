# Web: offer "Open in the tether app" after the browser enrols

Repo `/Users/jimmyyao/repos/tether`, web app in `web/` (Preact + Vite, pnpm). Work in the
primary checkout. **Do not commit, do not push.** Another agent is editing `ios/` at the
same time: touch only `web/`.

Read `.meridian/work/tether-mvp/app-handoff.md` first.

## Why

The setup link enrols the phone's **node** when the browser enrols. The tether app on the
same phone is admitted by that node identity, so it needs the host name and no code. Jimmy
wants the browser to hand the host over once it is enrolled, instead of him copying
anything.

## What to build

After a successful enrolment (the Enrol screen's submit succeeds and the app moves on to
Home), show a one-time notice that offers **"Open in the tether app"**, whose action
navigates to:

`tether://add?host=<percent-encoded origin>`

- `origin` is `location.origin`. Percent-encode it.
- The notice must not block the enrolled flow: the user lands on Home either way, the
  notice is dismissible, and it never reappears for that host once dismissed (a
  `localStorage` flag per host id is enough; follow whatever the app already uses for
  notices and storage).
- **Never show it inside the app's own web view.** `hasNativeBridge()` says when the web
  is inside the native shell; there the notice is noise.
- If the platform cannot open custom schemes, the notice must still leave the same URL
  where it can be copied (today's paste path into Add server) — say how in the report.

Use the app's existing notice/toast mechanism rather than a new one, and the existing
storage wrapper rather than raw `localStorage`.

## Constraints

- pnpm only, never npm.
- **No new permanent tests** (Jimmy's standing instruction): if you write a scratch case
  to check the notice, run it and delete it. Existing harness cases that the change
  falsifies must be updated.
- Do not touch `src/`, `ios/`, the deployed LaunchAgent or the live tether state.
- The enrolment screen already has an auto-submit path from the link's `#code=`; the
  notice must work for both that path and a hand-typed code.

## Report

Where the notice lives, its exact text and action, how dismissal is remembered, what
happens in the native shell and on a browser that cannot open the scheme, the
`pnpm --dir web run check` result, and anything you had to decide that the note above did
not cover.
