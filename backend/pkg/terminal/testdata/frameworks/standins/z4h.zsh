# STAND-IN for z4h.zsh and its init of zsh4humans (romkatv/zsh4humans, MIT; branch v5 at
# c0c29f999635f58e2b1bdb442e633c01a1b9ecc2). What it copies:
#   fn/-z4h-enable-iterm2-integration:28-41   -z4h-iterm2-precmd prints 133;C (only after an empty Enter) and 133;D;<status>,
#                                              and OSC 1337 CurrentDir; -z4h-iterm2-preexec prints 133;C;
#   fn/-z4h-init-zle:12-36                     the hooks -z4h-set-term-title-preexec/-precmd call them and print OSC 0;
#   fn/-z4h-init-zle:33-34                     `add-zsh-hook -- preexec ...` and `add-zsh-hook -- precmd ...`.
# Not copied: everything else of z4h (the bootstrap and update, fzf, completion, the prompt: powerlevel10k).
autoload -Uz add-zsh-hook
typeset -gi _z4h_iterm_cmd=0
function -z4h-iterm2-precmd() {
  zle && return
  if (( _z4h_iterm_cmd )); then
    (( _z4h_iterm_cmd == 1 )) && builtin printf '\e]133;C;\a'
    builtin printf '\e]133;D;%s\a' $1
  fi
  builtin printf '\e]1337;CurrentDir=%s\a' "${${PWD//$'\a'/\\a}//$'\e'/\\e}"
  typeset -gi _z4h_iterm_cmd=1
}
function -z4h-iterm2-preexec() {
  builtin printf '\e]133;C;\a'
  typeset -gi _z4h_iterm_cmd=2
}
function -z4h-set-term-title-preexec() {
  -z4h-iterm2-preexec
  builtin printf '\e]0;%s\a' $1
}
function -z4h-set-term-title-precmd() {
  local -i err=$?
  builtin print -r -- $err >>$HOME/framework-status
  -z4h-iterm2-precmd $err
  builtin printf '\e]0;%s\a' ${(%):-%~}
}
add-zsh-hook -- preexec -z4h-set-term-title-preexec
add-zsh-hook -- precmd  -z4h-set-term-title-precmd
PROMPT='P> '
