# Historical mockup review dispositions

Optional audit history. Review identifiers refer to archived review runs, not files needed to implement the client. Current authority is README.md and the interaction contract.

## First Opus review (p79)

Review scope is mockups/interaction contract, not production code. All implementation-only gates stay explicit. Historical review record; the completed follow-up is summarized below. Layout approval and repository promotion followed these reviews.

- H1: shared rows(), collapsed defaults, expanded-session set, session/window search and search-only parent expansion. Checked 24 groups, window search returns matching children. Default new groups remain collapsed.
- H2: browser-review-decisions.md maps each old-spec conflict and alternatives; current contract contains the proposed decisions. At review time, root plan.md/decisions.md updates were gated on approval. Repository promotion now records scope and precedence in those entrypoints. Creation now includes existing-session new window + start-directory form. attachedElsewhere warning is demonstrated without pretending it identifies a laptop.
- H3: file preview insert-path action targets named active tab and returns to terminal; upload completion uses same path in contract. Upload and actual input are explicitly not implemented by mockup.
- H4: desktop picker search auto-focus; close/select return terminal focus; Escape handler only runs with overlay present. Browser-reserved shortcuts explicitly accepted, exact behavior remains a real-browser probe gate.
- M1: empty terminal keeps toolbar/+ and directs to Home/+; desktop focus fallback +.
- M2: common rows() for Home/picker; N windows and index:name; dark desktop picker/light mobile sheet deliberate.
- M3: session disclosure arrow; window rows terminal glyph/no chevron; folder drill-in chevron.
- M4: only active pill has close; session truncates first; full labels accessible; production duplicates include real window index; stable IDs required, mock string identities declared limitation.
- M5: event-driven entry/reconnect/sessionsChanged refresh and pruning recorded.
- M6: tab connection state and active-terminal reconnect overlay with Retry; preview-only connection selector demonstrates state.
- L1: window open/close labels include session; shared label formatter.
- L2: close active chooses right neighbour else left.
- L3: open window rows tinted and marked Open.
- L4: desktop + follows tab group, not far edge.
- L5: desktop picker focuses search; mobile doesn't automatically open keyboard.

Additional boundary decisions: browser history entries proposed for destinations/folders/previews/sheet, not tab switching; real browser history and native gestures not implemented by this mockup. Ordinary mobile keyboard has limitations but no blanket claim all browsers cannot send particular keys. Physical-keyboard/native alternatives remain.

## Round 2: p80

Opus verdict: approve with notes; all round-1 High/Medium/Low findings verified resolved as a proposal, no blocking regression. Reviewer explicitly did not close production/hardware gates.

Follow-up notes addressed by lead (bounded changes, inspected directly rather than a third review cycle):
- N1: Home creation controls now text-labelled New session / New window, with window action indented in group. Terminal + remains attach-only icon.
- N2: contract explicitly preserves browser image-paste upload→quoted absolute path insertion into paste-start target; no Enter or target substitution. Clipboard is still an implementation probe.
- L-a/L-c: removed invalid HTML regex and arbitrary mandatory-name requirement; blank names produce illustrative defaults. Optional directory accepts absolute path or blank with validation feedback; real existence checked by daemon in implementation.
- L-b: creation dialog remembers exact opener for Cancel/Escape; last-tab close focuses Home search. Verified both session and window cancellation focus and blank-name submission.
- L-d: file preview shows folder breadcrumb, title aligns next to back, simulated insertion uses absolute path, disabled copy matches contract.

Evidence: browser checks for desktop/mobile flows, no page errors; 24-session and search expansion boundaries; keyboard focus, empty terminal toolbar, file-preview context/insertion, reconnect overlay. Final small note fixes were lead-verified after p80 approval; not represented as a third independent approval.

Layout acceptance and repository promotion are complete. Remaining gates: architecture/pre-dev for browser authentication, assets, input and resize ownership; verify on real desktop/mobile browsers and iPhone. No production source edits, commits, PR, or release in this mockup phase.

After the review, Jimmy requested removal of dot separators/status markers and a keyboard-open local draft editor. Typography/color changes are reflected in the mockup; the draft editor and touch research are documented requirements, not part of the reviewed keyboard-hidden interaction prototype.
