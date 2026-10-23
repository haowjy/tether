# Research: direct terminal keyboard input in desktop and mobile browsers (xterm.js 6)

tether is a phone-first tmux client. Its web client renders with xterm.js 6.0.0. In the native
iOS app native owns the keyboard and xterm's stdin is disabled. Now the same client must also
run in desktop browsers and iPhone Safari / installed PWA with the ordinary system keyboard
(no custom key strip). We must choose: use xterm.js's own hidden helper textarea
(`term.onData`, `onBinary`, its composition helper) for direct input, or a tether-owned hidden
input element that we translate into terminal input ourselves.

Answer with evidence (source links, issues, dates; today is 2026-10-23):
1. How xterm.js 6's textarea handles IME composition, autocorrect/predictive text, dictation,
   iOS Safari's insertText/insertReplacementText/deleteContentBackward, and Android GBoard.
   Open/closed upstream issues about mobile input (iOS keyboard, autocorrect duplication,
   backspace, composition) and their status in 6.x.
2. How real projects do browser terminal input on mobile: ttyd, wetty, sshx, code-server/VS Code
   web terminal, Gitpod/Coder, Termux-web? , GoTTY, Shellngn, tmate web, Warp/others if open.
   Do they keep xterm's textarea or substitute their own input? What problems drove it?
3. Paste handling: how xterm's paste path works (bracketedPasteMode wrapping in the browser),
   and how to route paste to an app's own "paste" message instead of onData, so the
   browser does not double-wrap bracketed paste. Image paste (clipboardData.files) interception.
4. Focus behaviors: focusing xterm's textarea programmatically on iOS (needs a user gesture to
   raise the keyboard?), keeping keyboard up across taps, `inputmode`, `enterkeyhint`,
   `autocapitalize=off`, `autocorrect=off`, `spellcheck=false` effects on iOS 26 Safari.
5. Your recommendation.

Write nothing to the repo. Report findings with links; mark guesses as guesses.
