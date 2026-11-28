# Stand-in of a user of starship: `starship init fish | source` in config.fish.
set -g fish_greeting
fish_add_path $FRAMEWORKS/standins
set -gx STANDIN_STATUS_LOG $HOME/framework-status
starship init fish | source
