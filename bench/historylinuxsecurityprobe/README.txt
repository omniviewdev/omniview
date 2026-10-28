Linux Secret Service + official SQLCipher prerequisite proof (HR02)

Standalone synthetic verification only. No production history API or root
module dependency. SQLCipher encrypts the SQLite database/WAL containing
metadata, ordinary index, FTS index and synthetic snapshot/diff payload.
No plaintext database driver or storage fallback exists.

Pinned maintained dependencies:
  github.com/godbus/dbus/v5 v5.1.0 (BSD-2-Clause)
  github.com/mattn/go-sqlite3 v1.14.52 (MIT)
  official github.com/sqlcipher/sqlcipher commit
  355d4db92d3404e71faa8088d071a71d767807f4
  SQLCipher 4.20.0 community, SQLite 3.54.1 (BSD-3-Clause;
  bundled SQLite public domain; retain upstream LICENSE.md notices)
  OpenSSL 3 provider from distribution libssl-dev/libcrypto (Apache-2.0;
  retain distribution notices). No old fork or custom crypto.
Go 1.26.0+; CGO enabled; Linux C compiler and native architecture required.

Ubuntu setup and exact run (parent owns CI workflow):
  sudo apt-get update
  sudo apt-get install -y build-essential git tcl pkg-config libssl-dev \
    openssl dbus gnome-keyring libglib2.0-bin coreutils util-linux
  cd bench/historylinuxsecurityprobe
  GOWORK=off go mod download
  bash native-linux.sh
For a bounded external job: timeout 900s bash native-linux.sh
No production credentials or cloud queries are needed.

The builder fetches only the pinned official source commit, checks identity,
generates the unchanged amalgamation and compiles a private static archive
and matching header. No system library installation occurs. It sets:
  GOWORK=off CGO_ENABLED=1
  CGO_CFLAGS=-I<private>/include -DSQLITE_HAS_CODEC
  CGO_LDFLAGS=<private>/lib/libsqlite3.a -L<private>/lib -lcrypto -lm -ldl -lpthread
  go build -tags libsqlite3 ...
Codec flags: SQLITE_HAS_CODEC, SQLITE_TEMP_STORE=2, SQLITE_THREADSAFE=1,
SQLITE_EXTRA_INIT=sqlcipher_extra_init,
SQLITE_EXTRA_SHUTDOWN=sqlcipher_extra_shutdown,
SQLCIPHER_CRYPTO_OPENSSL, SQLITE_ENABLE_FTS5.
ldd must show OpenSSL libcrypto and must NOT show dynamic SQLite/SQLCipher.
The proof rejects wrong codec/core/provider/options on two simultaneously
held actual pool connections. URI keying happens before mattn startup
PRAGMAs. DSNs/SQL/errors containing keys are never logged.

Build and go vet run BEFORE isolation of runtime HOME. Go caches stay
outside owned runtime state; readonly Go module files cannot break runtime
cleanup. Earlier PR183 Ubuntu run40734298355/job122978578015 passed all
three vault JSON assertions but FAILED cleanup because that older runner
built after HOME isolation. This extension removes that build step rather
than chmodding caches or ignoring cleanup failures. That old CI result is
not a passing job. Native Ubuntu AMD64 encrypted CI subsequently passed in
run40748839203/job123029744193, including checked cleanup.

smoke.sh accepts only PROOF_BINARY produced by native-linux.sh. It creates
fresh owner-only HOME/XDG paths and an isolated dbus-run-session, starts an
owned foreground gnome-keyring daemon, and supplies a random synthetic
password over stdin, never argv. Daemon startup is bounded to five seconds.
No user bus/daemon is touched. Per-process credential/database work has a
30-second context; wrapper/session commands also have timeout bounds.
On every exit the owned daemon and temporary state are cleaned up.
Never invoke smoke.sh inner against an existing/user session.

Inside the owned disposable session only:
  HISTORY_PROOF_OWNED_SESSION=1 /absolute/path/to/proof available
Without a running Secret Service:
  dbus-run-session -- /absolute/path/to/proof unavailable
The complete wrapper covers both stopped-daemon absence on the same bus
and never-present service absence on a fresh bus. Unavailable paths do
not activate the service, generate replacement keys, or open databases.
For unavailable mutation assertions, an encrypted synthetic comparison DB
is separately constructed by fixture setup, before the denied caller runs.
The denied caller must leave that actual DB unchanged and create no new DB.

Assertions: native key create/read/replace/delete; actual vault-read keys
used for encrypted DB/backup/rekey; exact codec identity/options/provider;
two keyed pool connections; populated real WAL; DB/WAL/SHM owner UID and
0600 permissions, fresh 0700 parent; metadata/payload/index/FTS sentinels
absent from encrypted artifacts; keyless/wrong-key rejection; payload/FTS
reopen; distinct-key encrypted export/restore; rekey retires old key;
deleted/locked/absent vault gates prevent actual DB mutation/new creation.
The Secret Service plain session algorithm uses authenticated local D-Bus;
this is NOT a claim of encrypted transport or daemon at-rest internals.

Containment is ONLY preexisting DB/WAL/SHM symlink rejection. No race-proof
SQLite VFS/os.Root guarantee, hostile same-UID/plugin/root isolation,
hardlink/inherited-ACL proof, signed-app access policy, production schema,
crash-safe rotation, physical erasure, or full HR02 acceptance is claimed.
The database has synthetic snapshot/diff bodies, not a production history
implementation. No signed/native Ubuntu desktop behavior is inferred.

Artifact identity is emitted by the builder: official source commit,
Linux architecture, OpenSSL version, executable SHA256/size, private static
archive SHA256, amalgamation SHA256. Runtime evidence must distinguish
Linux ARM64 Docker on Darwin ARM64 from native Ubuntu AMD64 CI.

Observed Linux ARM64 container execution 2026-10-28:
  Docker Desktop Linux ARM64 on Darwin ARM64, golang:1.26-bookworm.
  Container build/proof/cleanup ran as unprivileged UID 10001, not root,
  with module bind-mounted read-only. No AMD64 CPU/emulation claim.
  go build, go vet, encrypted/locked/retired-key proof, stopped-daemon
  absence proof, fresh-bus absence proof and cleanup all exited zero.
  OpenSSL 3.0.22 25 Aug 2026, libcrypto.so.3.
  Executable SHA256:
    6e0fa458195c98d452819dc9a0d44936ed71a68ecad4561101d8c0edd21d2d37
  Executable bytes: 6648656.
  Private static codec archive SHA256:
    cabfffd722cea33b4df9e54920ee3977a180337c0f0e2bac98cde92cdbedbf50
  Official generated amalgamation SHA256:
    8cd2347d18886fee4651153fabeeeffb7cec008700987dab1c00261febc4220f
  Expected SQLCipher wrong-key HMAC errors were visible without key/SQL
  disclosure; they are not suppressed to manufacture success.
  All owned runtime/build state was removed; no artifact binary is shipped.

Observed native Ubuntu AMD64 CI execution 2026-10-28:
  https://github.com/omniviewdev/omniview/actions/runs/40748839203/job/123029744193
  Head fdd73376e9d2aade8030fe026cb9c34d797ca544; OpenSSL 3.0.13
  maintained Ubuntu package; actual encrypted executable and isolated real
  Secret Service lifecycle passed, including locked/retired/absent custody,
  private artifacts, fresh-bus refusal and checked cleanup.
  Executable SHA256:
    f56680e213806e5d46b71c27611037d32110c8975ef68ff3919ea7def3158ef3
  Executable bytes: 7062656.
  Private static codec archive SHA256:
    b417c9ab064c289dd6a6d6e6a4c9105d061116e76c247bc2cabe6c8e4c5d9baf
  This does not establish signed desktop packaging, interactive prompts,
  logout handling, race-proof containment or production history acceptance.
