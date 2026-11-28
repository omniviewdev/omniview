# Stand-in of a user of starship: `eval "$(starship init zsh)"` at the end of .zshrc (starship.rs/guide).
HISTFILE=/dev/null
unsetopt PROMPT_SP
RPS1=
export PATH=$FRAMEWORKS/standins:$PATH
export STANDIN_STATUS_LOG=$HOME/framework-status
eval "$(starship init zsh)"
