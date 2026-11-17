#!/usr/bin/env bash
# Bundle bytes of the current app and of the OMNIVIEW_UI=next tree, unminified and minified (row N8).
#   bash docs/ui-next/baseline/bytes.sh [raw-directory]
# Run from the repository root after `pnpm install --frozen-lockfile` and `task packages`.
# Each variant is built to a scratch directory with `--sourcemap hidden` (maps are read for the contributor table only and are not
# counted). `--minify false` / `--minify esbuild` are passed explicitly, so the result does not depend on the app's `build.minify`.
set -euo pipefail
RAW="${1:-docs/ui-next/baseline/raw}"
SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/n8-dist.XXXXXX")"
export NODE_OPTIONS=--max-old-space-size=16384   # a source-map build of the 23 MB chunk needs more than the 4 GB default
mkdir -p "$RAW"

build() { # <flavour> <minify> <label>
  local flavour="$1" minify="$2" label="$3"
  OMNIVIEW_UI="$flavour" OMNIVIEW_BUILD_OUTPUT_DIRECTORY="$SCRATCH/$label" \
    pnpm exec vite build --minify "$minify" --sourcemap hidden > "$SCRATCH/$label.log" 2>&1
  node docs/ui-next/baseline/collect.mjs bytes "$SCRATCH/$label" "$label" "$RAW/bytes-$label.json"
}

build current false current-shipped
build current esbuild current-minified
build next false next-shipped
build next esbuild next-minified
rm -rf "$SCRATCH"
