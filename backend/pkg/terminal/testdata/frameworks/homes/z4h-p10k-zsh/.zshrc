# Stand-in of a user of zsh4humans with its DEFAULT prompt: z4h loads powerlevel10k (fn/-z4h-init-zle:713-717, when :z4h:powerlevel10k
# channel is not none, the default), so P9K_VERSION is set and both frameworks print their own 133 marks.
HISTFILE=/dev/null
unsetopt PROMPT_SP
RPS1=
typeset -g _z4h_standin_nolog=1
source $FRAMEWORKS/standins/z4h.zsh
source $FRAMEWORKS/standins/p10k.zsh
