#!/usr/bin/env bash
# Native verification only. Never install libraries into the runner or app state.
set -euo pipefail
umask 077
export GOWORK=off
[[ "${MSYSTEM:-}" == MINGW64 && "$(uname -s)" == MINGW64_NT* ]] || { echo 'Native MSYS2 MINGW64 Windows required' >&2; exit 2; }
[[ "$(go env GOHOSTOS)/$(go env GOHOSTARCH)" == windows/amd64 ]] || { echo 'Native Windows AMD64 Go required' >&2; exit 2; }
[[ "$(command -v gcc)" == /mingw64/bin/gcc && "$(gcc -dumpmachine)" == x86_64-w64-mingw32 ]] || { echo 'MSYS2 MINGW64 compiler required' >&2; exit 2; }
[[ "$(command -v openssl)" == /mingw64/bin/openssl ]] || { echo 'MSYS2 MINGW64 OpenSSL required' >&2; exit 2; }
case "$(openssl version)" in 'OpenSSL 3.'*) ;; *) echo 'Maintained OpenSSL 3 required' >&2; exit 2 ;; esac
module_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
work="$(mktemp -d /tmp/history-windows-cipher.XXXXXX)"
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
# Generate the unmodified pinned upstream amalgamation; do not use a stale bundle.
"$work/source/configure" --with-tempstore=yes --enable-fts5
make -j2 sqlite3.c
flags=(-O2 -DSQLITE_HAS_CODEC -DSQLITE_TEMP_STORE=2 -DSQLITE_THREADSAFE=1
       -DSQLITE_EXTRA_INIT=sqlcipher_extra_init
       -DSQLITE_EXTRA_SHUTDOWN=sqlcipher_extra_shutdown
       -DSQLCIPHER_CRYPTO_OPENSSL -DSQLITE_ENABLE_FTS5)
gcc "${flags[@]}" -I. -I/mingw64/include -c sqlite3.c -o "$work/sqlite3.o"
ar rcs "$work/lib/libsqlite3.a" "$work/sqlite3.o"
cp sqlite3.h "$work/include/sqlite3.h"
cp "$work/source/LICENSE.md" "$work/sqlcipher-LICENSE.md"
cd "$module_dir"
export CGO_ENABLED=1 CC=gcc
# Windows-native Go needs drive paths here, not MSYS /tmp paths.
export CGO_CFLAGS="-I$(cygpath -m "$work/include") -DSQLITE_HAS_CODEC"
export CGO_LDFLAGS="-L$(cygpath -m "$work/lib") -L$(cygpath -m /mingw64/lib) -lcrypto -lws2_32 -lcrypt32 -lbcrypt"
go mod download
go build -tags libsqlite3 -o "$(cygpath -m "$work/historywindowssecurityprobe.exe")" .
go test -tags libsqlite3 ./... -count=1
go vet -tags libsqlite3 ./...
# Static private SQLite archive only. OpenSSL is the maintained MSYS2 DLL.
deps="$(objdump -p "$work/historywindowssecurityprobe.exe")"
crypto_seen=0
while IFS= read -r line; do
 case "$line" in
  *'DLL Name:'*)
   printf '%s\n' "$line"
   case "${line,,}" in
    *sqlite*|*sqlcipher*|*tomcrypt*) echo 'Unexpected dynamic database/crypto core' >&2; exit 4 ;;
    *libcrypto-3-x64.dll*) crypto_seen=1 ;;
   esac ;;
 esac
done <<< "$deps"
[[ "$crypto_seen" == 1 ]] || { echo 'Expected maintained OpenSSL DLL not linked' >&2; exit 4; }
"$work/historywindowssecurityprobe.exe"
printf 'official SQLCipher source commit: %s\n' "$commit"
printf 'native architecture: %s\n' "$(uname -m)"
go version
gcc --version
openssl version -a
pacman -Q mingw-w64-x86_64-gcc mingw-w64-x86_64-openssl mingw-w64-x86_64-tcl mingw-w64-x86_64-pkgconf git make
sha256sum "$work/historywindowssecurityprobe.exe" "$work/lib/libsqlite3.a" /mingw64/bin/libcrypto-3-x64.dll "$work/sqlcipher-LICENSE.md"
