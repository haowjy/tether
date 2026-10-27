# Slice 6 (Mermaid) fix round 1

You built `1c93d31`. Security review p339:
`/Users/jimmyyao/.meridian/projects/steep-lamp-cloud/spawns/p339/report.md`. Read it in
full. Another writer works in `web/screens/terminal/`, `web/app/focus.ts`, `ios/`
meanwhile: stay out of those; stage only your files; one local commit, do not push.

Fix:
- **#1** every render starts from Mermaid's reset (`mermaid.mermaidAPI.reset()` before
  `initialize`, or whatever makes shared config impossible to carry between renders).
- **#2** add `htmlLabels` (and anything else a document must not change) to `secure`.
- **#3** a failed chunk load clears the cached loader so a later document retries;
  both `load()` and the `TextViewers` effect catch it and show the note under the fence;
  a 404 for a build chunk raises the app's **"Update required"** state, which isn't
  built yet: build it per `docs/design/client/browser-behaviors.md` "Offline and
  updates" (one owner for update state, shown in the app's banners, not over the
  terminal, with Reload; read `web/sw/`, `web/screens/shell/AppBanners.tsx` and how
  "Update ready" / "Reload to finish updating" are owned now, and extend that owner
  rather than adding a second). Log in `decisions.md` that diagram chunks aren't
  precached, so diagrams need the network and a page one build behind gets "Update
  required" on its first diagram; correct the `sw/sw.ts` header comment.
- **#4** forbid `a` in the SVG sanitizer.
- **#5** a module comment that the CSP is what blocks Mermaid's pre-sanitize fetches.
- **#6** check for a mermaid fence before importing even the loader. Also try making
  `dagre` the layout (Mermaid's classic layout) so the ELK chunk is neither loaded nor
  shipped, if Mermaid 12.1 still ships dagre and flowcharts render with it; if ELK can't
  be dropped, say why with evidence.
- **#7** `checks.mjs` compares raw bytes against `build.rs`'s per-file cap.

Re-run p339's payloads that matter (bad colour then a plain diagram; `htmlLabels: true`
frontmatter; a 404'd chunk then a retry; `click A href "#tabs"`), plus your earlier
hostile set, light and dark, and report bundle numbers before/after. Gates:
`pnpm --dir web run check`, `scripts/preflight.sh full`. No UI tests. Report the SHA.
