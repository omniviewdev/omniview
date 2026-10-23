#!/bin/bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
export GOWORK=off GOFLAGS=
cd "$ROOT"
VERSION="$(go list -modfile="$ROOT/go.mod" -m -f '{{if .Replace}}replaced{{else}}{{.Version}}{{end}}' github.com/wailsapp/wails/v3)"
case "$VERSION" in
  v3.*) ;;
  *) printf 'Root Wails dependency must be an unreplaced v3 version, got %s\n' "$VERSION" >&2; exit 1 ;;
esac
# Never overwrite a globally installed Wails CLI. Task resolves this same root
# version with go run, independent of PATH; this installer is an optional tool.
DESTINATION="$ROOT/.local/tools/wails/$VERSION"
mkdir -p "$DESTINATION"
GOBIN="$DESTINATION" go install "github.com/wailsapp/wails/v3/cmd/wails3@$VERSION"
printf '%s/wails3%s\n' "$DESTINATION" "$(go env GOEXE)"
