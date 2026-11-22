#!/usr/bin/env bash
# SDK3: re-derive the two checksums of a plugin-sdk release tag from git alone, the way a reviewer of the reviewed-releases row (internal/devsdk/policy.go) does,
# and set them beside what the Go proxy and the checksum database say and what the host's own files hold.
#
#   docs/ui-next/status/SDK3/derive-sums.sh <TAG>        from the root of a host worktree, for example: derive-sums.sh v0.22.0
#
# The row is the plugin channel's trust root: published-mode dev workspaces are admitted by comparing a consumer's go.sum to it, so a wrong row would admit
# a release nobody reviewed. The three sources below do not share a step: (1) the tag cloned from GitHub, its tree turned into the module zip by golang.org/x/mod/zip
# (what `go` and the proxy do) and hashed by `go mod download` from a file:// proxy built from that zip; (2) the Go module proxy's bytes, which is where `go get` took go.sum's
# lines; (3) the checksum database's signed record. The script fails unless the three agree with each other, with go.sum (root and nested module) and with the row.
# Nothing is written outside a temporary directory. Go runs as CI runs it: GOWORK=off GOTOOLCHAIN=local GOFLAGS=.

set -euo pipefail

SDK_MODULE=github.com/omniviewdev/plugin-sdk
SDK_REPOSITORY=omniviewdev/plugin-sdk
TAG="${1:?usage: derive-sums.sh <TAG>   (for example v0.22.0)}"
[[ "$TAG" =~ ^v0\.[0-9]+\.[0-9]+$ ]] || { echo "derive: $TAG is not a release tag of the form v0.MINOR.PATCH" >&2; exit 2; }
[ -f go.mod ] && grep -q '^module github.com/omniviewdev/omniview$' go.mod || { echo "derive: run it from the root of the host worktree" >&2; exit 2; }
export GOWORK=off GOTOOLCHAIN=local GOFLAGS=

fail() { echo "derive: $*" >&2; exit 1; }
work="$(mktemp -d)"
trap 'chmod -R u+w "$work" 2>/dev/null; rm -rf "$work"' EXIT   # the module cache go fills is read-only

echo "== (1) from git: the tag cloned from GitHub, its archive turned into the module zip, hashed by go"
git clone --quiet --depth 1 --branch "$TAG" "https://github.com/$SDK_REPOSITORY" "$work/clone" 2>/dev/null
commit="$(git -C "$work/clone" rev-parse HEAD)"
echo "$TAG -> $commit (the tag as an object: $(git -C "$work/clone" cat-file -t "$TAG"))"
mkdir "$work/src" "$work/tool"
git -C "$work/clone" archive "$TAG" | tar -x -C "$work/src"
cat >"$work/tool/go.mod" <<'EOF'
module derive

go 1.27.0

require golang.org/x/mod v0.42.0
EOF
cat >"$work/tool/main.go" <<'EOF'
// Command derive writes the module zip of a source tree in the layout of a Go module proxy (the work `go` and a proxy do for a tag).
package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"time"

	"golang.org/x/mod/module"
	modzip "golang.org/x/mod/zip"
)

func main() {
	src, module_, version, out := os.Args[1], os.Args[2], os.Args[3], os.Args[4]
	dir := filepath.Join(out, filepath.FromSlash(module_), "@v")
	check(os.MkdirAll(dir, 0o755))
	zipFile, err := os.Create(filepath.Join(dir, version+".zip"))
	check(err)
	check(modzip.CreateFromDir(zipFile, module.Version{Path: module_, Version: version}, src))
	check(zipFile.Close())
	goMod, err := os.ReadFile(filepath.Join(src, "go.mod"))
	check(err)
	check(os.WriteFile(filepath.Join(dir, version+".mod"), goMod, 0o644))
	info, err := json.Marshal(struct {
		Version string
		Time    time.Time
	}{version, time.Unix(0, 0).UTC()})
	check(err)
	check(os.WriteFile(filepath.Join(dir, version+".info"), info, 0o644))
	check(os.WriteFile(filepath.Join(dir, "list"), []byte(version+"\n"), 0o644))
}

func check(err error) {
	if err != nil {
		panic(err)
	}
}
EOF
(cd "$work/tool" && go mod tidy >/dev/null 2>&1 && go run . "$work/src" "$SDK_MODULE" "$TAG" "$work/proxy")
download() { # GOPROXY, then the field
  GOPROXY="$1" GOSUMDB=off GOMODCACHE="$work/modcache-$2" go mod download -json "$SDK_MODULE@$TAG" | awk -v f="\"$3\":" '$1 == f { gsub(/[",]/, "", $2); print $2 }'
}
git_module="$(download "file://$work/proxy" git Sum)"
git_gomod="$(download "file://$work/proxy" git GoModSum)"
echo "module  $git_module"
echo "go.mod  $git_gomod"

echo "== (2) the Go module proxy's bytes"
proxy_module="$(download "https://proxy.golang.org" proxy Sum)"
proxy_gomod="$(download "https://proxy.golang.org" proxy GoModSum)"
echo "module  $proxy_module"
echo "go.mod  $proxy_gomod"

echo "== (3) the checksum database"
lookup="$(curl -fsS "https://sum.golang.org/lookup/$SDK_MODULE@$TAG")"
sumdb_module="$(printf '%s\n' "$lookup" | awk -v m="$SDK_MODULE" -v v="$TAG" '$1 == m && $2 == v { print $3 }')"
sumdb_gomod="$(printf '%s\n' "$lookup" | awk -v m="$SDK_MODULE" -v v="$TAG/go.mod" '$1 == m && $2 == v { print $3 }')"
echo "module  $sumdb_module"
echo "go.mod  $sumdb_gomod"

echo "== the host's own files"
recorded() { awk -v m="$SDK_MODULE" -v v="$TAG$2" '$1 == m && $2 == v { print $3 }' "$1"; }
row="$(awk -v v="$TAG" '/Module: Module, Version: / { inrow = ($0 ~ "Version: \"" v "\"") } inrow { print } inrow && /^\t},/ { exit }' internal/devsdk/policy.go)"
row_module="$(printf '%s\n' "$row" | sed -n 's/.*ModuleSum: "\(h1:[^"]*\)".*/\1/p')"
row_gomod="$(printf '%s\n' "$row" | sed -n 's/.*GoModSum: *"\(h1:[^"]*\)".*/\1/p')"
echo "go.sum module $(recorded go.sum "")   go.mod $(recorded go.sum /go.mod)"
echo "workspace-probe go.sum module $(recorded e2e/fixtures/workspace-probe/go.sum "")   go.mod $(recorded e2e/fixtures/workspace-probe/go.sum /go.mod)"
echo "policy.go row module $row_module   go.mod $row_gomod"

for source in "$proxy_module" "$sumdb_module" "$(recorded go.sum "")" "$(recorded e2e/fixtures/workspace-probe/go.sum "")" "$row_module"; do
  [ "$source" = "$git_module" ] || fail "a module sum differs from the one derived from git ($git_module): $source"
done
for source in "$proxy_gomod" "$sumdb_gomod" "$(recorded go.sum /go.mod)" "$(recorded e2e/fixtures/workspace-probe/go.sum /go.mod)" "$row_gomod"; do
  [ "$source" = "$git_gomod" ] || fail "a go.mod sum differs from the one derived from git ($git_gomod): $source"
done
echo
echo "derive: $TAG ($commit): the module sum $git_module and the go.mod sum $git_gomod are the same from git, from the proxy, from the checksum database, in go.sum (root and nested) and in the reviewed row"
