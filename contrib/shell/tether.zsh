# tether shell integration for zsh 5.1+ (docs/design/complete.md#the-shell-snippet).
#
# Marks the prompt and the command line with OSC 133 and reports the directory with
# OSC 7, so tether's suggestion strip can read what you are typing. Source it at the
# END of ~/.zshrc, after your prompt theme and plugins:
#
#   [[ -r ~/gitrepos/tether/contrib/shell/tether.zsh ]] && source ~/gitrepos/tether/contrib/shell/tether.zsh
#
# It also sets INC_APPEND_HISTORY, so tether suggests commands from the shells still
# open (zsh saves history only with HISTFILE and SAVEHIST set). Set
# TETHER_NO_HISTORY_APPEND=1 before sourcing to leave history options alone.

[[ -o interactive ]] || return 0
(( ${+__tether_loaded} )) && return 0
typeset -g __tether_loaded=1

[[ -n ${TETHER_NO_HISTORY_APPEND-} ]] || setopt INC_APPEND_HISTORY

# OSC 7: file://host/path, the path percent-encoded byte by byte.
__tether_osc7() {
  emulate -L zsh -o extended_glob
  local LC_ALL=C
  printf '\e]7;file://%s%s\a' "${HOST-}" \
    "${PWD//(#m)[^-\/._~A-Za-z0-9]/%${(l:2::0:)$(([##16]#MATCH))}}"
}

# First precmd hook: D closes the last command with its status, A opens the prompt.
__tether_precmd() {
  local s=$?
  printf '\e]133;D;%s\a\e]133;A\a' "$s"
  __tether_osc7
  return $s
}

# Last precmd hook: B ends the prompt, where typed input starts. Re-added each time,
# since prompt themes rebuild PS1 in their own hooks.
__tether_prompt() {
  local s=$?
  [[ $PS1 == *$'%{\e]133;B\a%}' ]] || PS1+=$'%{\e]133;B\a%}'
  return $s
}

# C: the command line was accepted and output starts.
__tether_preexec() {
  printf '\e]133;C\a'
}

precmd_functions=(__tether_precmd ${precmd_functions[@]} __tether_prompt)
preexec_functions+=(__tether_preexec)
