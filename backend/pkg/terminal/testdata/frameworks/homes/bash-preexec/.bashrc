# Stand-in of a user of bash-preexec (rcaloras/bash-preexec README: source it at the END of the rc file, then define preexec and precmd).
PS1='P> '
HISTFILE=/dev/null
source $FRAMEWORKS/vendor/bash-preexec/bash-preexec.sh
preexec() { printf '%s\n' "$1" >>$HOME/framework-preexec; }
precmd() { printf '%s\n' "$?" >>$HOME/framework-status; }
