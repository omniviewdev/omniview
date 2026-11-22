#!/usr/bin/env bash
# SDK1: move the host's plugin-sdk pin to a released tag, the way #485 moved it to v0.20.0.
#
#   docs/ui-next/status/SDK1/bump.sh <TAG>           from the root of a host worktree (the one tag name is the only input)
#   docs/ui-next/status/SDK1/bump.sh --check <TAG>   after the two files below are written: prove the tree states the bump, then run the tests that depend on it
#
# What the first form does: checks the tag (it exists, it holds SDK #79, #80 and #81, the Go proxy and the checksum database serve it and agree),
# runs `go get` and `go mod tidy` in the root module and in the nested module that pins the SDK (e2e/fixtures/workspace-probe), and prints the two
# edits it does NOT make: FloorVersion and the new reviewed row of internal/devsdk/policy.go, and the line of docs/development-cli.md. Those are written by
# hand on purpose: a reviewed row is a statement a person makes, and the checksums are the ones printed here after they were read from the checksum
# database, not copied from the proposer's own go.sum.
# Nothing is committed. Go runs as CI runs it: GOWORK=off GOTOOLCHAIN=local, GOFLAGS empty.
#
# SDK1_SKIP_REMOTE=1 skips the checks against GitHub, the Go proxy and the checksum database (the rehearsal serves the tag from a file:// proxy).

set -euo pipefail

SDK_MODULE=github.com/omniviewdev/plugin-sdk
SDK_REPOSITORY=omniviewdev/plugin-sdk
# The first commit of the SDK that holds #79 (the error sentence), #80 (the start deadline) and #81 (plugin.yaml closed). A tag must contain it.
FIRST_COMMIT=ae56fb095c665edc0298c7a7e19cfa8bad8aabca
NESTED=(e2e/fixtures/workspace-probe)
# Every package whose tests depend on the controller's pin, the floor or the reviewed table (the red list of the pseudo-version rehearsal, 2026-11-21), and the
# four packages of the tripwires.
DEPENDENT=(./internal/devsdk/... ./internal/devworkspace/... ./internal/instance/... ./backend/pkg/plugin/devserver/... ./bench/app/...)
TRIPWIRES=(./backend/pkg/apperror/... ./backend/pkg/plugin/resource/... ./internal/mcprelay/...)

check_mode=0
if [ "${1:-}" = "--check" ]; then
  check_mode=1
  shift
fi
TAG="${1:?usage: bump.sh [--check] <TAG>   (for example v0.21.0)}"
[[ "$TAG" =~ ^v0\.[0-9]+\.[0-9]+$ ]] || { echo "bump: $TAG is not a release tag of the form v0.MINOR.PATCH" >&2; exit 2; }
[ -f go.mod ] && grep -q '^module github.com/omniviewdev/omniview$' go.mod || { echo "bump: run it from the root of the host worktree" >&2; exit 2; }

export GOWORK=off GOTOOLCHAIN=local GOFLAGS=
backtick='`'

fail() { echo "bump: $*" >&2; exit 1; }

# The h1 line go.sum holds for the tag: $1 is "" for the module, "/go.mod" for its go.mod.
recorded_sum() { awk -v m="$SDK_MODULE" -v v="$TAG$1" '$1 == m && $2 == v { print $3 }' go.sum; }

if [ "$check_mode" = 0 ]; then
  if [ "${SDK1_SKIP_REMOTE:-}" != 1 ]; then
    echo "== the tag $TAG"
    refs="$(git ls-remote "https://github.com/$SDK_REPOSITORY" "refs/tags/$TAG" "refs/tags/$TAG^{}")"
    [ -n "$refs" ] || fail "$TAG is not a tag of $SDK_REPOSITORY (the owner pushes it: SDK1-tagging.md)"
    commit="$(printf '%s\n' "$refs" | awk '/\^\{\}$/ { print $1; found = 1 } END { if (!found) exit 3 }' || true)"
    [ -n "$commit" ] || commit="$(printf '%s\n' "$refs" | awk 'NR == 1 { print $1 }')"
    echo "$TAG -> $commit"
    status="$(gh api "repos/$SDK_REPOSITORY/compare/$FIRST_COMMIT...$commit" --jq .status)"
    case "$status" in
      identical | ahead) echo "the tag holds $FIRST_COMMIT (#79, #80, #81): $status" ;;
      *) fail "$TAG ($commit) does not hold SDK commit $FIRST_COMMIT: compare says '$status'" ;;
    esac
    echo "== the Go proxy serves it"
    curl -fsS "https://proxy.golang.org/$SDK_MODULE/@v/$TAG.info"
    echo
    echo "== the checksum database"
    lookup="$(curl -fsS "https://sum.golang.org/lookup/$SDK_MODULE@$TAG")"
    sumdb_module="$(printf '%s\n' "$lookup" | awk -v m="$SDK_MODULE" -v v="$TAG" '$1 == m && $2 == v { print $3 }')"
    sumdb_gomod="$(printf '%s\n' "$lookup" | awk -v m="$SDK_MODULE" -v v="$TAG/go.mod" '$1 == m && $2 == v { print $3 }')"
    [ -n "$sumdb_module" ] && [ -n "$sumdb_gomod" ] || fail "the checksum database has no record of $TAG"
    echo "module  $sumdb_module"
    echo "go.mod  $sumdb_gomod"
  fi

  echo "== root module"
  go get "$SDK_MODULE@$TAG"
  go mod tidy
  for directory in "${NESTED[@]}"; do
    echo "== nested module $directory"
    (cd "$directory" && go get "$SDK_MODULE@$TAG" && go mod tidy)
  done

  module_sum="$(recorded_sum "")"
  gomod_sum="$(recorded_sum "/go.mod")"
  [ -n "$module_sum" ] && [ -n "$gomod_sum" ] || fail "go.sum has no lines for $SDK_MODULE $TAG"
  if [ "${SDK1_SKIP_REMOTE:-}" != 1 ]; then
    [ "$module_sum" = "$sumdb_module" ] || fail "go.sum says $module_sum, the checksum database says $sumdb_module"
    [ "$gomod_sum" = "$sumdb_gomod" ] || fail "go.sum says $gomod_sum, the checksum database says $sumdb_gomod"
  fi
  for directory in "${NESTED[@]}"; do
    nested_sum="$(awk -v m="$SDK_MODULE" -v v="$TAG" '$1 == m && $2 == v { print $3 }' "$directory/go.sum")"
    [ "$nested_sum" = "$module_sum" ] || fail "$directory/go.sum says '$nested_sum' for the module, the root says $module_sum"
  done

  printf '\n== written: go.mod and go.sum of the root module and of %s (git diff shows them).\n' "${NESTED[*]}"
  printf '\n== now write, by hand, in internal/devsdk/policy.go:\n\n\tFloorVersion = "%s"\n\n' "$TAG"
  printf 'and append to reviewedReleases (after the v0.20.0 row):\n\n\t{\n\t\tModule: Module, Version: "%s",\n\t\tModuleSum: "%s",\n\t\tGoModSum:  "%s",\n\t},\n\n' "$TAG" "$module_sum" "$gomod_sum"
  printf '== and in docs/development-cli.md, in the two places that say "currently": the source-development paragraph and "Published mode accepts a released tag" (FloorVersion is currently `%s`; the table retains v0.17.0 to v0.19.3 and v0.20.0).\n\n' "$TAG"
  printf '== then: docs/ui-next/status/SDK1/bump.sh --check %s\n' "$TAG"
  exit 0
fi

# --check
module_sum="$(recorded_sum "")"
gomod_sum="$(recorded_sum "/go.mod")"
[ -n "$module_sum" ] && [ -n "$gomod_sum" ] || fail "go.sum has no lines for $SDK_MODULE $TAG: run bump.sh $TAG first"
grep -q "^	$SDK_MODULE $TAG\$" go.mod || fail "go.mod does not require $SDK_MODULE $TAG"
for directory in "${NESTED[@]}"; do
  grep -q "^require $SDK_MODULE $TAG\$" "$directory/go.mod" || fail "$directory/go.mod does not require $SDK_MODULE $TAG"
done
grep -q "^	FloorVersion = \"$TAG\"\$" internal/devsdk/policy.go || fail "internal/devsdk/policy.go: FloorVersion is not $TAG"
row="$(awk -v v="$TAG" '
  /Module: Module, Version: / { inrow = ($0 ~ "Version: \"" v "\""); }
  inrow { print }
  inrow && /^\t},/ { exit }' internal/devsdk/policy.go)"
printf '%s\n' "$row" | grep -q "ModuleSum: \"$module_sum\"" || fail "internal/devsdk/policy.go: the $TAG row does not carry the module sum $module_sum"
printf '%s\n' "$row" | grep -q "GoModSum:  \"$gomod_sum\"" || fail "internal/devsdk/policy.go: the $TAG row does not carry the go.mod sum $gomod_sum"
[ "$(grep -cF "currently ${backtick}${TAG}${backtick}" docs/development-cli.md)" -ge 2 ] || fail "docs/development-cli.md does not say twice that the floor is currently $TAG (the source-development paragraph and the published-mode paragraph)"
echo "the tree states the bump: go.mod, go.sum, the nested module, FloorVersion, the reviewed row and the guide agree on $TAG"

echo "== tidy"
go mod tidy -diff
for directory in "${NESTED[@]}"; do (cd "$directory" && go mod tidy -diff); done

echo "== the tests that depend on the pin, the floor or the reviewed table, and the tripwires"
go build ./...
go test -count=1 "${DEPENDENT[@]}" "${TRIPWIRES[@]}"
