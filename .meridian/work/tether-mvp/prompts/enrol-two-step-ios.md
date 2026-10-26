# iOS: the segmented enrolment code, the device name on its own step, and a link that enrols itself

Repo `/Users/jimmyyao/repos/tether`, `ios/`. **Do not commit, do not push.** Another agent
edits `web/` at the same time: touch only `ios/`.

Two asks from Jimmy, both about *Add server* (`ios/Tether/Hosts/HostViews.swift`):

1. The enrolment code should look like a standard code field — `▢▢▢▢ – ▢▢▢▢`, dash drawn,
   never typed — and the device name belongs on the next screen, not beside the code.
2. Tapping "Open in the tether app" does open the app, but he expected it to finish the
   job: the link should enrol and put him in, not land him on a form.

## The link path (do this first — it is the one Jimmy actually uses)

`tether://add?host=<origin>` arrives through `onOpenURL`. Today it only fills the form.

- Validate the host as today (`AuthClient.serverURL`).
- Enrol without asking: the phone's node is already enrolled by the browser, so post
  `POST /auth/node/enroll` with an empty code and the device's own name
  (`UIDevice.current.name`), exactly the mint that exists now, and save the host with the
  returned token.
- Then show the terminal for that host (whatever the app does today after a successful
  add), and do not leave the Add sheet on screen.
- Say what is happening while it runs (a small progress state is enough); this replaces a
  whole screen, so a silent pause is not acceptable.
- **If it cannot enrol**, do not fail silently:
  - `401 not_enrolled` (the browser has not enrolled this phone yet): open *Add server* at
    step 1, host filled, with a line saying this phone is not enrolled yet and to run
    `tether enroll` on the server for a code.
  - any other failure: open *Add server* at step 1 with the host filled and the error
    shown where errors already show.
- If the app is locked (Face ID), the mint waits for the unlock rather than throwing:
  a link opened while the lock screen is up should complete once the app is unlocked, or
  say plainly that it could not.

## The manual path

- **Step 1:** Server (MagicDNS name or setup link, unchanged) and Code — eight cells in two
  groups of four with the separator drawn. Codes are uppercase letters and digits
  (`7KQ4-XM2P`); the daemon normalises case, dashes and `O`/`I`/`L`, so accept what is
  typed. Typing advances, Backspace on an empty cell clears the previous one, a tap puts
  the caret where it should be, pasting a whole code (`7KQ4-XM2P`, `7KQ4XM2P`, lowercase)
  fills every cell. No autocorrect, no predictions. **The code stays optional**: empty is
  the "already enrolled" mint path, and it must stay obvious how to use it.
- **Step 2:** the device name, prefilled with `UIDevice.current.name`, and **Add** — the
  enrol/mint the form does today, errors in place. Back returns to step 1 with both fields
  intact, including after a failure.

## Constraints

- The mint is the same request the review accepted: `Origin` only, no `Sec-Fetch-*`.
- `ios/AGENTS.md` and `docs/design/ios-shell.md` ("Hosts") describe the screen; update
  them if the flow's description no longer holds.
- `ios/scripts/check.sh` must pass. **Do not install on the phone**; do not touch the
  LaunchAgent, `tether setup`, `tether enroll`, `web/` or `src/`.
- No new permanent tests (Jimmy's standing instruction).

## Report

What a link does end to end and what happens on each failure and while locked; how the
code field is built (eight fields or one with a drawn overlay, and why); what paste and
Backspace do; how step 2 behaves on a refusal; the `check.sh` result; and what still needs
the phone to confirm.
