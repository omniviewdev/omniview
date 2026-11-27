# STAND-IN for powerlevel10k (romkatv/powerlevel10k, MIT; read at 50a35cc8d9f1488d18fb8aea6cddcfc31189cc9f). It is 9500
# lines and needs gitstatus; this file does what bites an integration, and nothing else. What it copies:
#   internal/p10k.zsh:9539        `typeset -g P9K_VERSION=1.21.0`, a SHELL variable (not exported), set while .zshrc runs;
#   internal/p10k.zsh:8416-8418   with POWERLEVEL9K_TERM_SHELL_INTEGRATION the prompt is wrapped in OSC 133 A and B;
#   internal/p10k.zsh:8908-8930   _p9k_iterm2_precmd / _p9k_iterm2_preexec print 133;D;<status>, 133;C (empty Enter
#                                 prints C then D; the start mark carries cmdline_url=) and set _p9k__iterm_cmd;
#   internal/p10k.zsh:9155-9156   `preexec_functions=(_p9k_preexec1 ... _p9k_preexec2)` and
#                                 `precmd_functions=(_p9k_do_nothing _p9k_precmd_first ... _p9k_precmd)`;
#   internal/p10k.zsh:7117-7127   every precmd puts its own hooks back in front and behind the others.
# Not copied: segments, gitstatus, instant prompt, the real prompt text.
autoload -Uz add-zsh-hook
typeset -gi _p9k__iterm_cmd=0
function _p9k_iterm2_precmd() {
  builtin zle && return
  if (( _p9k__iterm_cmd )) && [[ -t 1 ]]; then
    (( _p9k__iterm_cmd == 1 )) && builtin print -n '\e]133;C;\a'
    builtin printf '\e]133;D;%s\a' $1
  fi
  typeset -gi _p9k__iterm_cmd=1
}
function _p9k_iterm2_preexec() {
  if [[ -t 1 ]]; then
    # As with kitty's shell integration (internal/p10k.zsh:9137, 8918-8923) the start mark carries the command line, URL-encoded.
    () {
      emulate -L zsh -o extended_glob -o no_multibyte
      local MATCH MBEGIN MEND
      builtin printf '\e]133;C;cmdline_url=%s\a' "${1//(#m)[^a-zA-Z0-9"\/:_.-!'()~"]/%${(l:2::0:)$(([##16]#MATCH))}}"
    } "$1"
  fi
  typeset -gi _p9k__iterm_cmd=2
}
function _p9k_precmd_first() {
  # The status the framework's hook sees, for the tests.
  builtin print -r -- $? >>$HOME/framework-status
}
function _p9k_precmd() {
  local -i status_=$?
  _p9k_iterm2_precmd $status_
  if [[ $precmd_functions[-1] != _p9k_precmd ]]; then
    precmd_functions=(${(@)precmd_functions:#_p9k_precmd} _p9k_precmd)
  fi
}
function _p9k_preexec1() { _p9k_iterm2_preexec "$@"; }
function _p9k_preexec2() { :; }
typeset -ga preexec_functions=(_p9k_preexec1 $preexec_functions _p9k_preexec2)
typeset -ga precmd_functions=(_p9k_precmd_first $precmd_functions _p9k_precmd)
PROMPT=$'%{\e]133;A\a%}P> %{\e]133;B\a%}'
typeset -g P9K_VERSION=1.21.0
