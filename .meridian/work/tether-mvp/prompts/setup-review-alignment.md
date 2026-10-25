# Review: tether setup against its spec (alignment)

Check that commits 9343b6a and ae13307 on `main` of /Users/jimmyyao/repos/tether implement
`docs/design/setup.md` faithfully, section by section: the checks table, one-time grants,
service install, publication (Linux writes the entry; Mac daemon publishes), verification,
output, teardown, exit status, code structure, and the decisions logged in
`docs/design/decisions.md` (search "setup"). Also check `docs/design/auth.md` changes in
9343b6a match the code, and that `src/setup/AGENTS.md`, `src/auth/AGENTS.md`, CHANGELOG and
`contrib/tether.service` are accurate.

Report each place code and spec disagree, which side looks right, and anything in the spec with
no implementation or code with no spec. Do not run setup/teardown for real, do not touch launchd,
Tailscale Serve, or the default tmux server. Edit nothing.
