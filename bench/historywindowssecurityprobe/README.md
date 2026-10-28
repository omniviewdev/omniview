# Native Windows encrypted Resource History proof

Standalone HR02 acceptance command, not production storage. Successful execution requires actual SQLCipher encryption, WinCred keys, and real SQLite-created WAL/SHM under a private Windows DACL. The baseline encrypted proof passed [native Windows CI run 40748839203, job 123029744258](https://github.com/omniviewdev/omniview/actions/runs/40748839203/job/123029744258), including strict sidecar ownership. The subsequent real vault-gated missing-key-open and early token-owner checks require a new native CI run; that baseline does not verify these changes. Darwin cross-builds do not establish runtime evidence.

## Native CI prerequisites and command

Use `windows-latest`, Windows AMD64 Go **1.26+**, MSYS2 **MINGW64**, and these maintained MSYS2 packages:

```text
git
make
mingw-w64-x86_64-gcc
mingw-w64-x86_64-openssl
mingw-w64-x86_64-tcl
mingw-w64-x86_64-pkgconf
```

Parent workflow owns setup-go and `msys2/setup-msys2@v2` with `msystem: MINGW64`, the package list above, and Go available in the MSYS shell PATH. No custom crypto bundle, system-wide library installation, or arbitrary external installer is used by this command. From the repository root, under `shell: msys2 {0}`:

```sh
bash bench/historywindowssecurityprobe/native-windows.sh
```

The script requires native Windows Go, GCC targeting `x86_64-w64-mingw32`, and MSYS2 OpenSSL 3. It sets `GOWORK=off`, `CGO_ENABLED=1`, `CC=gcc`; builds the pinned official SQLCipher amalgamation into a private static `libsqlite3.a`; exposes only its private header/archive paths to the maintained mattn driver using `-tags libsqlite3`; and links maintained MSYS2 OpenSSL. The runtime DLL remains on MINGW64 PATH. It runs focused module tests, vet, and the actual executable. Source fetch, compilation, tests, linking checks, smoke, or cleanup failures are nonzero. Temporary source/build/executable artifacts are removed by the shell trap; owned vault items and database directory are removed by the executable's deferred cleanup. A killed process/machine cannot guarantee deferred cleanup.

The executable emits redacted structured JSON; the script records native architecture, exact Go/GCC/OpenSSL versions, installed MSYS2 package versions, official source commit, executable/archive/OpenSSL DLL/license SHA256, and imported DLL identities. The private SQLite archive must not resolve to any dynamic SQLite/SQLCipher core. Exact codec/provider/core/options are additionally admitted on each of two genuinely open pooled connections. Raw SQL errors are not logged because ATTACH/rekey SQL and connection URIs contain synthetic key material. No key is passed in process arguments.

Direct smoke after this script's private build is the executable invocation inside the script, not a separately configured `go run .`. An ordinary build without the pinned encrypted archive cannot pass runtime identity checks. No-CGO builds explicitly fail before vault access; unsupported non-Windows builds do not build. No unsupported mode can report the vault-only subset as encrypted acceptance.

## Pins, licenses, and artifact policy

- `github.com/mattn/go-sqlite3 v1.14.52`: MIT. Maintained driver, `libsqlite3` tag; no stale bundled codec.
- Official SQLCipher **4.20.0**, commit [`355d4db92d3404e71faa8088d071a71d767807f4`](https://github.com/sqlcipher/sqlcipher/tree/355d4db92d3404e71faa8088d071a71d767807f4): [BSD-3-Clause](https://github.com/sqlcipher/sqlcipher/blob/355d4db92d3404e71faa8088d071a71d767807f4/LICENSE.md). Embedded upstream SQLite **3.54.1** is public domain. Required options: `HAS_CODEC`, `ENABLE_FTS5`, `TEMP_STORE=2`, `THREADSAFE=1`; explicit SQLCipher extra init/shutdown and OpenSSL provider.
- OpenSSL **3.x**, maintained MSYS2 `mingw-w64-x86_64-openssl`: Apache-2.0. Exact resolved version/package/DLL hash is recorded per run, not falsely claimed as a fixed package version. Provider admission requires `openssl`; the build script rejects another OpenSSL major/provider DLL. The executable identity is recorded with that provider artifact.
- `golang.org/x/sys v0.49.0`: BSD-3-Clause. Go standard library: Go BSD-3-Clause license. Native WinCred/security APIs ship with Windows.

No proof binary is distributed by this module. A later production distribution must ship applicable notices/licenses and establish reproducible packaged-toolchain provenance; runner package receipts do not establish release-binary reproducibility or signing.

## Assertions

- Native `CredWriteW`, `CredReadW`, `CredDeleteW`, `CredFree`: generic per-user credentials with local-machine persistence. Unique random targets only; no enumeration or production target access. Create/read/replace/delete/missing/repeated-delete/explicit fresh recreation are exercised. `ERROR_NOT_FOUND` is required before cleanup ownership is registered. Existing synthetic targets survive freshness rejection.
- All keys are synthetic random 256-bit values. Original DB, distinct-key backup and rekey credentials use owned targets. Missing keys never regenerate implicitly. Native credential blobs, including rejected shapes, are wiped before `CredFree`; caller Go buffers are wiped on exit.
- The fresh root has a protected DACL with exactly current user and SYSTEM full-control ACEs, `OI/CI` inheritance only. SYSTEM is retained for OS maintenance. Explicit DB/backup files have protected user/SYSTEM DACLs at atomic creation. Actual SQLite sidecars inherit only these private ACEs; inherited broad allows, unexpected trustees/rights/types, unexpected artifacts and reparse artifacts are rejected. Each scanned artifact must retain the current user owner. An early native `TokenOwner` check requires the token default owner to equal the current user, before any database or vault-key creation; unsupported owners such as Administrators fail with an explicit diagnosis. This does not mutate tokens, repair ACLs, or broaden the owner policy. Use a user-owned/non-SYSTEM runner execution context.
- URI key admission occurs before mattn initialization PRAGMAs. Both held pooled connections require exact SQLCipher `4.20.0 community`, SQLite `3.54.1`, provider `openssl`, and required compile options. Missing/wrong DB keys must fail.
- Actual evidence metadata and snapshot-like payload are stored in ordinary tables; actual search index text is stored in FTS5 and queried successfully. Populated actual `history.db-wal` and `history.db-shm` must exist. DB/WAL/SHM and other remaining owned artifacts are scanned for all three plaintext sentinels and checked for private DACLs. DB/backup plaintext SQLite headers are forbidden.
- Normal initial, reopened, backup and rotated DB opens all use the same real vault-gated entry path: native vault lookup, deferred key wipe, then `openCipher`. Vault-backed DB close/reopen preserves payload. `sqlcipher_export` creates an independently keyed encrypted backup without a plaintext intermediate; deliberately raw keyless and original-key opens fail, and vault-backed backup-key reopen preserves payload.
- Checkpoint plus DELETE-journal transition precedes rekey. The old key fails after rekey; a new vault-loaded key reopens the payload through the normal vault-gated entry path. Native key retirement is verified. After retirement, that same entry path attempts both the existing ciphertext and a fresh absent path: both must return native `ERROR_NOT_FOUND` with no DB handle, the existing ciphertext hash must remain unchanged, and the fresh path must remain absent. Final artifacts are rescanned.

Tests cover ACL trustee/rights/inheritance boundaries, malformed key lengths/NUL targets, exposed credential-blob buffer wiping for valid/invalid credential shapes, native existing-target preservation, and Windows drive-path/key URI construction. The wiping unit test uses Go-owned backing memory; the separate real WinCred lifecycle exercises the native read/copy/wipe/free path. Native tests and smoke must pass on Windows before acceptance is claimed. Only no-CGO Windows cross-builds and shell syntax checks are available on the Darwin host; they cannot verify the encrypted executable.

## Threat and acceptance limits

WinCred/DACLs do not isolate malicious same-user code. Administrator/SYSTEM privilege, debugging, process memory capture, compromised OS, runtime copies and paging remain outside this boundary. No physical-erasure claim is made. All OS vault failures, including access denial/unavailable logon session, fail explicitly; there is no plaintext fallback. The proof does not lock the runner's vault and does not claim all locked/logon-state behaviors were exercised.

This proves mechanics only after native CI passes: no production schema, signed app/package proof, hostile plugin isolation, crash-safe key rotation, retention policy, or full Resource History acceptance. Transient rollback-journal DACLs are bounded by the directory inheritance policy but are not claimed as separately observed while populated. Sidecar/header/sentinel checks are not a general cryptographic audit of SQLCipher or OpenSSL.
