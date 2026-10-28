# HR02 / HC02 storage, privacy, and platform decision

Date: 2026-10-28. Status: **user selected encrypted history**; implementation and independent security/platform acceptance remain gated. No production store or schema is introduced.

Authoritative product decision: encrypt metadata, indexes and retained payloads, with OS credential storage for keys and no plaintext fallback. The earlier conditional metadata-only proposal is superseded, not an available profile.

## Decision and support boundary

Select SQLCipher encrypted pages as the first-release storage architecture candidate, WAL with FULL synchronous durability, one serialized writer, bounded read transactions, parameterized SQL and explicit FTS5 token semantics. The isolated proofs use maintained mattn v1.14.52 with pinned official SQLCipher 4.20.0, native CommonCrypto on macOS and maintained OpenSSL 3 on Linux/Windows. This is not host dependency admission. Modernc and ordinary bundled mattn remain plaintext comparison probes only.

Encrypt database pages, metadata, payloads, indexes, journals, backups and recovery material. Force temporary SQLite work into memory; verify spill policy before release. Application-level payload encryption alone cannot protect SQLite metadata/FTS or WAL and does not satisfy this profile. Locked/unavailable key custody blocks storage, never falls back. Encryption does not authorize raw sensitive retention.

Keep evidence, admitted indexes, qualified coverage and recovery changes in one transaction. A busy/full/corrupt failure cannot advance recovery. Do not keep readers open for UI pagination.

Native encrypted proof executables have run on macOS ARM64, Intel macOS, Ubuntu AMD64 and Windows AMD64, with their corresponding native vaults and filesystem checks; see the CI receipt below. These are synthetic prerequisite proofs, not signed desktop runtime or production history acceptance. Native desktop custody, race-proof containment and packaged application behavior remain release gates on every supported target. Network shares, removable volumes, synchronized folders and multi-user/shared databases are unsupported first-release storage locations.

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

Require random per-access-partition data keys and versioned native-vault references, separated across development profiles and production. Custody targets: macOS Keychain, Windows user-scoped protected key custody, Linux Secret Service with an unlocked supported session. The standalone per-platform proofs do not provide production adapters. No master key in settings, environment, command line, browser storage or adjacent file. Unsupported, denied or locked vault means locked cache; never auto-create a replacement key for an existing store.

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

The isolated [encrypted module](../../../bench/historycipherprobe/README.md) now uses maintained [mattn/go-sqlite3 v1.14.52](https://github.com/mattn/go-sqlite3/tree/b0be46fa28d17ee0b65c79774ac0dad84b6db068) plus unchanged official [SQLCipher 4.20.0 commit 355d4db92d3404e71faa8088d071a71d767807f4](https://github.com/sqlcipher/sqlcipher/tree/355d4db92d3404e71faa8088d071a71d767807f4), with Apple's CommonCrypto provider. The previous WissCore fork and its dependency checksums are removed, not shipped as a fallback. This is a standalone implementation candidate, not a host dependency admission.

Freshness review rejected the prior fork: it embedded SQLCipher 4.15 / SQLite 3.53.0 and stale LibTomCrypt, missed later official crypto fixes, and preceded SQLite FTS5 fixes. Current official core removes that vendored-driver/crypto fork from this proof. See official [4.17 release](https://github.com/sqlcipher/sqlcipher/releases/tag/v4.17.0), [4.20 release](https://github.com/sqlcipher/sqlcipher/releases/tag/v4.20.0) and [SQLite 3.53.2 release](https://sqlite.org/releaselog/3_53_2.html). Neither a successful old smoke nor community maintenance branding admitted that rejected dependency.

The reproducible native builds fetch the exact Git object, generate the unchanged official amalgamation, and statically compile it in fresh private directories with HAS_CODEC, TEMP_STORE=2, THREADSAFE=1, FTS5 and official extra init/shutdown hooks. macOS selects SQLCIPHER_CRYPTO_CC; Linux/Windows select maintained OpenSSL 3. Isolated headers/library paths and mattn's `libsqlite3` tag prevent a bundled plaintext SQLite selection. Runtime rejects unexpected codec/core versions, provider and required compile options. Per-platform linkage and package inventories identify the native dependencies; macOS rejects third-party crypto linkage. No custom cryptography or VFS is introduced.

Keying follows official [open-time URI handling](https://github.com/sqlcipher/sqlcipher/blob/355d4db92d3404e71faa8088d071a71d767807f4/src/main.c#L3378-L3405): URL-escaped `key=x'…'` supplies the documented raw-key representation before mattn initialization. `hexkey` is not assumed to mean raw-key bypass. [Mattn ConnectHook runs after initialization PRAGMAs](https://github.com/mattn/go-sqlite3/blob/b0be46fa28d17ee0b65c79774ac0dad84b6db068/sqlite3.go#L1840-L1936), so it cannot provide initial key admission. Two simultaneously reserved pool connections independently prove keying/version/provider/options; subsequent journal/rekey mechanics serialize onto one connection. Key-bearing URIs remain backend-only, absent from diagnostics and frontend state.

License inventory: [mattn MIT](https://github.com/mattn/go-sqlite3/blob/v1.14.52/LICENSE), [official SQLCipher BSD-style terms](https://github.com/sqlcipher/sqlcipher/blob/355d4db92d3404e71faa8088d071a71d767807f4/LICENSE.md), SQLite public-domain notice, and OS SDK/framework distribution conditions. Preserve required notices in source/binaries and SBOM. LibTomCrypt is no longer this probe's crypto dependency. This is not legal approval, FIPS certification, a commercial license or paid support claim. Git commit pinning does not complete tag-signature verification; independent provenance/authenticity verification remains a release gate.

Linux/Windows additionally require the maintained OpenSSL 3 Apache-2.0 notices and applicable compiler/runtime redistribution inventories. Native proof dependency lists do not constitute a complete desktop SBOM or installer license bundle.

CGO and native C toolchains are mandatory. FTS5 belongs to the isolated official core build, not a Go tag that could silently select bundled SQLite. The integration coordinator owns dependency admission and security-update evidence; the release owner must own exact source inventories, signing/notarization and per-platform application rebuilds before publication. Native proof executables exercise current-core/provider/libc or CRT linkage, but signed desktop bundles, installer redistribution and production runtime loading remain unexercised. Older plaintext cross-builds establish none of those gates.

Key custody review: [keybase/go-keychain v0.0.1](https://github.com/keybase/go-keychain/tree/v0.0.1) offers native Security.framework item APIs under MIT. [zalando/go-keyring](https://github.com/zalando/go-keyring) uses `/usr/bin/security` on macOS; secret-bearing command arguments conflict with the selected policy, so that backend is not selected. The probe directly wraps standard Security.framework calls only to create an isolated temporary keychain without altering the login keychain, default keychain or search list. It is not custom cryptography or a VFS. These SecKeychain isolation APIs are deprecated; compiler warnings remain visible. A production signed-app adapter must use reviewed modern SecItem access controls, nonsynchronizing device-local custody and real lock/logout/upgrade behavior. This proof does not approve legacy API adoption.

### Native encrypted execution receipt

From `bench/historycipherprobe`, the current-core source passed:

```sh
bash native-darwin.sh
```

The script performed isolated official-core generation/static compilation, `GOWORK=off CGO_ENABLED=1 go build -tags libsqlite3`, `go vet` with identical flags, dynamic linkage inventory and actual native execution. It removed its owned build directory. Actual Darwin ARM64 output:

```json
{"crypto_provider":"commoncrypto","encrypted_backup_distinct_key_reopen":true,"keyed_pool_connections_verified":2,"limits":"Synthetic native macOS proof only; no signed app, crash-safe rotation, hostile plugin isolation, production schema, Windows/Linux native evidence or physical erasure guarantee","locked_vault_denied":true,"metadata_payload_fts_db_wal_no_plaintext_sentinels":true,"missing_vault_key_preserves_database":true,"native_key_retirement":true,"native_private_keychain":true,"partition_key_lookup_isolated":true,"private_artifacts_scanned":9,"rekey_old_key_rejected_new_key_reopens":true,"required_codec_compile_options":true,"sqlcipher":"4.20.0 community","sqlite":"3.54.1","target":"darwin/arm64","wrong_and_missing_database_key_rejected":true}
```

The executable was 5,731,218 bytes, not a desktop bundle delta. Link inventory showed Security.framework, CoreFoundation, libresolv and libSystem only. The process reported `owned temporary database and private keychain removed`, after checked owned-directory cleanup. Build/vet retained native Keychain deprecation warnings; upstream configure warned about missing optional tclConfig.sh but successfully used its jimsh generator. No warning was suppressed.

The first changed current-core smoke exposed a real journal-mode lock with a second pooled handle still open. The fix retains two-connection key-admission proof, then serializes codec journal/rekey mechanics onto one handle. The next full current-core build/vet/smoke passed. Earlier fork-only evidence is historical and does not represent the current dependency. Parent-reviewed checked cleanup is retained.

The scan covers synthetic metadata/payload/FTS sentinels in DB, populated WAL, SHM and owned native vault/backup artifacts while files exist. Sentinel absence plus wrong-key rejection is applicable encryption evidence, not forensic proof about every possible byte, temp spill, swap or snapshots. SQLCipher `rekey` proves codec mechanics, not crash-safe multi-artifact key rotation. The early macOS report's `missing_vault_key_preserves_database` flag did not exercise an attempted database open and is withdrawn as standalone proof. Corrected macOS/Windows paths use the same vault-gated opener for successful reads and retired-key attempts against both existing and fresh paths; acceptance requires unchanged ciphertext and no fresh file. This proves a backend admission stop, not upstream revocation.

### Native CI receipt and review corrections

[Native run 40748839203](https://github.com/omniviewdev/omniview/actions/runs/40748839203), head `fdd73376e9d2aade8030fe026cb9c34d797ca544`, merge checkout `e62177007bcee240835ffff8c60ad16e4b9b6416`, passed all four native jobs:

- [macOS ARM64](https://github.com/omniviewdev/omniview/actions/runs/40748839203/job/123029744605) and [Intel macOS](https://github.com/omniviewdev/omniview/actions/runs/40748839203/job/123029743639): official SQLCipher 4.20.0 / SQLite 3.54.1 / CommonCrypto, isolated private Keychain and encrypted lifecycle.
- [Windows AMD64](https://github.com/omniviewdev/omniview/actions/runs/40748839203/job/123029744258): actual encrypted executable, OpenSSL 3.6.5, native Credential Manager lifecycle, strict current-user/SYSTEM DACLs and observed DB/WAL/SHM ownership.
- [Ubuntu AMD64](https://github.com/omniviewdev/omniview/actions/runs/40748839203/job/123029744193): actual encrypted executable, maintained Ubuntu OpenSSL 3.0.13 package, isolated real Secret Service session, locked/absent custody refusal and private file checks. An isolated CI session does not establish desktop prompt/logout or signed-app behavior.

Review then identified missing-key proof gaps on macOS/Windows, unasserted WAL/migration preconditions in the plaintext comparison, retained checkout credentials and mutable action references. The follow-up corrects the actual vault-gated entry paths, adds structured SQL preconditions, disables checkout credential persistence, and pins the exact action commits used by this successful run. Final changed-source execution and independent acceptance are linked from [HR02 #180](https://github.com/omniviewdev/omniview/issues/180); the earlier missing-key flags alone are not accepted evidence.


### Required native validation tasks

Parent owns CI integration. Darwin, Windows and Linux use separate synthetic per-platform harnesses, each with its own open/key/export/rekey lifecycle code, linked to the same unchanged official SQLCipher core. These are not three custom codec implementations. Production integration must consolidate shared driver policy behind platform custody adapters rather than ship diverging copies of the proof harnesses.

1. **Dependency admission:** independently review the exact maintained adapter, unchanged official core/CommonCrypto source, notices/SBOM, signatures/authenticity and native packaging. Assign an update/security owner before host integration; no stale-fork fallback.
2. **macOS ARM64 and AMD64:** run the encrypted module natively with Xcode clang and FTS5; then exercise a signed/notarized app's modern native vault adapter under deny/cancel, locked/logout, upgrade and key-loss cases. Verify no default/login keychain mutation, no secret argv/environment/logs, device-local custody, private sidecars and containment during directory replacement.
3. **Windows AMD64:** native MSVC-compatible/MinGW CGO packaging decision, actual encrypted-page/FTS/WAL execution, Credential Manager native create/read/delete and missing/denied custody, owner-only DACLs for DB/WAL/SHM/temp/backup, reparse/ancestor replacement and locked-file purge. Cross-builds and POSIX mode bits cannot pass these gates.
4. **Linux AMD64 supported desktop:** native compiler/libc baseline, encrypted-page/FTS/WAL execution plus isolated Secret Service session; absent service, locked collection, denied prompt and logout must deny with no file-key/plaintext fallback. Verify actual UID/modes, symlink containment and runtime dependency inventory. Headless container crypto execution cannot establish desktop keyring support.
5. **Encrypted lifecycle failure injection:** crash before/after encrypted generation switch; preserve old key until verified recovery; encrypted consistent backups with distinct key references; restore under current authorization; disk-pressure during migration/export/rekey; tampered page authentication; temp-spill denial; purge all owned backups/derived indexes. Do not ship production schema until HC01/HC03 exist.
