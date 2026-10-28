# Historical evidence storage driver probe

Verification-only standalone module. The host does not import this module or acquire a SQLite dependency from it. This is not a production history store, canonical resource schema, authorization implementation, or encryption profile.

## Run

From this directory, using Go 1.26:

```sh
GOWORK=off CGO_ENABLED=0 go run .
```

The executable creates a private temporary directory, exercises file-backed SQLite, emits one JSON report, and removes its own data. Do not provide arguments: `before` and `after` are internal child-process modes. The experiment uses synthetic strings only and never reads application state, kubeconfig, cloud credentials, or network data. Go may download the explicitly pinned module dependencies during preparation.

It asserts:

- SQLite WAL and FTS5 availability through modernc.org/sqlite v1.61.0.
- Unicode tokenizer behavior and the difference between token matching and substring matching.
- Equal-timestamp keyset ordering and a stable reader transaction during a concurrent writer commit.
- Private database, WAL and SHM permissions on the executing Unix platform.
- Abrupt child-process exit before and after a transaction commit, with evidence and checkpoint visibility remaining atomic.
- SQLITE_FULL from an explicit page quota, followed by an unchanged checkpoint.
- SQLITE_NOTADB for corrupt input without silently replacing the corrupt bytes.
- Competing writer rejection without partial checkpoint visibility.
- Transactional migration DDL and schema-version rollback after an actual SQL failure.
- Atomic evidence/FTS purge rollback and removal from token queries after commit.
- Read-only SQLite connection rejecting a write; this is not an authorization boundary.

The timed 10,000-row insert is one synthetic transaction, not an ingestion throughput SLO. Its rows are not all FTS-indexed. JSON reports the elapsed insertion time and final database size; these are observations, not a comparative driver benchmark.

`os.Exit(23)` bypasses child cleanup but is not a power-loss test. `max_page_count` is a SQLite capacity limit, not an operating-system disk-full test. Filesystem mode bits do not establish Windows ACLs. Cross-compilation alone does not prove runtime behavior on that platform.

## Build and execute other targets

```sh
GOWORK=off CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /tmp/history-probe-linux .
docker run --rm --network none -v /tmp/history-probe-linux:/probe:ro debian:trixie-slim /probe
GOWORK=off CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -o /tmp/history-probe.exe .
GOWORK=off CGO_ENABLED=0 GOOS=darwin GOARCH=amd64 go build -o /tmp/history-probe-intel .
```

A Darwin ARM host may execute the Linux amd64 binary through Docker emulation; record that environment rather than calling it native Linux hardware.

## Limits

No encryption, redaction pipeline, access partition authorization, upstream revocation, source checkpoints, schema migration, crash-safe driver integration with `os.Root`, or complete production query contract is established. FTS token semantics must not replace Resource Intelligence substring semantics. SQLCipher/key management, alternative-driver comparison, real disk-pressure probes, and all supported platform runtime checks remain HR02 work.

See the [implementation receipt](../../docs/roadmap/2026-10-28-history-prerequisite-execution.md) for exercised results and the remaining production gates.

See the [HR02 security decision](../../docs/superpowers/specs/2026-10-28-history-storage-security.md) for proposed profiles and unresolved platform/privacy gates.
