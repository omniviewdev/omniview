#!/bin/bash
# Verification-only build. Never installs into Homebrew, /usr/local or app state.
set -euo pipefail
umask 077
[[ "$(uname -s)" == Darwin ]] || { echo 'Native Darwin required' >&2; exit 2; }
module_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
work="$(mktemp -d "${TMPDIR:-/tmp}/history-current-cipher.XXXXXX")"
cleanup() { rm -rf -- "$work"; }
trap cleanup EXIT
commit=355d4db92d3404e71faa8088d071a71d767807f4
git init -q "$work/source"
git -C "$work/source" remote add origin https://github.com/sqlcipher/sqlcipher.git
git -C "$work/source" fetch --quiet --depth 1 origin "$commit"
git -C "$work/source" checkout --quiet --detach FETCH_HEAD
[[ "$(git -C "$work/source" rev-parse HEAD)" == "$commit" ]] || exit 3
mkdir "$work/build" "$work/include" "$work/lib"
cd "$work/build"
# Generate unchanged upstream amalgamation. Compile only our explicit provider.
"$work/source/configure" --with-tempstore=yes --enable-fts5
make -j2 sqlite3.c
flags=(-O2 -DSQLITE_HAS_CODEC -DSQLITE_TEMP_STORE=2 -DSQLITE_THREADSAFE=1
       -DSQLITE_EXTRA_INIT=sqlcipher_extra_init
       -DSQLITE_EXTRA_SHUTDOWN=sqlcipher_extra_shutdown
       -DSQLCIPHER_CRYPTO_CC -DSQLITE_ENABLE_FTS5)
xcrun clang "${flags[@]}" -I. -c sqlite3.c -o "$work/sqlite3.o"
xcrun ar rcs "$work/lib/libsqlite3.a" "$work/sqlite3.o"
cp sqlite3.h "$work/include/sqlite3.h"
cp "$work/source/LICENSE.md" "$work/sqlcipher-LICENSE.md"
cd "$module_dir"
export GOWORK=off CGO_ENABLED=1
export CGO_CFLAGS="-I$work/include -DSQLITE_HAS_CODEC"
export CGO_LDFLAGS="-L$work/lib -Wl,-search_paths_first -framework Security -framework CoreFoundation"
go build -tags libsqlite3 -o "$work/historycipherprobe" .
go vet -tags libsqlite3 ./...
otool -L "$work/historycipherprobe"
# Reject any dynamic SQLite or third-party crypto dependency, even if execution
# would otherwise pass. The only SQLite core must be our static archive.
links="$(otool -L "$work/historycipherprobe")"
case "$links" in
  *libsqlite*|*libsqlcipher*|*libcrypto*|*libtomcrypt*) echo 'Unexpected dynamic database/crypto library' >&2; exit 4 ;;
esac
"$work/historycipherprobe"
printf 'official SQLCipher source commit: %s\n' "$commit"
printf 'native architecture: %s\n' "$(uname -m)"
printf 'executable bytes: %s\n' "$(stat -f %z "$work/historycipherprobe")"
