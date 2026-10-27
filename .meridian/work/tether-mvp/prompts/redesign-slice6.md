# Build slice 6 of the client redesign: Mermaid in Markdown previews

Repo `/Users/jimmyyao/repos/tether`, `main`, primary checkout (no branches/PRs; read
`AGENTS.md`). One local commit; **do not push**. Another writer may be fixing the
sessions sheet (`web/screens/sessions/`, `web/app/router.ts`, `web/screens/terminal/`)
at the same time: stay inside `web/files/render/`, the Markdown preview component under
`web/screens/files/`, `web/package.json` + `web/pnpm-lock.yaml`, `web/scripts/checks.mjs`
budgets if needed, and docs. Stage and commit only your files (`git add <paths>`, never
`-A`).

## What

Jimmy: "mermaid is important" (`docs/design/decisions.md` "Keep Mermaid in the Markdown
viewer"). Rule: `docs/design/plan.md` invariant "Content from disk or tmux never runs as
the app" and its "Rendered content is untrusted" section; `browser-behaviors.md`
Files/Previews: "Markdown Mermaid diagrams render with a lazily loaded renderer in strict
mode, with rendered output sanitized by DOMPurify." Plan details:
`.meridian/work/tether-mvp/redesign/plan.md` (Mermaid: fit to width, scrolls
horizontally when wider; no zoom/pan this pass).

- A fenced ```` ```mermaid ```` block in a Markdown preview renders as a diagram. Today's
  renderer is `web/files/render/markdown.ts` (markdown-it, then DOMPurify with a tag
  allowlist).
- Mermaid loads only when a document has a mermaid block (dynamic import), never in the
  initial shell. Check the service worker's precache and `checks.mjs` budgets: the shell
  budget and the initial-JS budget must not grow; if the precache would take Mermaid's
  chunks, exclude them (a diagram on a spotty link costs its download once, on demand)
  and say so.
- `securityLevel: "strict"`, `startOnLoad: false`, no `htmlLabels` HTML, nothing
  fetched from outside (no web fonts, no remote icons). Sanitize the SVG Mermaid returns
  with DOMPurify's SVG profile (no `foreignObject`, no event attributes, no `href` to
  anything but in-document fragments, no `<style>` that imports), then insert it. The
  document's own HTML allowlist stays as it is.
- Theme follows the app's current scheme (light/dark tokens); a scheme change re-renders.
- A diagram that fails to parse shows the source as a code block with a short "Diagram
  couldn't render: <first line of the error>" line, never an empty gap.
- Wider than the preview: scrolls horizontally inside its own box; the page never
  scrolls sideways at 320 px.
- Pin the dependency to an exact version at least two weeks old (`pnpm --dir web add
  mermaid@<x.y.z>`; pnpm only, never npm).

Log in `docs/design/decisions.md` if you make a choice the spec leaves open (precache
exclusion, error display). CHANGELOG `[Unreleased]` bullet: Mermaid diagrams render in
Markdown previews. Update `client-architecture.md` (`.meridian/work/tether-mvp/design/`)
where it describes the Markdown renderer or the shell budget.

No UI tests (Jimmy: "code structure over if statements"). Unit tests only where the
existing `files/render` tests already cover the renderer; add none.

## Verify

`pnpm --dir web run check`, `scripts/preflight.sh full`. In the harness (`pnpm --dir web
run dev -- --mode harness`), open a Markdown preview holding: a flowchart, a sequence
diagram, a wide diagram, a broken one, and a hostile one (a `click` directive with
`javascript:`, a label with `<img onerror=...>`, `<script>`, a `%%{init: {"securityLevel":
"loose"}}%%` directive trying to lower the level). Confirm in devtools that no script ran,
no event attributes or foreignObject survive, no external request was made, and the
init directive could not lower the level. Light and dark. Report what you saw for each,
the bundle numbers before/after (shell, initial JS, the new lazy chunk), and the SHA.
