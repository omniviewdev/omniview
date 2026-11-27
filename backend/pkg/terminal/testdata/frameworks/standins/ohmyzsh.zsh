# STAND-IN for the loader of oh-my-zsh (ohmyzsh/ohmyzsh, MIT; read at abfce729ab56543b976b08ef34a54b3dc57601a4):
# oh-my-zsh.sh. What it copies: it sources the files of lib/ (oh-my-zsh.sh:310 `for lib_file ("$ZSH"/lib/*.zsh)`) and then
# the theme (oh-my-zsh.sh:334-340). Here the two lib files that bite, lib/functions.zsh (omz_urlencode) and
# lib/termsupport.zsh (the titles, OSC 7 and the precmd and preexec hooks through add-zsh-hook), are the upstream files,
# unchanged, in ../vendor/ohmyzsh. The theme is the tests' own: like robbyrussell's (themes/robbyrussell.zsh-theme) it reads
# the status of the last command with %? when it draws, which is where a hook that changes $? shows. Not copied: the other
# lib files, plugins, completion, updates.
ZSH=${0:A:h:h}/vendor/ohmyzsh
source $ZSH/functions.zsh
source $ZSH/termsupport.zsh
setopt prompt_subst
PROMPT='%(?:OK:ERR) P> '
precmd_functions=(omz_status_probe $precmd_functions)
function omz_status_probe() { builtin print -r -- $? >>$HOME/framework-status }
