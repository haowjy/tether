# Corrections register

Each time Jimmy corrects an agent, grouped by the mistake behind it. A class seen once
is a candidate; it moves into the table on its second occurrence. Jimmy choosing
between sound options is a decision and goes in `docs/design/decisions.md`, not here.

| Class | Correct behavior | Enforced by | Occurrences |
|---|---|---|---|

## Candidates

- **Ran a heavy probe on Jimmy's working Mac without bounding it.** Correct: prefer
  native runs; cap containers (`--cpus 1`), run suites one after another, Playwright
  with `--workers=2`. Enforced by: `doc: .meridian/kb/probe-environments.md`.
  Occurrence: `chat:c106` (segment 1, entry 94), 2026-10-24, "container cpu usage is
  through the roof..."
- **Kept calling a build by a role it no longer had.** The build Jimmy was testing on
  his iPhone was still described as the keyboard spike. Correct: name an artifact by
  what it is now, and retire or rename it when its role changes. Enforced by: `none`.
  Occurrence: `chat:c106` (segment 0, entry 7), 2026-10-24, "why is it still called a
  keyboard spike?"
