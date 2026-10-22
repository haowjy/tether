# Agent keybindings

What the agent CLIs Jimmy uses bind to each key, collected 2026-10-21. It is the
evidence behind the key-row groups in [plan.md](../plan.md#key-row-groups).

Sources:

- Claude Code: [interactive mode](https://code.claude.com/docs/en/interactive-mode),
  [terminal config](https://code.claude.com/docs/en/terminal-config).
- Codex CLI: [tooltips](https://github.com/openai/codex/blob/main/codex-rs/tui/tooltips.txt),
  [backtrack source](https://github.com/openai/codex/blob/main/codex-rs/tui/src/app_backtrack.rs),
  [cheat sheet](https://linuru.com/codex-cli/).
- opencode: [keybinds](https://opencode.ai/docs/keybinds/),
  [v2 keybinds](https://opencode.ai/v2/docs/cli/keybinds/),
  [agents](https://opencode.ai/docs/agents/),
  [Shift+Tab agent-cycle change](https://github.com/anomalyco/opencode/issues/49133).

| Key | Claude Code | Codex CLI | opencode |
|---|---|---|---|
| Esc | interrupt, close dialog | interrupt. With an empty composer, starts backtrack | interrupt session |
| Esc Esc | clear draft, or rewind menu if empty | backtrack: edit a previous message | – |
| Shift+Tab | cycle permission mode (normal / auto-accept / plan) | – | cycle agents (v2 default; Tab in older versions) |
| Tab | accept autocomplete | queue a message while working | (old) switch agent |
| Ctrl+C | interrupt or clear. Twice exits | exit | exit |
| Ctrl+D | exit (twice) | – | exit |
| Newline | Ctrl+J or `\`+Enter. Shift+Enter needs terminal support | Ctrl+J or Alt+Enter | Shift+Enter / Ctrl+J |
| Ctrl+R | reverse history search | – | rename session |
| Ctrl+T | task checklist | transcript overlay | – |
| Ctrl+O | transcript viewer | copy last response | recent sessions |
| Ctrl+V | paste image | paste image | paste |
| Ctrl+B | background task (press twice when typed through tmux) | – | background tools |
| Ctrl+G | open in $EDITOR | open in $EDITOR | – |
| Ctrl+L / Ctrl+S / Ctrl+Z | redraw / stash prompt / suspend | clear UI / – / – | – |
| Ctrl+X | prefix (Ctrl+X Ctrl+E, Ctrl+X Ctrl+K) | – | leader (Ctrl+X then n, l, c…) |
| Ctrl+P | history up | – | command palette |
| Arrows | history, menus, dialog tabs | history, transcript nav | subagent navigation |
| `@` `/` `!` `?` | file mention / slash cmd / bash mode / help | `/` cmds, `!` shell, `?` shortcuts | `@` agent or file, `/` cmds |
