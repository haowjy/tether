# Probe: does opening a coded setup link actually enrol?

Repo `/Users/jimmyyao/repos/tether`, uncommitted working tree (the change is described
below). You are the runtime check for it. Build what you need, run it, report what you
saw. Do not commit or push.

**Hard constraint:** a deployed daemon is serving Jimmy's tailnet from this Mac as a
LaunchAgent (`com.jimmyyao.tether`, port 7851). Do not restart it, do not run
`tether setup`, and do not point anything at the live state directory
(`$XDG_STATE_HOME/tether`, `$XDG_CONFIG_HOME/tether`, `$TMPDIR/tether`). Use your own
scratch `XDG_STATE_HOME`, `XDG_CONFIG_HOME`, `XDG_RUNTIME_DIR`/`TMUX_TMPDIR`, your own
port and a `tmux -L` socket. Clean up everything you start.

## The change

Setup's link, QR and clipboard now carry the enrolment code in the URL fragment:
`https://<origin>/#code=<CODE>`. The web app reads that fragment once at startup, rewrites
the URL to `#/`, prefills the enrolment code field, and submits once. The code field also
changed from `inputMode="numeric"` to a text field with `autocapitalize="characters"`.
Relevant files: `src/setup/report.rs`, `src/main.rs`, `web/app/controller.ts`,
`web/app/router.ts`, `web/screens/enrol/Enrol.tsx`.

## What I need evidence for

1. **The link that setup prints.** Run the built binary's real report path against a
   scratch state dir (or the closest reachable equivalent) and show the actual output:
   one link, with `#code=`, in the QR and on the link line. Show that the QR is built from
   the coded link, not the bare origin.
2. **Opening that link enrols.** Against a scratch daemon, open the coded link in a real
   browser (the repo has Playwright in `web/node_modules`; Chromium and WebKit are
   installed) with a viewport and user agent you state. Capture: the field being
   prefilled, exactly one `POST /auth/node/enroll`, the destination the page lands on, and
   the URL after startup (the fragment must be gone). Screenshot it.
3. **Reload and Back.** Reload after enrolment, and Back: no second enrol request, and the
   code is not replayed.
4. **A wrong code.** A coded link with a bad code reaches the "wrong or has expired" error
   and does not enrol.
5. **The keyboard attribute.** From the rendered DOM, what `inputmode` and
   `autocapitalize` does the code field now carry? State plainly whether that is the thing
   that fixes a digits-only keyboard on iOS, and what remains unverified without a device.

Save the evidence (text plus screenshots) under
`.meridian/work/tether-mvp/evidence/enrol-link/`. Report: what you built and ran, the
exact commands, what each check showed, anything surprising, and what you could not
verify. Name anything you created with your spawn id and remove it when done.
