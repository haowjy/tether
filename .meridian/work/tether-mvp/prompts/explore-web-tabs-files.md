# Explore: tether web client tab model, saved workspace, session lists, and Files screen

The design lead is changing tether's web client (in `web/`) from one tab per tmux window to
one tab per tmux session, and reworking the Files screen to find folders by a path field with
completion. Report facts with file paths, line refs and short snippets; write no files.

Tabs and lists:
1. Where the tab model lives (`web/tabs/`, `web/workspace/`, `web/proto/`...): tab identity
   (TabKey / WindowRef), how tabs open/activate/close, how labels are computed, pruning
   against listings, `windowClosed` / `windowRenamed` / `sessionClosed` handling.
2. Saved workspace: storage format and version (localStorage? native bridge
   `SavedWorkspace` version 1), how it is loaded/migrated, what each saved tab records
   (does it keep the session id/name?), the `expanded` map, drafts keyed by what.
3. Home / picker / switcher session lists (`web/screens/home`, `picker`, `switcher`,
   `sessions`, `web/sessions`): the shared row renderer, accordion/expansion state, search
   filter, "+ New window"/"+ New session" creation flow, "here"/"open" labels.
4. The phone dock tab chip and desktop tab strip: what label they show, where.
5. Paste / image paste / Files "Insert path" target capture: how the target tab is captured
   and checked (`web/screens/files/insert.ts`, terminal paste code), the "eligibility rule".
6. Where the watch/claim/resize messages are sent (watch predicate, `claim: false`).
7. Every place in web/ and src/ that keys behavior on window identity — rough size of the
   change (file list with one-line role each).

Files:
8. `web/screens/files/` and `web/files/`: component structure, how folders are listed (the
   `/fs/list` call, paging, caching of listings, hidden toggle), roots handling, navigation
   state/back behavior, the Add folder dialog's directory browser, and what "current
   folder" means. How listing responses are shaped (fields per entry, `next` cursor, caps).
9. Daemon side: `src/fs/` list route — entry ordering, page size, does it support listing
   directories only, sorting, `~` handling, what roots mean for paths outside roots.

Keep the report organized by the numbered questions.
