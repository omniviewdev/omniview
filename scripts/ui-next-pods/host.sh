#!/usr/bin/env bash
# Starts and stops the real Go host (bin/Omniview-server, built with `OMNIVIEW_UI=next task build:server`) on a throwaway profile for the
# Pods cluster check: a private HOME holding one kubeconfig and, optionally, a plugin installed by directory in the channel's state root (the
# arrangement the seam check of ui-next/plugins/e2e builds for its fixtures, and the N19c proof ran the Kubernetes plugin in).
#
#   host.sh start <name> <port> <kubeconfig> <plugin-dir|none>   plugin-dir is the plugin as its archive lays it out: plugin.yaml, bin/plugin, assets/
#   host.sh stop  <name>
#
# The plugin is installed whole, under the id its plugin.yaml names. The host serves its interface from `assets/` (`/_/plugins/<id>/assets/entry.js`), so a
# directory without a bundle installs a plugin with no interface: that is how the third negative control is made. Nothing is built or generated here.
#
# State lives in ${OMNIVIEW_E2E_WORK:-${RUNNER_TEMP:-/tmp}/ui-next-pods}/<name>: home/, host.log, host.pid.
# The ambient HOME and KUBECONFIG are never read by the host: the plugin reads the kubeconfig of the HOME it runs under.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
work="${OMNIVIEW_E2E_WORK:-${RUNNER_TEMP:-/tmp}/ui-next-pods}"
channel=feature-ui-next

# The id a plugin.yaml names, the way the plugin's own packaging reads it (hack/package.sh of the plugin repository).
plugin_id() {
  local id
  id="$(sed -n 's/^id:[[:space:]]*//p' "$1/plugin.yaml" | head -n 1 | tr -d '[:space:]')"
  [[ "$id" =~ ^[a-z0-9][a-z0-9-]*$ ]] || { echo "invalid plugin id '$id' in $1/plugin.yaml" >&2; exit 1; }
  echo "$id"
}

start() {
  local name="$1" port="$2" kubeconfig="$3" plugin="$4"
  local dir="$work/$name" home="$work/$name/home"
  test -x "$root/bin/Omniview-server" || { echo "missing $root/bin/Omniview-server: run OMNIVIEW_UI=next task build:server" >&2; exit 1; }
  if [[ "$plugin" != none ]]; then
    test -f "$plugin/plugin.yaml" || { echo "$plugin holds no plugin.yaml: it must be the plugin as its archive lays it out" >&2; exit 1; }
    test -f "$plugin/bin/plugin" || { echo "$plugin holds no bin/plugin" >&2; exit 1; }
  fi
  rm -rf "$dir"
  mkdir -p "$home/.kube"
  cp "$kubeconfig" "$home/.kube/config"
  chmod 600 "$home/.kube/config"
  if [[ "$plugin" != none ]]; then
    local installed
    installed="$home/.omniview-$channel/plugins/$(plugin_id "$plugin")"
    mkdir -p "$installed"
    cp -R "$plugin/." "$installed/"
  fi
  env -u KUBECONFIG HOME="$home" OMNIVIEW_CHANNEL="$channel" WAILS_SERVER_HOST=127.0.0.1 WAILS_SERVER_PORT="$port" \
    nohup "$root/bin/Omniview-server" >"$dir/host.log" 2>&1 &
  echo $! >"$dir/host.pid"
  for _ in $(seq 1 120); do
    if curl -fsS -o /dev/null "http://127.0.0.1:$port/" 2>/dev/null; then
      echo "host $name listening on http://127.0.0.1:$port/ (plugin: $plugin)"
      return 0
    fi
    kill -0 "$(cat "$dir/host.pid")" 2>/dev/null || { echo "host $name exited during start" >&2; tail -n 40 "$dir/host.log" >&2; exit 1; }
    sleep 0.5
  done
  echo "host $name did not answer on port $port in 60 s" >&2
  tail -n 40 "$dir/host.log" >&2
  exit 1
}

stop() {
  local pidfile="$work/$1/host.pid" pid
  if [[ -f "$pidfile" ]]; then
    pid="$(cat "$pidfile")"
    kill "$pid" 2>/dev/null || true
    # Wait for the exit so a stale host cannot hold the port of the next run; SIGKILL after 10 s.
    for _ in $(seq 1 50); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.2
    done
    if kill -0 "$pid" 2>/dev/null; then
      kill -KILL "$pid" 2>/dev/null || true
    fi
    rm -f "$pidfile"
  fi
}

case "${1:-}" in
  start) [[ $# -eq 5 ]] || { echo "usage: host.sh start <name> <port> <kubeconfig> <plugin-dir|none>" >&2; exit 2; }; start "$2" "$3" "$4" "$5" ;;
  stop) [[ $# -eq 2 ]] || { echo "usage: host.sh stop <name>" >&2; exit 2; }; stop "$2" ;;
  *) echo "usage: host.sh start|stop ..." >&2; exit 2 ;;
esac
