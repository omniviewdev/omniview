# HR02 / HC02 storage, privacy, and platform decision

Date: 2026-10-28. Status: proposed; independent security review and product decision required. No production store or schema is introduced.

Fail-closed baseline pending that decision: select option 2 and keep durable acquisition disabled until its applicable security/platform gates pass. Option 1 is an explicit product-authorized scope change, not an automatic implementation fallback. This yields a concrete safe release boundary without interpreting missing approval as permission to retain sensitive plaintext metadata.

## Decision and support boundary

Select modernc.org/sqlite v1.61.0 as the standalone no-CGO driver candidate, WAL with FULL synchronous durability, one serialized writer, bounded read transactions, parameterized SQL, and explicit FTS5 token semantics. This is not a host dependency admission. Keep evidence, admitted indexes, qualified coverage, and recovery changes in one transaction. A busy/full/corrupt failure cannot advance recovery. Do not keep readers open for UI pagination.

The release profile must choose between two materially different privacy promises:

1. **Explicitly consented redacted metadata cache:** ordinary unencrypted SQLite, no body retention, no free-form messages, no offline protected reads, and no persistent opaque provider recovery tokens. Even resource names, actor identities, timestamps, native IDs and source locations can be sensitive. Redaction is not anonymization; OS permissions are not encryption. This profile requires explicit product approval for those plaintext metadata classes and user disclosure before enabling acquisition. It is not approved by this document.
2. **Encrypted retained-evidence cache:** encrypt database pages, indexes, journals, temporary spill, backups and recovery material, using a reviewed implementation and native key custody. Until encryption/platform proof exists, durable acquisition stays disabled. Application-level payload encryption alone cannot protect SQLite metadata/FTS or WAL and does not satisfy this profile.

Recommend option 1 only if product accepts its limited privacy promise; otherwise choose option 2 and keep release blocked. Never fall back to plaintext when a key service fails. Neither option enables raw sensitive mode. This decision question was sent to the integration owner with the existing unencrypted-driver and absent-keyring evidence.

Initial **runtime-evidenced candidate** is macOS ARM64 local single-user storage. Linux AMD64 has only container execution on an ARM workstation, possibly emulated. Darwin AMD64 and Windows AMD64 have cross-build evidence only. No target has production history acceptance. Do not advertise those cross-builds as native platform support. Windows requires real NTFS/DACL and key custody execution; Linux requires real supported desktop/keyring and filesystem execution; Intel macOS requires actual signed desktop/runtime evidence. Network shares, removable volumes, synchronized folders and multi-user/shared databases are unsupported first-release storage locations.

## Existing conventions and gaps

- Host `internal/settings/store/store.go:52–84` opens bbolt at 0600, serializes JSON, reserves encryption for future work, and renames recognized corrupt input before replacement. This is not a key vault. History must not copy its automatic fresh-database recovery: that could conceal missing cited evidence and lost checkpoints.
- `backend/pkg/plugin/settings/redaction.go` excludes unknown, sensitive and password settings from inspection, including defaults/options/path metadata. Reuse its fail-closed classification principle, not its settings-specific field shape.
- Selected SDK `pkg/state/root.go` offers rooted directory operations and rejects symlink aliases. This does not prove SQLite's path-opened DB/WAL/SHM stay inside an `os.Root` during directory replacement. A real driver/VFS containment strategy and adversarial runtime proof remain required.
- Repository search found no runtime Keychain/Secret Service/Windows credential-vault adapter; Darwin build signing uses a notarization keychain profile, which is unrelated. Current invocation access generation does not establish upstream revocation. No existing setting flag can supply either missing guarantee.
- Existing modernc and mattn measurements are recorded in the prerequisite receipt. Different SQLite versions and single synthetic transactions do not establish a performance winner. Mattn additionally requires CGO/C toolchain and `sqlite_fts5`; it is not selected merely for one smaller/faster local result.

## Data admission and redaction before derivation

Classify provider input before enqueueing durable work. Start deny-by-default for unknown source schemas and fields. Allowlist bounded provenance, canonical references and operation/outcome metadata only after HC01 approval. Actor/name/location retention needs the selected profile's explicit approval; never call those fields non-sensitive by default.

Credentials, bearer tokens, cookies, authorization headers, service-account tokens, private keys, client certificates with private material, kubeconfig contents and authentication request bodies are never evidence. Do not persist them encrypted as an exception. Secret resources and authentication/authorization endpoints remain metadata-only. ConfigMaps, annotations, labels, command arguments, environment variables, error strings and arbitrary CRDs can contain secrets; resource kind alone cannot authorize their bodies.

Default representation states are `notRecorded` or `redacted`, with bounded reason codes rather than rejected values. No raw request/response bodies, patches, snapshots, free-text audit messages or unknown extensions in option 1. Safe structured summaries use admitted operation/outcome codes, not substring scrubbing of source messages. A future richer redacted payload needs a reviewed schema-specific projection, not a regex secret detector.

Order: validate limits/schema → classify → construct permitted projection → derive summary/search/correlation → persist atomically → publish authorized results. Never derive hashes, facets, embeddings, previews, diagnostics or export fields from forbidden values. Never include native recovery tokens in frontend cursors or logs. No AI input bypass. If raw material is discarded, later parser rebuild cannot promise reconstruction.

Production acceptance must send synthetic secrets through the real normalizer, queues, DB/WAL/SHM/temp paths, FTS and structured queries, diagnostics, export and restart recovery. This assignment does not invent that normalizer before HC01. Existing standalone tests cannot establish redaction-before-index merely by inserting a manually cleaned string.

## Keys and encryption lifecycle

Option 1 creates no encryption key and makes no encrypted-at-rest claim. Opaque recovery tokens stay in bounded backend memory; restart requires an explicitly supported bounded replay, never fabricated resume. Credentials remain outside evidence storage.

Option 2 requires random per-access-partition data keys and versioned native-vault references, separated across development profiles and production. Proposed custody: macOS Keychain, Windows user-scoped protected key custody, Linux Secret Service with an unlocked supported session. These are target requirements, not existing implementations. No master key in settings, environment, command line, browser storage or adjacent file. Unsupported, denied or locked vault means locked cache; never auto-create a replacement key for an existing store.

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

Existing known CEL failures were not rerun. No production schema, native keychain integration, filesystem containment claim, OS disk-full/power-loss proof, or platform security approval is inferred. The new execution receipt below distinguishes builds from runtime. Outstanding gates: product profile choice; independent security review; real native target permissions/containment; historical authorization/revocation handoff; production redaction pipeline; bounded storage sizing; and encrypted-page/key lifecycle proof if option 2 is selected. Issue #180 must remain open until those accepted decisions and applicable proof are reviewed.

### Execution receipt, 2026-10-28

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
