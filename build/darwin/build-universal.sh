#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ]; then
  printf 'Usage: %s OUTPUT [go build flags...]\n' "$0" >&2
  exit 2
fi
output="$1"
shift
mkdir -p "$(dirname "$output")"
staging="$(mktemp -d "$(dirname "$output")/.omniview-universal.XXXXXX")"
trap 'rm -rf "$staging"' EXIT

for architecture in arm64 amd64; do
  GOWORK=off GOFLAGS= GOOS=darwin GOARCH="$architecture" CGO_ENABLED="${CGO_ENABLED:-1}" \
    go build "$@" -o "$staging/$architecture" "${BUILD_PACKAGE:-.}"
done
xcrun lipo "$staging/arm64" "$staging/amd64" -create -o "$staging/universal"
for architecture in arm64 x86_64; do
  xcrun lipo "$staging/universal" -verify_arch "$architecture"
done
chmod +x "$staging/universal"
mv "$staging/universal" "$output"
