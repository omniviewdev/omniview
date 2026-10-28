# HR02 / HC02 storage, privacy, and platform decision

Date: 2026-10-28. Status: **user selected encrypted history**; implementation and independent security/platform acceptance remain gated. No production store or schema is introduced.

Authoritative product decision: encrypt metadata, indexes and retained payloads, with OS credential storage for keys and no plaintext fallback. The earlier conditional metadata-only proposal is superseded, not an available profile.

## Decision and support boundary

Select SQLCipher encrypted pages as the first-release storage architecture candidate, WAL with FULL synchronous durability, one serialized writer, bounded read transactions, parameterized SQL and explicit FTS5 token semantics. The isolated proof uses WissCore/go-sqlcipher v4.15.1; this is not host dependency admission. Modernc and ordinary mattn remain plaintext comparison probes only.

Encrypt database pages, metadata, payloads, indexes, journals, backups and recovery material. Force temporary SQLite work into memory; verify spill policy before release. Application-level payload encryption alone cannot protect SQLite metadata/FTS or WAL and does not satisfy this profile. Locked/unavailable key custody blocks storage, never falls back. Encryption does not authorize raw sensitive retention.

Keep evidence, admitted indexes, qualified coverage and recovery changes in one transaction. A busy/full/corrupt failure cannot advance recovery. Do not keep readers open for UI pagination.

Initial native encrypted proof targets macOS ARM64 local single-user storage. Existing Linux container execution and Windows/Intel macOS cross-build evidence concern the **plaintext comparison module only**. They do not establish SQLCipher or native key custody support. No target has production history acceptance. Windows requires real NTFS/DACL and key custody execution; Linux requires a supported desktop/keyring and filesystem execution; Intel macOS requires native signed desktop/runtime evidence. Network shares, removable volumes, synchronized folders and multi-user/shared databases are unsupported first-release storage locations.

## Existing conventions and gaps

- Host `internal/settings/store/store.go:52–84` opens bbolt at 0600, serializes JSON, reserves encryption for future work, and renames recognized corrupt input before replacement. This is not a key vault. History must not copy its automatic fresh-database recovery: that could conceal missing cited evidence and lost checkpoints.
- `backend/pkg/plugin/settings/redaction.go` excludes unknown, sensitive and password settings from inspection, including defaults/options/path metadata. Reuse its fail-closed classification principle, not its settings-specific field shape.
- Selected SDK `pkg/state/root.go` offers rooted directory operations and rejects symlink aliases. This does not prove SQLite's path-opened DB/WAL/SHM stay inside an `os.Root` during directory replacement. A real driver/VFS containment strategy and adversarial runtime proof remain required.
- Repository search found no runtime Keychain/Secret Service/Windows credential-vault adapter; Darwin build signing uses a notarization keychain profile, which is unrelated. Current invocation access generation does not establish upstream revocation. No existing setting flag can supply either missing guarantee.
- Existing modernc and mattn measurements are recorded in the prerequisite receipt. Different SQLite versions and single synthetic transactions do not establish a performance winner. Mattn additionally requires CGO/C toolchain and `sqlite_fts5`; it is not selected merely for one smaller/faster local result.

## Data admission and redaction before derivation

Classify provider input before enqueueing durable work. Start deny-by-default for unknown source schemas and fields. Allowlist bounded provenance, canonical references and operation/outcome metadata only after HC01 approval. Actor/name/location retention needs the selected profile's explicit approval; never call those fields non-sensitive by default.

Credentials, bearer tokens, cookies, authorization headers, service-account tokens, private keys, client certificates with private material, kubeconfig contents and authentication request bodies are never evidence. Do not persist them encrypted as an exception. Secret resources and authentication/authorization endpoints remain metadata-only. ConfigMaps, annotations, labels, command arguments, environment variables, error strings and arbitrary CRDs can contain secrets; resource kind alone cannot authorize their bodies.

Default representation states are `notRecorded` or `redacted`, with bounded reason codes rather than rejected values. Retained request/response projections, patches and snapshots require reviewed schema-specific redaction and access policy; encryption alone does not admit them. Safe structured summaries derive only from admitted fields, not substring scrubbing of source messages. Unknown schemas/extensions fail closed. The product scope includes encrypted retained payloads, not a narrowed metadata-only feature.

Order: validate limits/schema → classify → construct permitted projection → derive summary/search/correlation → persist atomically → publish authorized results. Never derive hashes, facets, embeddings, previews, diagnostics or export fields from forbidden values. Never include native recovery tokens in frontend cursors or logs. No AI input bypass. If raw material is discarded, later parser rebuild cannot promise reconstruction.

Production acceptance must send synthetic secrets through the real normalizer, queues, DB/WAL/SHM/temp paths, FTS and structured queries, diagnostics, export and restart recovery. This assignment does not invent that normalizer before HC01. Existing standalone tests cannot establish redaction-before-index merely by inserting a manually cleaned string.

## Keys and encryption lifecycle

Opaque recovery tokens may persist only inside encrypted backend storage, bounded and bound to the admitted partition/source/access generation. They never enter frontend cursors or diagnostics. Credentials remain outside evidence storage.

Require random per-access-partition data keys and versioned native-vault references, separated across development profiles and production. Custody targets: macOS Keychain, Windows user-scoped protected key custody, Linux Secret Service with an unlocked supported session. The standalone native macOS proof does not provide production adapters. No master key in settings, environment, command line, browser storage or adjacent file. Unsupported, denied or locked vault means locked cache; never auto-create a replacement key for an existing store.

Authenticate store/partition/key version binding. Key mismatch, tampering or loss fails closed without deleting the database. Rotation must create/verify a new encrypted generation and atomically switch ownership; retain the old key only while authorized rollback or explicitly retained backups need it. Revocation blocks operations immediately; key destruction follows bounded purge of the partition and owned backups. Best-effort memory clearing is not proof against process dumps, swap, compromised plugins or administrator access. Native lock/logout handling and signed-app entitlement behavior require real target tests.

## Permissions, partitions, offline access and revocation

Store under the managed host-owned profile root, never plugin-owned state. Unix: private owned 0700 directories and 0600 DB, WAL, SHM, backups and maintenance outputs. Reject unsafe existing ownership/modes and symlink/reparse redirects rather than repairing a foreign tree. Do not silently adopt existing files. Check parent path and SQLite sidecar creation behavior. Windows: restrictive DACL for current user and required OS principals; POSIX chmod output is not ACL evidence. Backup/sync exclusion must be documented and exercised per OS, not assumed from a hidden path.

An access partition binds host-resolved authority, authenticated subject, credential/access generation, source identity/configuration and policy version. Connection display names, endpoints and source-file paths are not authorization identities. Credentials themselves are neither partition keys nor logged hashes. Credential/role/source changes invalidate the old generation, cancel queued work and subscriptions, invalidate result leases/cursors, and prevent pending commits from making old data visible. Recheck generation in the write transaction and before result publication. New credentials cannot reuse protected partitions by matching an alias. Purge derived indexes, payloads and recovery data together; a key alone does not revoke material already returned.

First-release proposal denies offline protected browsing and exports, including previous-session cached results. Reauthorize the requested historical scope and representation before each protected operation; inability to verify means denied/locked, not stale approval. Upstream authorization to current resources does not automatically authorize historical bodies or deleted objects. Source types unable to supply an accepted historical-access decision cannot enable protected retained reads. This is a real missing authorization handoff, not satisfied by the current trusted invocation principal. Remote revocation cannot be guaranteed instant while disconnected; disclose this and do not offer an offline override. Current shared trusted frontend/plugin realm is not an isolation boundary against malicious installed plugins.

## Retention, backup, recovery and migrations

Require finite age and byte caps before acquisition starts; HR07/HR24 own measured default values. This document does not invent SLOs. Reject unbounded configuration; capacity exhaustion stops acquisition without checkpoint advancement. Pins do not override privacy revocation, hard storage caps or explicit purge. Purge evidence, FTS/derived material, recovery and qualified coverage in one transaction or block visibility until reconciliation completes. Tombstones contain only explicitly permitted bounded identifiers and expire too. Stronger redaction invalidates old projections, results and exports; do not preserve forbidden fields for reproducibility.

No automatic application backups or raw database export in the first profile. OS snapshots, cloud backup agents and user copies remain outside application control; disclose them. A future backup uses a consistent SQLite snapshot API, never a live DB-only file copy omitting WAL; encrypt under its admitted profile, record schema/policy/key versions, verify restore in isolation, and reauthorize before reads. Restore never resumes a source using stale credential generations. Backups require explicit retention and key-destruction rules; data removal from a live store does not delete external copies.

On corruption, stop affected ingestion/reads, retain original bytes privately, report bounded diagnostics and require explicit recover/rebuild/discard. Do not overwrite corruption or silently create a new empty authoritative history. Recovery replays only available approved sources and records gaps. Handle permission/I/O errors separately from corruption. Quarantine obeys byte/age caps and is not an unlimited secret archive.

Use explicit schema versions, transactional migrations and atomic version advancement, with finite disk/time estimates and preflight free-space checks. Unknown newer schema opens no writer. Failed migration rolls back DDL/version; interrupted copy/rebuild preserves the previous owned generation until verified switch. Rebuild only derived material possible from retained permitted evidence. Canonical HC01/HC03 handoffs must precede a production schema or migration ABI.

SQL DELETE, FTS deletion, `secure_delete`, checkpoint/TRUNCATE, VACUUM and unlink do not guarantee physical erasure. WAL frames, freelists, FTS segments, SSD wear leveling, APFS/NTFS snapshots, swap, crash dumps and external backups can retain bytes. Logical purge means unavailable through application queries, not forensic eradication. Encryption key destruction reduces recoverability only if every key copy and backup envelope is destroyed; it cannot recall prior exports or screenshots.

## Standalone mechanics and release gates

New disposable behavior proof adds actual competing-writer SQLITE_BUSY, committed/uncommitted recovery visibility, failed transactional DDL/version rollback, evidence-plus-FTS purge rollback/commit, and a read-only SQLite connection rejecting writes. The synthetic schema is not a production proposal. A read-only connection is defense in depth, not row authorization. No tautological redaction or mocked native keyring tests were added.

Existing known CEL failures were not rerun. No production schema, production keychain adapter, filesystem containment claim, OS disk-full/power-loss proof or platform security approval is inferred. Outstanding gates: independent security and dependency review; native target permissions/containment; historical authorization/revocation handoff; production redaction pipeline; bounded sizing; crash-safe encrypted rotation and signed-app key lifecycle. Issue #180 remains open until applicable proof and decisions are reviewed. The user resolved the encryption choice.

### Plaintext comparison execution receipt, 2026-10-28

One settled verification barrier completed with exit status 0:

```sh
GOWORK=off CGO_ENABLED=0 go run .
GOWORK=off CGO_ENABLED=0 go vet ./...
GOWORK=off CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /tmp/history-hr02-proof-linux .
docker run --rm --network none -v /tmp/history-hr02-proof-linux:/probe:ro debian:trixie-slim /probe
GOWORK=off CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -o /tmp/history-hr02-proof.exe .
GOWORK=off CGO_ENABLED=0 GOOS=darwin GOARCH=amd64 go build -o /tmp/history-hr02-proof-intel .
```

Actual native Darwin ARM64 execution and Docker Linux AMD64 execution both reported SQLite 3.54.1, WAL, FULL, FTS5, private 0600 DB/WAL/SHM, 819200 database bytes, and all existing behavioral assertions passed. Linux execution may be emulated; this is not native x86 hardware evidence. Timed 10,000-row inserts were 15 ms and 45 ms respectively, not SLOs. Windows AMD64 and Darwin AMD64 compiled only; neither executed. Vet emitted no diagnostics. Both runtime reports included exactly:

```json
{"failed_migration_ddl_and_version_rollback":true,"purge_evidence_and_fts_transaction":true,"readonly_connection_rejects_write":true,"writer_contention_no_partial_commit":true}
```

No mattn rerun was needed: its existing comparison remains the earlier standalone Darwin-only result, not new cross-platform evidence. No host build, frontend build, credentials, remote production queries or managed desktop launch occurred for this storage-only assignment.

## Encrypted driver and key-custody review

The isolated [encrypted module](../../../bench/historycipherprobe/README.md) pins [WissCore/go-sqlcipher v4.15.1](https://github.com/WissCore/go-sqlcipher/releases/tag/v4.15.1). Its native execution reports SQLCipher 4.15.0 community and SQLite 3.53.0. The fork resumed maintenance in 2026; a small maintainer base and a release signature asset are not an independent audit. Current official [SQLCipher v4.20.0](https://github.com/sqlcipher/sqlcipher/releases/tag/v4.20.0), published 2026-10-27, uses SQLite 3.54.1. This freshness gap blocks production admission pending dependency-owner review of intervening security/correctness changes or a current maintained linkage. Do not upgrade host dependencies from this experiment.

Candidate comparison:

| Candidate | Evidence and decision |
| --- | --- |
| WissCore v4.15.1 | Self-contained CGO SQLCipher/LibTomCrypt; native proof passes. Source flags select LibTomCrypt, despite README mentioning OpenSSL. Production admission blocked by freshness and independent review. |
| mutecomm/go-sqlcipher | Original driver; maintenance dormant since 2020 according to successor. Do not select abandoned vendored SQLite/crypto for production. |
| Current official SQLCipher with maintained Go adapter | Forward-looking alternative: current SQLCipher plus reviewed database/sql bindings and reproducible native linkage. Not exercised here; requires explicit build integration and codec/symbol verification, never linking ordinary system SQLite accidentally. Official commercial packages/support are a procurement choice, not assumed available. |
| modernc / ordinary mattn | Useful unencrypted mechanics comparisons; do not satisfy chosen history profile. |

[Driver license](https://github.com/WissCore/go-sqlcipher/blob/v4.15.1/LICENSE) contains MIT for mattn-derived Go code, BSD-style SQLCipher redistribution/notice/non-endorsement terms, SQLite public-domain notice and LibTomCrypt Unlicense. Preserve full notices in distributed source/binaries and SBOM. No GPL or mandatory commercial runtime fee appears in that inspected file; this is a license inventory, not legal approval. Review crypto export/distribution obligations and dependency security independently. The community edition does not imply FIPS certification or a paid support agreement.

CGO is mandatory. FTS5 requires `sqlite_fts5`. Native build links Security.framework and CoreFoundation for the isolated vault; `otool -L` showed only those frameworks plus libSystem and libresolv, no separately installed libcrypto. No Homebrew SQLCipher was present. Release packaging needs native C compilers, pinned source/toolchain inventories, per-architecture artifacts, signed/notarized macOS verification, Windows DLL/runtime inventory and Linux libc baseline review; a successful no-CGO comparison cross-build establishes none of these.

Key custody review: [keybase/go-keychain v0.0.1](https://github.com/keybase/go-keychain/tree/v0.0.1) offers native Security.framework item APIs under MIT. [zalando/go-keyring](https://github.com/zalando/go-keyring) uses `/usr/bin/security` on macOS; secret-bearing command arguments conflict with the selected policy, so that backend is not selected. The probe directly wraps standard Security.framework calls only to create an isolated temporary keychain without altering the login keychain, default keychain or search list. It is not custom cryptography or a VFS. These SecKeychain isolation APIs are deprecated; compiler warnings remain visible. A production signed-app adapter must use reviewed modern SecItem access controls, nonsynchronizing device-local custody and real lock/logout/upgrade behavior. This proof does not approve legacy API adoption.

### Native encrypted execution receipt

From `bench/historycipherprobe`, the settled source passed:

```sh
GOWORK=off CGO_ENABLED=1 go run -tags sqlite_fts5 .
GOWORK=off CGO_ENABLED=1 go vet -tags sqlite_fts5 ./...
GOWORK=off CGO_ENABLED=1 go build -tags sqlite_fts5 -o /tmp/history-hr02-cipher-native .
otool -L /tmp/history-hr02-cipher-native
```

Actual Darwin ARM64 output:

```json
{"encrypted_backup_distinct_key_reopen":true,"limits":"Synthetic native macOS proof only; no signed app, crash-safe rotation, hostile plugin isolation, production schema, Windows/Linux native evidence or physical erasure guarantee","locked_vault_denied":true,"metadata_payload_fts_db_wal_no_plaintext_sentinels":true,"missing_vault_key_preserves_database":true,"native_key_retirement":true,"native_private_keychain":true,"partition_key_lookup_isolated":true,"private_artifacts_scanned":9,"rekey_old_key_rejected_new_key_reopens":true,"sqlcipher":"4.15.0 community","sqlite":"3.53.0","target":"darwin/arm64","wrong_and_missing_database_key_rejected":true}
```

The process reported `owned temporary database and private keychain removed`. Vet/build succeeded with native API deprecation warnings, not warning-free. Earlier changed-source attempts exposed a C Boolean type mismatch, nonprivate freshly created native artifacts and key installation after driver initialization. Fixes use explicit C.Boolean, tighten only newly owned native vault files before storing keys, precreate the encrypted backup at 0600 and install keys at driver connection creation. They were not suppressed or rerun unchanged.

The scan covers synthetic metadata/payload/FTS sentinels in DB, populated WAL, SHM and owned native vault/backup artifacts while files exist. Sentinel absence plus wrong-key rejection is applicable encryption evidence, not forensic proof about every possible byte, temp spill, swap or snapshots. SQLCipher `rekey` proves codec mechanics, not crash-safe multi-artifact key rotation. Missing-vault-key preservation is a backend admission stop, not an upstream revocation implementation. No encrypted Linux/Windows/Intel macOS build or execution is claimed.

### Required native validation tasks

Parent owns CI integration; Windows and Linux native-vault proof owners have separate modules, not duplicate SQLCipher implementations.

1. **Dependency admission:** review upstream 4.15→4.20 changes, vendored SQLite/LibTomCrypt provenance and vulnerabilities, signature/SBOM claims, notices and maintained adapter/linkage options. Admit a reviewed exact version before host integration.
2. **macOS ARM64 and AMD64:** run the encrypted module natively with Xcode clang and FTS5; then exercise a signed/notarized app's modern native vault adapter under deny/cancel, locked/logout, upgrade and key-loss cases. Verify no default/login keychain mutation, no secret argv/environment/logs, device-local custody, private sidecars and containment during directory replacement.
3. **Windows AMD64:** native MSVC-compatible/MinGW CGO packaging decision, actual encrypted-page/FTS/WAL execution, Credential Manager native create/read/delete and missing/denied custody, owner-only DACLs for DB/WAL/SHM/temp/backup, reparse/ancestor replacement and locked-file purge. Cross-builds and POSIX mode bits cannot pass these gates.
4. **Linux AMD64 supported desktop:** native compiler/libc baseline, encrypted-page/FTS/WAL execution plus isolated Secret Service session; absent service, locked collection, denied prompt and logout must deny with no file-key/plaintext fallback. Verify actual UID/modes, symlink containment and runtime dependency inventory. Headless container crypto execution cannot establish desktop keyring support.
5. **Encrypted lifecycle failure injection:** crash before/after encrypted generation switch; preserve old key until verified recovery; encrypted consistent backups with distinct key references; restore under current authorization; disk-pressure during migration/export/rekey; tampered page authentication; temp-spill denial; purge all owned backups/derived indexes. Do not ship production schema until HC01/HC03 exist.
