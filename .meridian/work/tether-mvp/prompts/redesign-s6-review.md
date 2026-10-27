# Security and correctness review: Mermaid in Markdown previews (`1c93d31`)

Repo `/Users/jimmyyao/repos/tether`, local commit `1c93d31` on main. It adds
`web/files/render/mermaid.ts` (lazy-loaded Mermaid 12.1.0, `securityLevel: "strict"`,
`htmlLabels: false`, output sanitized with DOMPurify's SVG profile), keeps the class
`language-mermaid` through the Markdown allowlist, excludes diagram-only chunks from the
service worker precache (`web/scripts/diagrams.mjs`), budgets them separately in
`web/scripts/checks.mjs`, and stubs KaTeX. Writer's report: `meridian spawn show p337`.

The invariant (`docs/design/plan.md` "Invariants", "Rendered content is untrusted"):
content from disk never runs as the app. A Markdown file on Jimmy's server is untrusted.
Check, beside anything else:
- Can a diagram run script, navigate, fetch anything off-host, or carry a focusable or
  clickable element into the page: Mermaid directives (`%%{init}%%`, `click`, `call`,
  `href`), themeVariables/CSS injection through `<style>` (`url()`, `@import`,
  `expression`, attribute selectors exfiltrating), SVG `<use>`/`<a>`/`xlink:href`,
  `<animate>`/`<set>` attribute changes, `<foreignObject>`, data URIs, labels holding
  HTML/entities? Read the sanitizer config line by line against DOMPurify 3.4 and
  Mermaid 12.1 behaviour.
- Does Mermaid mutate global state the app relies on (it injects styles/ids into the
  document, leaves error SVGs in `<body>`, registers globals)? Two diagrams with
  colliding ids; re-render on scheme change leaking nodes.
- Update path: diagram chunks aren't precached; a page one build behind fetching a
  diagram chunk after an update gets a 404. The spec says a lazy chunk failure shows the
  designed "Update required" (`browser-behaviors.md` "Offline and updates"): does it
  here, or does the preview break?
- Cost: the 1.35 MB gz chunk loads only for a document with a mermaid fence, once per
  page life; nothing else imports it; the daemon embed caps (`build.rs`) still hold.

Edit nothing. Findings ranked by severity, with path:line, a concrete exploit or failure,
and the fix. You may write throwaway scripts in `/tmp` to try payloads against the built
renderer (e.g. vitest with jsdom/happy-dom, or the harness), deleting them after.
