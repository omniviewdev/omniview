#!/bin/sh
# Run only in an owned disposable Linux environment. Never use the user's bus.
set -eu
umask 077
case "${1:-}" in
  inner)
    export HISTORY_PROOF_OWNED_SESSION=1
    # Random synthetic unlock password travels only over stdin, never argv.
    # --foreground makes this exact child PID ours to stop on every exit.
    password=$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')
    printf '%s' "$password" | gnome-keyring-daemon --foreground --unlock --components=secrets >"$HOME/daemon.log" 2>&1 &
    daemon=$!
    trap 'kill "$daemon" 2>/dev/null || :; wait "$daemon" 2>/dev/null || :' EXIT HUP INT TERM
    unset password
    i=0
    until gdbus call --session --dest org.freedesktop.DBus --object-path /org/freedesktop/DBus --method org.freedesktop.DBus.NameHasOwner org.freedesktop.secrets | /bin/grep -q true; do
      i=$((i+1)); [ "$i" -lt 50 ] || exit 1
      sleep 0.1
    done
    "$PROOF_BINARY" available
    kill "$daemon"
    wait "$daemon" || :
    trap - EXIT HUP INT TERM
    "$PROOF_BINARY" unavailable
    ;;
  '')
    root=$(mktemp -d)
    trap 'rm -rf "$root"' EXIT HUP INT TERM
    export HOME="$root/home" XDG_DATA_HOME="$root/data" XDG_CONFIG_HOME="$root/config" XDG_CACHE_HOME="$root/cache" XDG_RUNTIME_DIR="$root/runtime"
    mkdir -m 700 "$HOME" "$XDG_DATA_HOME" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$XDG_RUNTIME_DIR"
    : "${PROOF_BINARY:?Run bash native-linux.sh; unpinned builds are not accepted}"
    [ -x "$PROOF_BINARY" ]
    timeout 40s dbus-run-session -- sh "$0" inner
    timeout 10s dbus-run-session -- "$PROOF_BINARY" unavailable
    ;;
  *) exit 2 ;;
esac
