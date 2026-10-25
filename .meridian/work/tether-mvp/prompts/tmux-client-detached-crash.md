Research task (external facts, no repo edits). A tmux 3.4 server (built from the 3.4 tag, macOS arm64) crashed with SIGSEGV, KERN_INVALID_ADDRESS at 0x20, stack:

control_write (+36) <- control_notify_client_detached (+88) <- notify_callback <- cmdq_next <- server_loop

Context: several control-mode clients (`tmux -C attach -t <session>`, one per session) are attached to one server; a daemon detaches one of them (it closes the control client's stdin / sends detach after a linger) while other control clients remain attached, some recently attached, possibly some mid-switch-client (`switch-client -c <self> -t '$S'`) and with `refresh-client -B` subscriptions.

Questions:
1. What upstream bug is this? Find the tmux commit(s)/issue(s) that fix a NULL control_state / crash in control_notify_client_detached or control_write when a client detaches (GitHub tmux/tmux issues, CHANGES file, commits after 3.4). Quote the fix and which release first contains it (3.5? 3.5a? 3.6?).
2. Is tmux 3.7b (or whatever the latest release is) affected?
3. Under what exact condition does it trigger (e.g. a control client whose control_state is NULL because it hasn't started / is exiting; a client with CLIENT_CONTROL flag in the clients list; the detached client already freed)?
4. Any known workaround a control-mode consumer can apply (e.g. ordering of detach, avoiding `%client-detached` notification, `refresh-client -f no-output`, waiting before detaching)?

Report with links and quoted code/commit text. Be concise.
