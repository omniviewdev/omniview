# bash-preexec and starship together: starship sees bash-preexec and registers in its arrays.
HISTFILE=/dev/null
source $FRAMEWORKS/vendor/bash-preexec/bash-preexec.sh
export PATH=$FRAMEWORKS/standins:$PATH
export STANDIN_STATUS_LOG=$HOME/framework-status
eval "$(starship init bash)"
