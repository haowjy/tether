# Inventory the web client and protocol against the approved client contract

The old web UI is being replaced by the approved layouts. Decide, module by module,
what survives. Read `docs/design/client/README.md`, `browser-behaviors.md`,
`terminal-interaction-design.md`, `browser-setup.md`, then everything under `web/`
(skip node_modules, dist) and `src/proto/`, `src/http/`, `src/hub/` as needed.

Write findings to `.meridian/work/tether-mvp/web-inventory.md` as you go (partial
results first), with:

1. Per `web/` module: keep as-is / keep with changes / delete, with the reason in one
   line (UI-free? tested? coupled to the old sheets, native bridge, or the lint ban on
   inputs?). Name the coupling with file:line.
2. Native assumptions baked into shared code (bridge-only boot, xterm stdin disabled,
   focus rules, dev shim) and where a browser/native platform adapter would cut.
3. Protocol and daemon gaps the contract needs: create session/window with optional
   name and absolute start directory; `attachedElsewhere`; window index in listings;
   tab restore by validated identity after reload; image paste upload; path insertion
   without Enter; anything else the contract implies. For each: exists (file:line) /
   partial / missing.
4. Tests in `web/` that would die with deleted modules.

Writes only that file. No source edits.
