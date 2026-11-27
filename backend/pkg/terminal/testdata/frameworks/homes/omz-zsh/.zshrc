# Stand-in of a user of oh-my-zsh: ZSH_THEME, then `source $ZSH/oh-my-zsh.sh` at the end of .zshrc.
HISTFILE=/dev/null
unsetopt PROMPT_SP
RPS1=
source $FRAMEWORKS/standins/ohmyzsh.zsh
