# Stand-in of the ~/.zshenv of zsh4humans (romkatv/zsh4humans v5, .zshenv:14-22 and the last line): it sets ZDOTDIR when it is
# unset, turns the global rc files and the rc files off while it bootstraps, and turns rcs back on at its end.
if [ -n "${ZSH_VERSION-}" ]; then
  : ${ZDOTDIR:=~}
  setopt no_global_rcs
  [[ -o no_interactive ]] && return
  setopt no_rcs
fi
print -r -- ${ZDOTDIR} >$HOME/z4h-zdotdir
setopt rcs
