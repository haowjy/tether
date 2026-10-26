# Web: a segmented enrolment code, then the device name on its own step

Repo `/Users/jimmyyao/repos/tether`, `web/`. **Do not commit, do not push.** Another agent
edits `ios/` at the same time: touch only `web/`.

Jimmy, on his phone: the enrolment code should look like a standard code field —
`▢▢▢▢ – ▢▢▢▢` — with the dash drawn, not typed. The device name should be asked on the
next screen, not on the code screen.

## The code field

- Eight cells in two groups of four with a separator between them. The separator is
  **visual only**: the value is eight characters, `-` is never part of it, and nobody
  types it.
- Codes are eight characters from the server's alphabet (`7KQ4-XM2P`, `0691-NHAB`), which
  uppercase letters and digits, no lookalikes. `token::normalize_code` on the daemon
  strips `-`/whitespace, uppercases and maps `O`→`0`, `I`/`L`→`1`, so a lowercase or
  dashed entry must be accepted by the field.
- Typing a character fills the next cell and moves on; Backspace on an empty cell clears
  the previous one and moves back; the arrow keys and a tap put the caret where it should
  be. Pasting the whole code — `7KQ4-XM2P`, `7KQ4XM2P`, lowercase, or with spaces — fills
  every cell. Autocapitalisation on for letters, no autocorrect, no predictions (the same
  rules the line field now follows).
- One accessible field: a labelled group with the eight cells, so a screen reader and
  keyboard users meet it as "Code", not eight unnamed boxes. Follow the app's existing
  input primitives and the focus controller; `ui/primitives/` is where a new one belongs,
  and lint rule 1 in `web/AGENTS.md` says screens do not hold raw `<input>`s.
- The auto-submit path from a setup link (`#code=…`) fills the cells and enrols as it does
  today, without the two screens: there is nothing to type.

## Two steps

- **Step 1:** the code. "Next" is enabled only with eight characters.
- **Step 2:** the device name, prefilled with the node name the screen already defaults
  to, then "Enrol this device". Back returns to step 1 with the code still filled.
- The enrolment request still carries both, as it does now; only the layout changes.
- Keep the explanatory text and the enrol errors exactly where they are useful: a wrong
  code still says "That code is wrong or has expired" (on step 2, where the request runs),
  and step 2 keeps the code so a retry needs no retyping.

## Constraints

- pnpm only, never npm. `pnpm --dir web run check` must pass.
- Existing harness cases for the enrol screen will need updating (`e2e/shared/
  admission.spec.ts`, `routes.spec.ts`, the `enrol` fixture): update them, add none.
- Do not touch `src/`, `ios/`, the LaunchAgent or the live tether state.

## Report

How the field is built (one input or eight, and why), what paste/backspace/paste-of-a-link
do, how the two steps behave with the keyboard and on a wrong code, the `check` result,
and anything the request needs that the screens do not provide.
