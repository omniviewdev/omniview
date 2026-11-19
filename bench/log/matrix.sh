#!/bin/sh
# The matrix of the log bench (docs/ui-next/baseline/2026-11-19-log.md): the follow and scroll workloads, search, the exact counts and, in Chromium, memory, each 10 rounds, interleaved.
# Takes about 90 minutes. One page build (and one with an overscan of 30) serves every run; the identity.json beside each build says what it was made of.
#   sh bench/log/matrix.sh [results-prefix]
set -eu
cd "$(dirname "$0")/../.."
prefix="${1:-m1}"
pnpm --filter @omniviewdev/kit run build
node --input-type=module -e "const { buildPage } = await import('./bench/log/lib.mjs'); buildPage({ react: 'normal', dist: 'bench/log/.dist-matrix' }); buildPage({ react: 'normal', dist: 'bench/log/.dist-matrix-o30', overscan: 30 });"
run() { node bench/log/run.mjs --no-build --dist bench/log/.dist-matrix --rounds 10 "$@"; }
for engine in chromium webkit; do
  run --engine "$engine" --workload follow --configs kit:1000,control:1000,kit:10000,control:10000,kit:50000,control:50000 --tag "$prefix-$engine-follow"
  run --engine "$engine" --workload scroll --configs kit,control,kit/30 --tag "$prefix-$engine-scroll"
  node bench/log/search.mjs --engine "$engine" --no-build --dist bench/log/.dist-matrix --rounds 10 --tag "$prefix-$engine-search"
  node bench/log/counts.mjs --engine "$engine" --tag "$prefix-$engine-counts"
done
node bench/log/memory.mjs --no-build --dist bench/log/.dist-matrix --rounds 10 --tag "$prefix-chromium-memory"
node bench/log/analyze.mjs "$prefix" --json "bench/log/results/$prefix-summary.json" --markdown "bench/log/results/$prefix-tables.md" > /dev/null
echo "$prefix: done; node bench/log/analyze.mjs $prefix prints the tables"
