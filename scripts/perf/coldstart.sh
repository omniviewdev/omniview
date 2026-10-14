#!/usr/bin/env bash
# Measure cold-start time of the native macOS app.
#
# Builds the production bundle (task package), then launches it N times with a
# throwaway state directory and waits for the frontend to report that the shell
# is interactive (DiagnosticsClient.ReportStartupReady). The app quits itself
# after reporting. Prints per-run timings and min/median/max.
#
#   scripts/perf/coldstart.sh [-n RUNS] [--no-build] [--app PATH] [--fresh]
#                             [--timeout SECS] [--json FILE]
#
# Metrics (milliseconds; "launch" is just before `open -n`):
#   total        launch -> shell interactive (first frame painted after the router renders)
#   exec         launch -> Go process start (LaunchServices + exec)
#   webview      launch -> webview navigation start (Go init, services, window)
#   frontend     webview navigation start -> shell interactive
#   react_commit webview navigation start -> router's first commit
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNS=5
BUILD=1
APP="$ROOT/bin/Omniview.app"
FRESH=0
TIMEOUT=60
JSON_OUT=""

usage() { sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    -n|--runs) RUNS="$2"; shift 2 ;;
    --no-build) BUILD=0; shift ;;
    --app) APP="$2"; shift 2 ;;
    --fresh) FRESH=1; shift ;;
    --timeout) TIMEOUT="$2"; shift 2 ;;
    --json) JSON_OUT="$2"; shift 2 ;;
    -h|--help) usage 0 ;;
    *) echo "unknown argument: $1" >&2; usage 2 ;;
  esac
done

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "coldstart.sh only supports macOS" >&2
  exit 2
fi

if [[ $BUILD -eq 1 ]]; then
  echo "==> building production bundle (task package)" >&2
  (cd "$ROOT" && task package) >&2
fi

BIN="$APP/Contents/MacOS/Omniview"
if [[ ! -x "$BIN" ]]; then
  echo "app binary not found: $BIN (run without --no-build, or pass --app)" >&2
  exit 1
fi

if pgrep -f "^$BIN" >/dev/null; then
  echo "an instance of $BIN is already running; quit it first" >&2
  exit 1
fi
command -v python3 >/dev/null || { echo "python3 is required" >&2; exit 1; }

WORK="$(mktemp -d "${TMPDIR:-/tmp}/omniview-coldstart.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
RESULTS="$WORK/results.jsonl"
: >"$RESULTS"

now_ms() { perl -MTime::HiRes=time -e 'printf "%.0f\n", time * 1000'; }

# Kill any instance of this build left behind (the app ignores SIGTERM).
kill_leftovers() {
  pkill -f "^$BIN" 2>/dev/null || true
  sleep 0.5
  pkill -9 -f "^$BIN" 2>/dev/null || true
}

# run_once <label> <state dir>; appends a JSON line to $RESULTS unless label is "warmup".
# Launches through LaunchServices (open -n) so the window comes to the front:
# WebKit does not paint, and so never reports, while the window is hidden.
run_once() {
  local label="$1" state="$2" report="$WORK/report.json" log="$WORK/run-$1.log"
  rm -f "$report"
  mkdir -p "$state"

  local launch pid deadline
  launch="$(now_ms)"
  open -n -W \
    --env "OMNIVIEW_STATE_DIR=$state" \
    --env "OMNIVIEW_STARTUP_REPORT=$report" \
    --env OMNIVIEW_STARTUP_EXIT=1 \
    --stdout "$log" --stderr "$log" \
    "$APP" &
  pid=$!

  deadline=$(( $(date +%s) + TIMEOUT ))
  while [[ ! -s "$report" ]]; do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "run $label: app exited before reporting; log:" >&2
      tail -20 "$log" >&2
      return 1
    fi
    if (( $(date +%s) >= deadline )); then
      echo "run $label: no startup report after ${TIMEOUT}s; log:" >&2
      tail -20 "$log" >&2
      kill_leftovers
      return 1
    fi
    sleep 0.02
  done

  # The app quits itself after reporting; force it after 15s.
  for _ in $(seq 1 150); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.1
  done
  if kill -0 "$pid" 2>/dev/null; then
    echo "run $label: app did not quit, killing it" >&2
    kill_leftovers
  fi
  wait "$pid" 2>/dev/null || true
  sleep 1  # let the window server settle before the next launch

  [[ "$label" == "warmup" ]] && return 0
  python3 -I - "$report" "$launch" "$label" >>"$RESULTS" <<'PY'
import json, sys
r = json.load(open(sys.argv[1]))
launch = int(sys.argv[2])
print(json.dumps({
    "run": int(sys.argv[3]),
    "total": round(r["ui_ready_unix_ms"] - launch),
    "exec": round(r["process_start_unix_ms"] - launch),
    "webview": round(r["nav_start_unix_ms"] - launch),
    "frontend": round(r["ui_ready_unix_ms"] - r["nav_start_unix_ms"]),
    "react_commit": round(r["ui_committed_ms"]),
    "hidden": bool(r.get("ui_hidden_at_commit")),
}))
PY
}

STATE="$WORK/state"
echo "==> $BIN" >&2
if [[ $FRESH -eq 0 ]]; then
  echo "==> warm-up run (initialises the state directory, not counted)" >&2
  run_once warmup "$STATE"
fi
for i in $(seq 1 "$RUNS"); do
  if [[ $FRESH -eq 1 ]]; then STATE="$WORK/state-$i"; fi
  run_once "$i" "$STATE"
  echo "    run $i/$RUNS: $(tail -1 "$RESULTS")" >&2
done

python3 -I - "$RESULTS" "$JSON_OUT" "$(cd "$ROOT" && git rev-parse --short HEAD 2>/dev/null || echo unknown)" <<'PY'
import json, statistics, sys
rows = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
# WebKit does not paint hidden windows, so those runs only measure how long the
# window stayed in the background. Leave them out of the summary.
hidden = [r["run"] for r in rows if r["hidden"]]
if hidden:
    print(f"warning: window was hidden in runs {hidden}; excluded from the summary")
all_rows, rows = rows, [r for r in rows if not r["hidden"]] or rows
metrics = ["total", "exec", "webview", "frontend", "react_commit"]
summary = {m: {
    "min": min(r[m] for r in rows),
    "median": statistics.median(r[m] for r in rows),
    "max": max(r[m] for r in rows),
} for m in metrics}
print(f"cold start, {len(rows)} runs, commit {sys.argv[3]} (ms)")
print(f"{'metric':<12}{'min':>8}{'median':>8}{'max':>8}")
for m in metrics:
    s = summary[m]
    print(f"{m:<12}{s['min']:>8}{s['median']:>8g}{s['max']:>8}")
if sys.argv[2]:
    json.dump({"commit": sys.argv[3], "runs": all_rows, "summary": summary}, open(sys.argv[2], "w"), indent=2)
PY
