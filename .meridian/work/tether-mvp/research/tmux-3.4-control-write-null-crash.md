# tmux 3.4 crash: control_write <- control_notify_client_detached, SIGSEGV @0x20

Upstream fix: commit e5a2a25f / c51da10 "Do not notify clients if not fully initialized,
from Ben Maurer in GitHub issue 4980" (PR https://github.com/tmux/tmux/pull/4980, applied 2026-04-13).
First release: 3.7 (tag --contains: 3.7 3.7a 3.7b 3.7c 3.8). Not in 3.5, 3.5a, 3.6, 3.6a, 3.6b.

    -	((c) != NULL && ((c)->flags & CLIENT_CONTROL))
    +	((c) != NULL && ((c)->flags & CLIENT_CONTROL) && \
    +	 (c)->control_state != NULL)

0x20 = offsetof(struct control_state, all_blocks) in 3.4 (panes 8 + pending_list 16 + pending_count 4 + pad 4);
control_write does TAILQ_EMPTY(&cs->all_blocks) with cs == NULL.

Window: MSG_IDENTIFY_FLAGS sets CLIENT_CONTROL (server-client.c 3.4 ~l.2949); control_start() (allocates
control_state) only on MSG_IDENTIFY_DONE (~l.3042). Client is already on `clients` list (l.287). Client sends
FLAGS first and DONE last, after STDIN/STDOUT fd-passing msgs and one ENVIRON msg per env var (client.c 459-493).
server_loop runs cmdq_next(NULL) between event iterations -> any queued control notification iterates clients.

Related:
- 31c93c48 (issue/PR 5004, 3.7): control_stop() NULL-check + sets c->control_state = NULL. Crash control_stop+36 @0x38
  when control client disconnects before IDENTIFY_DONE.
- 1508bec9 (issue 5357, 3.8): skip CLIENT_EXIT clients in CONTROL_SHOULD_NOTIFY_CLIENT.
- 93169e2e (issue 5570, 3.8): NULL checks in control_write/control_write_guard/control_notify_write; 3.7c crash via
  run-shell job completion writing to destroyed control client.
- dc9837f1 (issue 5789, master after 3.8, 2026-10-23): keep dead clients on a list so queue flushed / not leaked.
