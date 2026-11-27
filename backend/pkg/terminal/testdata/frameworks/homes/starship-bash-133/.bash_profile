# Stand-in of a user of starship: `eval "$(starship init bash)"` at the end of ~/.bashrc.
HISTFILE=/dev/null
export PATH=$FRAMEWORKS/standins:$PATH
export STANDIN_STATUS_LOG=$HOME/framework-status
export STANDIN_STARSHIP_OSC133=1
eval "$(starship init bash)"
