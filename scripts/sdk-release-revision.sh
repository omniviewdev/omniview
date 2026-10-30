#!/usr/bin/env bash
# Prints the commit of the plugin-sdk release tag that go.mod requires.
#
# The canonical E2E and whole-app profile workflows build against that SDK
# source, so the release tag on omniviewdev/plugin-sdk is the approval of an
# SDK change: a host branch can only select a published release. Pseudo-versions
# and replace directives are refused. Needs git only, not Go, so it runs before
# toolchain setup.
set -euo pipefail

module=github.com/omniviewdev/plugin-sdk
# Tests point this at a local fixture repository.
repository=${OMNIVIEW_PLUGIN_SDK_REPOSITORY:-https://github.com/omniviewdev/plugin-sdk}
modfile=${1:-go.mod}

if grep -Eq "^[[:space:]]*(replace[[:space:]]+)?${module//./\\.}([[:space:]]|$).*=>" "$modfile"; then
  echo "::error::$modfile replaces $module; the E2E SDK must be the published release" >&2
  exit 1
fi

version=$(awk -v module="$module" '
  $1 == "require" && $2 == module { print $3; exit }
  inblock && $1 == module { print $2; exit }
  $1 == "require" && $2 == "(" { inblock = 1 }
  $1 == ")" { inblock = 0 }
' "$modfile")
if [[ ! "$version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "::error::$modfile requires $module '${version:-<none>}'; the E2E SDK must be a published release tag, not a pseudo-version" >&2
  exit 1
fi

refs=$(git ls-remote --tags "$repository" "refs/tags/$version" "refs/tags/$version^{}")
revision=$(awk -v peeled="refs/tags/$version^{}" -v plain="refs/tags/$version" '
  $2 == peeled { p = $1 }
  $2 == plain { t = $1 }
  END { print (p != "" ? p : t) }
' <<<"$refs")
if [[ ! "$revision" =~ ^[a-f0-9]{40}$ ]]; then
  echo "::error::$module $version is not a published tag on $repository" >&2
  exit 1
fi

echo "$revision"
