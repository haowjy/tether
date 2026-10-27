# Slice 4 harness captures

Frozen export `40d8bab`, served at `http://localhost:5241/harness/index.html`. Server stopped after capture. Files named `<fixture>-<viewport>-<scheme>.png` show the initial viewport at `http://localhost:5241/harness/index.html?fixture=<fixture>&layout=<layout>&scheme=<scheme>`: `phone` = 390×844 with `layout=phone`; `320` = 320×844 with `layout=phone`; `desktop` = 1280×800 with `layout=desktop`. Both schemes are captured for every requested fixture. `homeCards` initial viewport shows only its upper cards.

- `homeCards-lower-phone-dark.png`: homeCards phone dark after scrolling to the bottom; tmux stopped, offline, last reached, checking and attention states.
- `second-server-sheet-phone-dark.png`: homeTwoServers phone dark after choosing All 2 sessions on jimmys-macbook-air; rows incorrectly marked open.
- `sheet-plus-phone-dark.png`: same state after opening +; New session and Browse files menu.
- `clear-confirm-phone-dark.png`: homeTabs phone dark, Settings → Clear local data; confirmation dialog.

The harness uses mock data, not a real server or iPhone. Viewport captures do not show offscreen content.
