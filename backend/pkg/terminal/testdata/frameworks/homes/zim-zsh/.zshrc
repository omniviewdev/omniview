# Stand-in of a user of Zim: the lines of zimfw/zimfw README.md:86-92 (ZIM_HOME from ZDOTDIR, then source init.zsh).
HISTFILE=/dev/null
unsetopt PROMPT_SP
RPS1=
ZIM_HOME=${ZDOTDIR:-${HOME}}/.zim
print -r -- $ZIM_HOME >$HOME/zim-home
source ${ZIM_HOME}/init.zsh
