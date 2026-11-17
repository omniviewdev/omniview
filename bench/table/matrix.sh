#!/bin/sh
# The timing matrix of row 1a.3b: every engine and workload of docs/ui-next/status/1a.3.md, 15 rounds of S, A, R and C each, interleaved.
# Takes about 75 minutes. One page build, frozen in bench/table/.dist-matrix, serves every run (its identity.json says what it was built from).
#   sh bench/table/matrix.sh [results-prefix]
set -eu
cd "$(dirname "$0")/../.."
prefix="${1:-m}"
pnpm --filter @omniviewdev/kit run build
node --input-type=module -e "const { buildPage } = await import('./bench/table/lib.mjs'); buildPage({ react: 'normal', dist: 'bench/table/.dist-matrix' });"
run() { node bench/table/run.mjs --no-build --dist bench/table/.dist-matrix --rounds 15 "$@"; }
run --engine chromium --workload w1 --tag "$prefix-chromium-w1"
run --engine webkit --workload w1 --tag "$prefix-webkit-w1"
run --engine chromium --workload w0 --tag "$prefix-chromium-w0"
run --engine webkit --workload w0 --tag "$prefix-webkit-w0"
run --engine chromium --workload w1 --cpu 4 --tag "$prefix-chromium-w1-4x"
