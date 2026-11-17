#!/usr/bin/env bash
# Records the N8 performance baseline of the current app (row N8, docs/ui-next/TRACKER.md).
# Run from the repository root of a checkout where `pnpm install --frozen-lockfile` and `task packages` have run.
#   KUBERNETES_SOURCE=/abs/path/omniview-plugin-kubernetes  (checked out at the revision to measure, UI built: `pnpm --dir $KUBERNETES_SOURCE/ui install --frozen-lockfile && pnpm --dir $KUBERNETES_SOURCE/ui run build`)
#   bash docs/ui-next/baseline/run.sh <pass-directory>   e.g. docs/ui-next/baseline/raw/pass1: `collect.mjs report` reads only raw/pass<digits>/
# Every step logs the load average first; a run started under load above 2 is noisy, and the file says so.
set -euo pipefail
: "${KUBERNETES_SOURCE:?set KUBERNETES_SOURCE to a Kubernetes plugin checkout with a built ui/dist}"
RAW="${1:?give the pass directory, e.g. docs/ui-next/baseline/raw/pass1 (collect.mjs report reads only raw/pass<digits>/)}"
RUNS="${RUNS:-5}"
mkdir -p "$RAW"

load() { echo "$1 $(date -u +%FT%TZ) load: $(sysctl -n vm.loadavg 2>/dev/null || uptime)" | tee -a "$RAW/load.log"; }

# The app benchmark, legacy whole-app scenarios (cold-start, cold-start-k8s, pods, logs), 5 runs each after one discarded warmup.
# `--minify off` and `--minify on` force the minifier (off = esbuild disabled, on = esbuild), so the result does not depend on the
# app's own `build.minify`. (The recorded 2026-11-16 passes ran `--minify app` at 146c0b03, where the app config was `false`; that is `off`.)
# `--react normal` is the timing build;
# `--react profiling` is the attribution build (React Profiler on; the 2026-10/11 recorded runs used it) and is never comparable with `normal`.
for react in normal profiling; do
  for minify in off on; do
    name="app-$react-minify-$minify"
    load "start $name"
    node bench/app/run.mjs --react "$react" --minify "$minify" --label "base-$react-$minify" --runs "$RUNS" \
      --out "$RAW/$name.json" --markdown "$RAW/$name.md" > "${TMPDIR:-/tmp}/$name.log" 2>&1
    load "end   $name"
  done
done

# The render benchmark: isolated screens in Vitest browser mode (Chromium), production React.
load "start render"
pnpm bench:render > "$RAW/render.log" 2>&1
cp bench/render/results/latest.json "$RAW/render.json"
node bench/render/report.mjs > "$RAW/render.md"
load "end   render"
