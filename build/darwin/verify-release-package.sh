#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  printf 'Usage: %s APP_OR_DMG\n' "$0" >&2
  exit 2
fi
input="$1"
staging=""
mounted=false
cleanup() {
  if [ "$mounted" = true ]; then hdiutil detach "$staging/mount"; fi
  if [ -n "$staging" ]; then rm -rf "$staging"; fi
}
trap cleanup EXIT
case "$input" in
  *.dmg)
    staging="$(mktemp -d "${TMPDIR:-/tmp}/omniview-package.XXXXXX")"
    mkdir "$staging/mount"
    hdiutil attach -nobrowse -readonly -mountpoint "$staging/mount" "$input"
    mounted=true
    app="$staging/mount/Omniview.app"
    ;;
  *.app) app="$input" ;;
  *) printf 'Expected an .app bundle or .dmg archive\n' >&2; exit 2 ;;
esac

for executable in Omniview omniview-dev; do
  binary="$app/Contents/MacOS/$executable"
  test -f "$binary"
  test -x "$binary"
  test ! -L "$binary"
  xcrun lipo "$binary" -verify_arch arm64 x86_64
  codesign --verify --strict "$binary"
done
codesign --verify --deep --strict "$app"
"$app/Contents/MacOS/omniview-dev" --help
