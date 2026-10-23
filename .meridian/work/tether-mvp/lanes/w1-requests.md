# W1 requests for W0-owned files

Each is worked around in W1's files; the stand-in is deleted when the change lands.

1. **`app/listing.ts`: report a lost link, and retry `busy`.** `linkLost` should emit
   `{ type: "failed", handle, reason: "lost" }`, so Home can mark cached rows stale when the
   socket drops (today only a failed `listSessions` does, and none is sent on a dead socket).
   A listing answered `busy` should retry soon, silently (§6.4). Stand-in: none; an offline
   Home after a socket drop shows its cached rows unmarked until the host's admission says
   `unreachable`.
2. **`app/controller.ts`: own the sessions cache.** Construct `new SessionsCache(boot.workspace?.expanded)`
   next to `listing`, call `persist.provideExpanded(() => cache.saved())`, feed it the listing
   events, and expose it on the controller. Stand-in: `screens/home/useSessions.ts` builds one per
   controller on first use (a `WeakMap`). Risk until then: a `persist.save()` before any screen
   mounts writes `expanded: {}`.
3. **`net/admission.ts` / `net/hosts.ts`: carry the device name on `admitted`** (the session
   reply's `deviceName`). Settings says "this device" where the design says `<node>`.
4. **`ui/focus.ts` + `Dialog`: `returnFocusTo` accepts an element**, as its comment says.
   Stand-in: the opener calls `app.focus.focusElement(el)` before opening, so the dialog's
   remembered opener is right on Safari, which doesn't focus a clicked button.
5. **`SearchField` should spread `data-*`** like `TextField`, so a dialog can mark its initial
   field. Stand-in: the picker finds it with a selector.
6. **`ui/primitives/IconButton` tooltip shows on programmatic focus on touch** (the dialog Close
   button, focused on open, shows "Close" over the title). Screenshot: phone Settings.
7. **`vite.dev-proxy.ts`: `/auth/info` goes to the daemon with no credentials**, so the daemon's
   Tailscale check refuses it (403) and the proxy answers 502. It needs the token and the
   incoming `Tailscale-User-Login`. Stand-in: `e2e/home/dev-proxy.real.ts` and
   `vite.real.config.ts` (the fix, swapped in for the real plugin).
8. **Daemon (`src/auth/identity.rs`): a way to point at a LocalAPI socket.** `LocalApi::system()`
   only looks at `/var/run/tailscale*`, so a real daemon cannot pass its Tailscale check on a
   box with no tailscaled (this Mac). W1's run uses a copy of the daemon patched to read
   `TETHER_LOCALAPI_SOCKET` (4 lines in `socket_path`) and `e2e/home/fake-localapi.mjs`. If the
   lead wants the real-daemon run in preflight, that env hook should land in the daemon.
9. **Playwright in `web/test-results/` is cleared by other lanes' runs.** W1's real-daemon run
   writes to `/tmp/tether-meridian-501/w1/pw-results` instead (`outputDir`).
