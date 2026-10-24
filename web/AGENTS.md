# web/

The client's design is `.meridian/work/tether-mvp/design/client-architecture.md`; read §3
(layout and lint rules), §6 (state owners) and §11 (lanes and the hand-off protocol) before
adding a file. [README.md](README.md) has the commands.

- **One owner per piece of state.** Tabs: `workspace/` (pure reducer). Sockets and admission:
  `net/hosts.ts`. Navigation: `app/router.ts`, the only writer of browser history. Focus:
  `app/focus.ts`, the only caller of `.focus()` and `.blur()`. The listing: `app/listing.ts`,
  the only sender of `listSessions`. Persistence: `app/persist.ts`. Screens reach them through
  `useApp()` and call their own cores directly.
- **Environment lives only in `platform/`.** Nothing outside it names an environment, touches
  `navigator`, `indexedDB`, `visualViewport` and the like, or imports an adapter; only
  `main.tsx` imports `platform/browser/`. `lint/rules.js` enforces all of it and
  `lint/rules.test.ts` proves each rule fails on a seeded violation: change a rule and its
  case together.
- **Raw `<button>`, `<input>`, `<textarea>` live only in `ui/primitives/`** (and the two input
  owners and the hidden file input). Colour goes through `ui/tokens/semantic.css`; screens read
  spacing, radius, type and duration scales directly. Each screen styles itself with a CSS module.
- **No `·`, `•` or `●` in copy**; `scripts/checks.mjs source` fails on them.
- **Every state, not the one in the mockup.** A new screen ships its loading, empty, error and
  offline states, and a harness fixture (`harness/<lane>/`) that Playwright opens in both layouts.
- The iOS shell's bridge is `platform/native/bridge.ts` (bridge v2); `bridge.test.ts` decodes
  every fixture in `ios/TetherKit/Tests/Fixtures/bridge/`, the contract's one copy.

Changes to W0-owned files (`ui/`, `workspace/`, `app/`, `net/`, `platform/types.ts`,
`harness/index.ts`, repo config) go through the hand-off protocol in §11, not a direct edit.
