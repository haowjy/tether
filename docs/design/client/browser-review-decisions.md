# UX review decisions (p79)

Status: approved layout decisions, promoted to the repository on 2026-10-22. Rows marked superseded were replaced on 2026-10-25, when tabs began to follow a session (decisions.md, "Tabs follow a session"): lists show sessions only, and windows are changed and created in the window switcher. Implementation and real-device verification remain separate gates. See README.md for authority and open choices.

## Original-plan reconciliation

| Concern | Proposed rule | Rejected alternative / reason |
| --- | --- | --- |
| Creation vs attachment | Superseded 2026-10-25: Terminal + attaches existing sessions; New window moved to the window switcher. Was: Terminal + attaches existing windows. Home heading + creates session; an expanded session contains new-window action. Creation accepts optional name and optional absolute start directory; blank values use tmux defaults. Home creation actions have explicit text labels to distinguish them from attach-only terminal +. | Mixing attachment/creation behind the same + recreated the user's “where are my sessions?” confusion. Removing new-window capability entirely loses an existing useful flow. |
| Listing metadata | Window index/name and explicit session window count; the attachment warning was part of this historical proposal, then removed by the 2026-10-25 decision in `decisions.md`. No last-activity column in this minimal pass. | “Attached on laptop” overclaims identity; protocol only says another non-control client. Last activity adds noise; can be reconsidered with evidence. |
| Long-press rename/kill | No rename/kill session controls in this pass. Close only detaches a tether tab. | Destructive session actions exceed requested minimal scope and aren't needed to attach. User can manage tmux from its terminal. |
| Tab names | Superseded 2026-10-25: session name, then the current window's name. Was: actual session / window; append the real window index when names collide. Window rows always show index: name. Full label available accessibly; shorten session before window. Stable server/window IDs remain true identity. | Window-only hides session; session/window alone is ambiguous for duplicate names; always adding index to tabs wastes scarce mobile label width. Array position is never the production index. |
| Files entry | Home/desktop rail only; no Files in terminal + or extra terminal toolbar. Preview offers insert path into named active tab and returns there. | Re-adding Files to + contradicts user's explicit correction. Removing path insertion loses MVP behavior. |
| Browser keyboard | Superseded 2026-10-24 by the phone dock (decisions.md, "The phone dock: one row at rest, the key row with the keyboard"): touch browsers get the dock's key row. Still current: preserve browser-reserved shortcuts. Document limitations; probe actual delivery before implementation. Native input remains separate. | Copying native accessory rows into browser ignores user's explicit acceptance of browser quirks. |
| Desktop picker appearance | Dark desktop dialog; light rounded mobile sheet matching provided mobile references. Same row semantics and renderer, different platform surface colors. | Assuming mobile light-sheet reference mandates a bright desktop modal. |
| Session scale | Superseded 2026-10-25: one row per session, search by session name. Was: collapsed defaults, remembered expansion, session/window search, search-only auto-expansion. | Fully expanded lists consume many screens at the user's 24+ sessions. |
| Active tab close | Right neighbour, else left; terminal strip close only on active pill, all close controls available on Home. | First-tab fallback jumps unexpectedly; close on every mobile pill consumes label space. |
| Refresh | Entry, reconnect, sessionsChanged hint while visible, debounced; authoritative prune. | Timed polling or search-triggered network loads violate resource constraints. |

| Image paste | User image paste into focused browser terminal uploads then inserts quoted absolute canonical path into the tab captured at paste start; no Enter. Text paste stays text. | Deferring image paste loses an explicit MVP workflow. No insertion into whichever tab happens to be active at completion. |
| Directory choice | Optional absolute-path text with validation and blank default. | Adding a roots picker to the minimal creation form is unnecessary; real existence/access checks stay server-side. |

## Readiness boundaries

- Mockups model navigation and static example states, not daemon behavior or auth.
- Browser auth/asset serving and terminal sizing ownership require architecture review before implementation. Current dev proxy must not become production authentication.
- Existing native keyboard and daemon specs are not invalidated wholesale; only the mapped UX divergences above are proposed changes.
- Photo uploads, keyboard/native viewport, history/swipe-back, real indices/renames, connection failures, and error recovery require real-system tests, not mock approval.
- Jimmy approved the layout direction; later local-compose and touch research are requirements/proposals, not verified mockup interactions. Keep fictional mockups distinct from live terminal clients.
