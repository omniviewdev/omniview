#!/bin/bash
# Verification-only build. No system installation or user session access.
set -euo pipefail
umask 077
[[ "$(uname -s)" == Linux ]] || { echo 'Linux runtime required' >&2; exit 2; }
module_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
work="$(mktemp -d "${TMPDIR:-/tmp}/history-linux-current-cipher.XXXXXX")"
trap 'rm -rf -- "$work"' EXIT
commit=355d4db92d3404e71faa8088d071a71d767807f4
timeout 90s git init -q "$work/source"
git -C "$work/source" remote add origin https://github.com/sqlcipher/sqlcipher.git
timeout 90s git -C "$work/source" fetch --quiet --depth 1 origin "$commit"
git -C "$work/source" checkout --quiet --detach FETCH_HEAD
[[ "$(git -C "$work/source" rev-parse HEAD)" == "$commit" ]] || exit 3
mkdir "$work/build" "$work/include" "$work/lib"
cd "$work/build"
# Generate unmodified official amalgamation, then compile explicit OpenSSL codec.
timeout 120s "$work/source/configure" --with-tempstore=yes --enable-fts5 >"$work/configure.log" 2>&1
timeout 120s make -j2 sqlite3.c >"$work/make.log" 2>&1
flags=(-O2 -DSQLITE_HAS_CODEC -DSQLITE_TEMP_STORE=2 -DSQLITE_THREADSAFE=1
       -DSQLITE_EXTRA_INIT=sqlcipher_extra_init
       -DSQLITE_EXTRA_SHUTDOWN=sqlcipher_extra_shutdown
       -DSQLCIPHER_CRYPTO_OPENSSL -DSQLITE_ENABLE_FTS5)
timeout 180s cc "${flags[@]}" -I. -c sqlite3.c -o "$work/sqlite3.o"
ar rcs "$work/lib/libsqlite3.a" "$work/sqlite3.o"
cp sqlite3.h "$work/include/sqlite3.h"
cd "$module_dir"
export GOWORK=off CGO_ENABLED=1
export CGO_CFLAGS="-I$work/include -DSQLITE_HAS_CODEC"
# Exact archive path prevents resolving system plaintext SQLite. mattn's
# -lsqlite3 must resolve only to the same private archive via this -L first.
export CGO_LDFLAGS="$work/lib/libsqlite3.a -L$work/lib -lcrypto -lm -ldl -lpthread"
timeout 180s go build -tags libsqlite3 -o "$work/historylinuxsecurityprobe" .
timeout 90s go vet -tags libsqlite3 ./...
links="$(ldd "$work/historylinuxsecurityprobe")"
case "$links" in
 *libsqlite*|*libsqlcipher*|*libtomcrypt*) echo 'Unexpected dynamic database/crypto library' >&2; exit 4 ;;
esac
[[ "$links" == *libcrypto.so* ]] || { echo 'Expected maintained OpenSSL runtime provider missing' >&2; exit 4; }
printf '%s\n' "$links"
export PROOF_BINARY="$work/historylinuxsecurityprobe"
timeout 70s sh "$module_dir/smoke.sh"
printf 'official SQLCipher source commit: %s\n' "$commit"
printf 'Linux architecture: %s\n' "$(uname -m)"
printf 'OpenSSL build/runtime: '; openssl version
printf 'executable sha256 and bytes: '; sha256sum "$PROOF_BINARY"; stat -c %s "$PROOF_BINARY"
printf 'private codec archive sha256: '; sha256sum "$work/lib/libsqlite3.a"
printf 'SQLCipher amalgamation sha256: '; sha256sum "$work/build/sqlite3.c"
