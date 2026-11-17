#!/usr/bin/env bash
# Starts and stops the real Go host (bin/Omniview-server, built with `OMNIVIEW_UI=next task build:server`) on a throwaway profile for the
# Pods cluster check: a private HOME holding one kubeconfig and, optionally, the Kubernetes plugin installed by directory in the channel's
# state root (the arrangement the skeleton of PR #509 was verified in; docs/ui-next/slices/1a-pods-list.md appendix A.4 and A.5).
#
#   host.sh start <name> <port> <kubeconfig> <plugin-dir|none>   plugin-dir holds bin/plugin and plugin.yaml
#   host.sh stop  <name>
#
# State lives in ${OMNIVIEW_E2E_WORK:-${RUNNER_TEMP:-/tmp}/ui-next-pods}/<name>: home/, host.log, host.pid.
# The ambient HOME and KUBECONFIG are never read by the host: the plugin reads the kubeconfig of the HOME it runs under.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
work="${OMNIVIEW_E2E_WORK:-${RUNNER_TEMP:-/tmp}/ui-next-pods}"
channel=feature-ui-next

start() {
  local name="$1" port="$2" kubeconfig="$3" plugin="$4"
  local dir="$work/$name" home="$work/$name/home"
  test -x "$root/bin/Omniview-server" || { echo "missing $root/bin/Omniview-server: run OMNIVIEW_UI=next task build:server" >&2; exit 1; }
  rm -rf "$dir"
  mkdir -p "$home/.kube"
  cp "$kubeconfig" "$home/.kube/config"
  chmod 600 "$home/.kube/config"
  if [[ "$plugin" != none ]]; then
    local installed="$home/.omniview-$channel/plugins/kubernetes"
    mkdir -p "$installed/bin" "$installed/assets"
    cp "$plugin/bin/plugin" "$installed/bin/plugin"
    cp "$plugin/plugin.yaml" "$installed/plugin.yaml"
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
  local pidfile="$work/$1/host.pid"
  if [[ -f "$pidfile" ]]; then
    kill "$(cat "$pidfile")" 2>/dev/null || true
    rm -f "$pidfile"
  fi
}

case "${1:-}" in
  start) [[ $# -eq 5 ]] || { echo "usage: host.sh start <name> <port> <kubeconfig> <plugin-dir|none>" >&2; exit 2; }; start "$2" "$3" "$4" "$5" ;;
  stop) [[ $# -eq 2 ]] || { echo "usage: host.sh stop <name>" >&2; exit 2; }; stop "$2" ;;
  *) echo "usage: host.sh start|stop ..." >&2; exit 2 ;;
esac
