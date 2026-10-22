# tether shell integration for bash 4.4+ (docs/design/complete.md#the-shell-snippet).
#
# Marks the prompt and the command line with OSC 133 and reports the directory with
# OSC 7, so tether's suggestion strip can read what you are typing. Source it at the
# END of ~/.bashrc, after anything that sets PS1 or PROMPT_COMMAND:
#
#   [ -r ~/gitrepos/tether/contrib/shell/tether.bash ] && . ~/gitrepos/tether/contrib/shell/tether.bash
#
# It also runs `history -a` before each prompt, so tether suggests commands from the
# shells still open. Set TETHER_NO_HISTORY_APPEND=1 before sourcing to keep bash's
# default of writing history only on exit.

[[ $- == *i* ]] || return 0
[[ -z ${__tether_loaded-} ]] || return 0
__tether_loaded=1

# OSC 7: file://host/path, the path percent-encoded byte by byte.
__tether_osc7() {
  local LC_ALL=C p=$PWD out= c i
  for ((i = 0; i < ${#p}; i++)); do
    c=${p:i:1}
    case $c in
      [-/._~A-Za-z0-9]) out+=$c ;;
      *) printf -v c '%%%02X' "'$c"; out+=$c ;;
    esac
  done
  printf '\e]7;file://%s%s\a' "${HOSTNAME-}" "$out"
}

# First in PROMPT_COMMAND: D closes the last command with its status, A opens the
# prompt. Returns the status it found, so later hooks still see it.
__tether_pre() {
  local s=$?
  [[ -n ${TETHER_NO_HISTORY_APPEND-} ]] || history -a
  printf '\e]133;D;%s\a\e]133;A\a' "$s"
  __tether_osc7
  return "$s"
}

# Last in PROMPT_COMMAND: B ends the prompt, where typed input starts. Re-added each
# time, since prompt frameworks rebuild PS1 in their own hooks.
__tether_post() {
  local s=$?
  [[ $PS1 == *'\[\e]133;B\a\]' ]] || PS1+='\[\e]133;B\a\]'
  return "$s"
}

# Wrap the existing PROMPT_COMMAND: an array on bash 5.1+, else newline-joined, so an
# existing command ending in `&` or a comment can't swallow __tether_post.
if (( BASH_VERSINFO[0] > 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 1) )); then
  if [[ $(declare -p PROMPT_COMMAND 2>/dev/null) == 'declare -a'* ]]; then
    PROMPT_COMMAND=(__tether_pre "${PROMPT_COMMAND[@]}" __tether_post)
  else
    PROMPT_COMMAND=(__tether_pre ${PROMPT_COMMAND:+"$PROMPT_COMMAND"} __tether_post)
  fi
else
  PROMPT_COMMAND="__tether_pre${PROMPT_COMMAND:+
$PROMPT_COMMAND}
__tether_post"
fi

# C: the command line was accepted and output starts. PS0 is printed after a line is
# read and before it runs.
PS0+='\e]133;C\a'
