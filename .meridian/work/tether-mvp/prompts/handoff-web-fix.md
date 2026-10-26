# Web fixes: the app offer's fallback, its platform, and less machinery

Repo `/Users/jimmyyao/repos/tether`, `web/`. **Do not commit, do not push.** Two other
agents edit `src/` and `ios/` at the same time: touch only `web/`.

The review is `.meridian/projects/steep-lamp-cloud/spawns/p270/report.md` (findings 4, 5,
8). You wrote the feature being fixed; the code is in your working tree already.

## 4. The fallback instruction does not work

The banner tells the reader to "copy this link into Add server" and shows
`tether://add?host=…`. The app's Server field requires an `https` URL and only
understands setup links with `#code=`, so that paste fails with "Enter a valid HTTPS
server address".

The app now accepts an **empty code** and mints its credential from the phone's node
enrolment, so the honest fallback is the plain origin: show the `https://…` origin and say
to add it in the app with the code left empty. Keep it short enough for the banner, and
keep the `tether:` URL out of the visible text (the Open action still uses it).

## 5. The offer only makes sense where the app can exist

On a laptop, "Open" goes to a `tether:` URL nothing handles: Safari errors, Chrome does
nothing. Gate the offer on the platform the app runs on — iPhone and iPad, including
iPadOS reporting a Macintosh user agent with touch points. Put that judgement in
`platform/browser/` behind one named capability (a function or a field on the platform),
not in the controller and not in a component; `web/AGENTS.md` keeps environment names
inside `platform/`. Say in the report what it returns on which platforms and what it
cannot know.

## 8. Less machinery for the dismissal

The persisted `appOffered` set (a `SavedWorkspace` field, `Persist.restoreOffered` /
`markOffered`, a type change shared with the native bridge) is more than the offer needs:
it only appears right after an enrolment, and a reload does not bring it back. Keep the
dismissal in memory on the controller, and delete the `SavedWorkspace` field and the
persistence methods. If you keep any storage, justify it against that.

## Constraints

- pnpm only, never npm.
- No new permanent tests (Jimmy's standing instruction); existing harness cases that the
  change falsifies must be updated.
- Do not touch `src/`, `ios/`, the LaunchAgent, or the live tether state.
- `pnpm --dir web run check` must pass.

## Report

The banner's final text, what the platform capability returns and why, what you deleted,
and anything the review got wrong.
