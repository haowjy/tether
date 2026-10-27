# List what slice 1 left without a caller

Repo `/Users/jimmyyao/repos/tether`. Commits `da1373b`, `450b454` and `a484cd1` (base `093441d`)
replaced the web client's Files destination with Files tabs, deleted the desktop Rail and
HomeNav, collapsed routes to `home | tab`, and made Swift store the saved workspace as raw
JSON. Find code at HEAD in `web/` and `ios/` that those commits left orphaned or
redundant: exports with no importer, CSS classes/tokens no longer used, props nobody
passes, branches for routes/destinations that no longer exist (`files`, `terminal`,
`onTerminal`, `Destination`), harness fixtures or e2e helpers nothing uses, Swift
types/keys nothing reads, docs that still describe the removed rail, `#/files` or
`#/terminal`, or one saved Files place (`docs/design/`, `web/AGENTS.md`,
`.meridian/work/tether-mvp/design/client-architecture.md`).

Edit nothing. Report each item with path:line and the evidence it is unused (grep
results), separating "clearly dead" from "looks unused, check".
