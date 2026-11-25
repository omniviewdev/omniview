# Omniview shell integration for fish: a vendor_conf.d file.
#
# Provenance: written for Omniview from the protocol (OSC 133 semantic prompts, OSC 7 and the 633;E / 633;P marks of
# VS Code's shell integration) and from fish's documentation of vendor_conf.d and of the fish_preexec, fish_postexec
# and fish_prompt events. No line is copied from another project's script. VS Code (MIT) and Wave (Apache-2.0) were
# read as references for the idea only; the scripts of Ghostty, kitty, iTerm2, Zed and Warp (copyleft) were not read
# for this file.
#
# The host starts fish with XDG_DATA_DIRS in front of which stands the directory this file is in, and sends two lines
# on file descriptor 3: the session's nonce, and the XDG_DATA_DIRS the user had ("s:<value>" or "u:" when it was
# unset). fish runs this file before the user's config.fish, which is never edited. The file gives XDG_DATA_DIRS back
# at once, keeps the nonce in a variable that is not exported, and installs handlers that print the marks. A fish
# started by the user inside this one finds neither the directory nor the nonce, so it has no integration.
if status is-interactive
    # fish's own read builtin does not read a socket, head does: it takes the two lines and no more.
    set -l __omniview_lines (head -n 2 <&3 2>/dev/null)
    if test (count $__omniview_lines) -eq 2; and test -n "$__omniview_lines[1]"
        set -g __omniview_nonce $__omniview_lines[1]
        if string match -q -- 's:*' $__omniview_lines[2]
            set -gx XDG_DATA_DIRS (string replace -- 's:' '' $__omniview_lines[2])
        else
            set -e XDG_DATA_DIRS
        end

        # The marks. Everything below prints only inside an OSC sequence, and nothing else.
        function __omniview_escape
            # The text stays ONE string, newlines kept: fish splits what a command substitution prints at newlines, so
            # each step is collected again (a trailing newline is dropped by that). A backslash, ';' and every control
            # byte, a newline too, becomes \xHH, as zsh's script does, so that the mark is one line free of controls. A
            # control byte is replaced for each of the 32 values, not once per character: that is bounded.
            set -l text (string sub -l 4096 -- $argv[1] | string collect)
            set text (string replace -a -- '\\' '\\\\' $text | string collect)
            set text (string replace -a -- ';' '\\x3b' $text | string collect)
            if string match -qr '[\x01-\x1f\x7f]' -- $text
                for code in (seq 1 31) 127
                    set -l hex (printf '%02x' $code)
                    set text (string replace -a -r -- "\\x$hex" "\\\\x$hex" $text | string collect)
                end
            end
            printf '%s' $text
        end

        # fish 4 prints the prompt, output and end marks (OSC 133 A, C and D) and the directory (OSC 7) itself, and
        # prints C before it runs the handlers of fish_preexec, too late for the command line that the nonce
        # vouches for, which has to come before C. So with fish 4 the host's script adds what fish does not: the
        # command line (when Enter is pressed), the directory with the nonce and the input start, and leaves the rest
        # to fish; with an older fish it prints every mark.
        set -g __omniview_native 0
        if test (string split . -- $version)[1] -ge 4 2>/dev/null
            set __omniview_native 1
        end

        function __omniview_enter
            set -l line (commandline | string collect)
            if test -n "$line"; and not commandline --paging-mode; and commandline --is-valid
                printf '\e]633;E;%s;%s\a' (__omniview_escape $line) $__omniview_nonce
            end
            commandline -f execute
        end

        function __omniview_preexec --on-event fish_preexec
            test $__omniview_native = 0; or return
            printf '\e]633;E;%s;%s\a\e]133;C\a' (__omniview_escape $argv[1]) $__omniview_nonce
        end

        function __omniview_postexec --on-event fish_postexec
            test $__omniview_native = 0; or return
            printf '\e]133;D;%d\a' $status
        end

        function __omniview_prompt --on-event fish_prompt
            # The first prompt is the end of the startup: tell the host the shell is up. fish cannot close the
            # descriptor, so it stays, with nothing left to read.
            if not set -q __omniview_ready
                set -g __omniview_ready 1
                echo ready >&3 2>/dev/null
                # Enter (and Ctrl-J, which runs the line too), unless the user has a binding of their own for it.
                if test $__omniview_native = 1
                    for key in \r \n
                        if test -z "$(bind --user $key 2>/dev/null)"
                            bind -M default $key expand-abbr __omniview_enter
                            bind -M insert $key expand-abbr __omniview_enter
                        end
                    end
                end
            end
            if test $__omniview_native = 0
                printf '\e]7;file://%s%s\a' (hostname) (string escape --style=url -- $PWD | string replace -a '%2F' '/')
            end
            printf '\e]633;P;Cwd=%s;%s\a' (__omniview_escape $PWD) $__omniview_nonce
            test $__omniview_native = 0; and printf '\e]133;A\a'
            # The user's prompt, wrapped so that the input start is printed right after it. It is wrapped again
            # when the user (or fish_config) defines another.
            if not functions fish_prompt 2>/dev/null | string match -q '*__omniview_user_prompt*'
                functions -q fish_prompt; and functions -c fish_prompt __omniview_user_prompt
                function fish_prompt
                    __omniview_user_prompt $argv
                    printf '\e]133;B\a'
                end
            end
        end
    end
end
