# Alignment review: does the client architecture cover its brief and honour the contracts?

Artifact: `.meridian/work/tether-mvp/design/client-architecture.md`.

Its brief required settling, with alternatives rejected: (1) what survives from web/, what is
deleted, new module layout, rescoping the native-only no-focus lint; (2) a platform adapter for
boot+credentials, input+focus, viewport+keyboard, lifecycle (visible/online), storage, file pick
and image paste, link opening, haptics — browser/native/test implementations, dev shim must not
become production auth; (3) app state and routing: Home/Terminal/Files, tabs keyed by
server+window identity, restore after reload validated against a listing, browser history rules
from the contract, event-driven sessions refresh (no polling); (4) design system: primitive →
semantic → component tokens in CSS custom properties, light/dark, density axis (44 px touch
targets), type scale with terminal font, connected/reconnecting colours with no dot markers;
component approach chosen (headless lib via preact/compat vs owned set) with size/compat/
maintenance; list of components; mockup improvements; (5) terminal input on desktop and phone
browser (xterm textarea vs owned), local draft editor, paste and image paste routes; (6) PWA
manifest, SW scope and update flow, caching, offline drafts never queue input; (7) build order as
lanes with disjoint directories in one checkout, what each lane verifies.
Fixed choices by Jimmy that must be kept: no Files in terminal +, no intermediate menu, no dot
markers or separators, no custom browser keyboard strip, local draft whose Insert sends no Enter.
Browser auth admits enrolled tailnet nodes, no cookie; boot reads enrolment state from the daemon.
Default memory budget allows 3 sessions at once; a refused session needs a clear message.
Written for a cold reader.

Check it systematically against: the brief above; docs/design/client/browser-behaviors.md (every
behaviour rule — navigation, picker, focus, Escape, history, files insert path, image paste,
visual copy rule); docs/design/client/terminal-interaction-design.md; browser-setup.md (PWA and
drafts sections); connection-roadmap.md; plan.md "Code structure and standards"; ios-shell.md
where the design changes native behaviour (has it named every ios-shell change?).

Write a coverage matrix and findings to
`.meridian/work/tether-mvp/design/client-architecture-review-alignment.md` (each gap: requirement,
where the design falls short, suggested fix; severity). Do not edit the design or any source.
