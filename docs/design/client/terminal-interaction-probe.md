# Isolated clipboard probes, 2026-10-22

System: local tmux 3.4. Script /tmp/tether-c77-clipboard-probe.py used a dedicated socket tether-c77-clipboard-research, a 12-column pane, and synthetic text only. All test panes/server and their temporary files were removed in finally. Default tmux and live app were untouched.

## Wrap boundaries

Output source: `abcdefghijklmnopqr` followed by CRLF, then `HARD-A`, CRLF, `HARD-B`.

`capture-pane -p -S 0 -E 2` returned:

```text
abcdefghijkl\nmnopqr\nHARD-A\n
```

`capture-pane -p -N` over same rows returned:

```text
abcdefghijkl\nmnopqr      \nHARD-A      \n
```

`capture-pane -p -J` returned:

```text
abcdefghijklmnopqr\nHARD-A\n
```

Finding: row text alone from current nonjoined capture does not carry logical line boundaries; -N also preserves blank cell padding. Joined capture can distinguish this controlled case. It does not by itself solve row/column selection mapping, snapshot sequencing, Unicode widths, or history races. Need a wrap-aware transport/copy plan; never infer soft wrap solely because a row is full width.

## Paste bytes

A raw-mode receiver enabled or disabled DEC private mode 2004, then received tmux `load-buffer` plus `paste-buffer -p -d` with payload `one\ntwo\n`.

Disabled: `b'one\rtwo\r'`.
Enabled: `b'\x1b[200~one\rtwo\r\x1b[201~'`.

Finding: tmux uses the pane application's paste mode, independent of a reconstructed frontend mode. LF becomes terminal CR with the default separator. Newline structure is preserved semantically, not byte-identically. A trailing clipboard newline remains a trailing terminal newline; not appending Enter is not equivalent to guaranteeing no execution. Receiving program decides how bracketed payloads are treated.

This is a single Linux/tmux 3.4 runtime observation. tmux 3.7b, Safari/iOS gestures, native selection handles, and IME behavior are not covered by this probe.
