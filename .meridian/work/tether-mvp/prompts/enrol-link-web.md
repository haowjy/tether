# The enrolment code field on mobile, and the code arriving in the link (web)

Repo: `/Users/jimmyyao/repos/tether`. Web app in `web/` (Preact + Vite, pnpm). Work in the
primary checkout. **Do not commit, do not push, do not run any git write command.** Two other
agents are editing `src/` and `ios/` at the same time: touch only `web/`.

## Two reports from Jimmy, using tether on his iPhone today

1. "on mobile, the 'code' can only be numbers, but the actual code is letters plus numbers" —
   `web/screens/enrol/Enrol.tsx:44` passes `inputMode="numeric"` to `TextField`, so iOS gives
   a digits-only keyboard and a code like `1D8K-4WX6` cannot be typed.
2. "u should include the code in the link" — the setup link will now carry the code, and the
   web app must use it instead of making the reader type.

## Settled decisions (do not redesign)

- The link is `<origin>/#code=<CODE>`, e.g.
  `https://jimmys-macbook-air.tail852a76.ts.net/#code=7KQ4-XM2P`. Fragment, not query: it
  never reaches the daemon. The Rust side is being changed in parallel to print and
  QR-encode that link; you do not need it to exist to build this.
- Read the code **once at startup**: if `location.hash` is `#code=<code>`, keep the code,
  rewrite the URL to the normal entry hash (`#/`) with a replace (not a push) so a reload or
  a back gesture cannot replay it, and hand the code to the enrolment screen.
- The Enrol screen prefills the field and submits **once** by itself, with the device name it
  already defaults to. No extra confirm step: the whole point is that scanning lands you
  enrolled. A wrong or expired code must land on the existing "That code is wrong or has
  expired" error, not a new one. A device that is already enrolled never reaches this screen,
  and the code is simply dropped.
- The code field: text keyboard, letters reachable, and `autocapitalize="characters"` so the
  shift key starts on (codes are uppercase). `TextField` currently sets
  `autocapitalize="off"` unconditionally; make it an opt-in prop and use it from the code
  field only. The server already normalises case, dashes and `O`/`I`/`L` lookalikes, so do
  not add client-side validation beyond what exists.

## Where to look

- `web/screens/enrol/Enrol.tsx`, `web/ui/primitives/TextField.tsx`.
- `web/app/controller.ts` (`AppController.start` runs before render — a natural place to read
  the fragment), `web/main.tsx`, `web/app/router.ts` (hash routes `#/`, `#/files`,
  `#/terminal`; the router replaces the hash on construction, so the code has to be taken
  before or independently of it).
- `web/e2e/shared/admission.spec.ts` and `web/e2e/shared/routes.spec.ts` cover this screen;
  `web/e2e/shared/stack.ts` shows how a spec starts a real daemon. Update the existing cases
  the change falsifies. **Add no new permanent test** (Jimmy's standing instruction): if you
  write a scratch case to prove the fragment path, run it and delete it.

## Constraints

- A deployed daemon is running on this Mac (LaunchAgent, real tailnet) and Jimmy is using it
  from his phone. Do not restart it, do not run `tether setup` or `tether enroll`, and do not
  point anything at the live state directory. Harness specs that start their own scratch
  daemon are fine.
- pnpm only, never npm. Follow existing patterns and the repo's `web/AGENTS.md` and
  `web/.context` notes.
- No new dependencies.

## Done means

- `pnpm --dir web run check` (the repo's type/lint/unit/build gate) passes.
- You ran the fragment path against a scratch daemon or a routed fake, and can say what
  happens on: a valid code, a wrong code, a reload after the replace, and an already-enrolled
  device.
- Report back: files changed, what the URL rewrite does on a reload and on back, what you
  rejected, and anything the decision above missed.
