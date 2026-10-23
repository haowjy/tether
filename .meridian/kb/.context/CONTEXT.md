# KB Working Conventions

## Writing

- One concept per page; each concept has one source of truth, others link to it.
- Name files by what they describe, not when they were written.
- Refer to repository files by repo-relative path (for example
  `docs/design/client/README.md`), or use relative links from this repo-local KB.
  Do not use absolute paths tied to a developer machine.
- Flag content needing human attention with `> [!FLAG] **Needs human review**`.

## Structure

- Flat until a topic accumulates several related pages, then give it a directory.

## Validation

Use `/md-validation` for link checking and diagram validation after edits.
