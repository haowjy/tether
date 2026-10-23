# Repo-local context migration

Plan: inspect installed Meridian config/resolver → configure project-relative work,
archive and KB → migrate knowledge plus portable checkpoint → verify path resolution,
links and ignored runtime status → full preflight → commit/push main.

Pre-edit tree was clean. Installed context resolver supports source=local with
project-relative paths. Do not use source=git/remote: this is the source repo, not a
second context clone. Old scratch preserved; no runtime data or access credentials
bulk-imported. Existing running preview directories remain in place.

Verification: with launch-bound path variables cleared, `meridian context --verbose`
and `meridian work current` both resolve into this checkout. Existing-session paths
remain old as expected; restart for fresh bindings. TOML parsing, relative Markdown
links, targeted credential scan and ignored `__status.json` check passed. Full
preflight passed. Runtime/session history is intentionally not migrated or tracked.
