# Windows Resource History security proof

Standalone HR02 acceptance probe. This is not production storage and does not implement SQLite, SQLCipher, or a plaintext fallback. Native execution is pending Windows CI; Darwin cross-builds do not prove Windows behavior.

## Native CI

Use `windows-latest`, a normal non-SYSTEM runner account, and Go 1.25 or newer. Dependency: `golang.org/x/sys v0.49.0`, BSD-3-Clause (module LICENSE); Go standard library uses the Go BSD-3-Clause license. Windows Credential Manager and security APIs ship with Windows. No third-party executable, CGO, compiler, administrator rights, or external installer is needed.

PowerShell, from this directory:

```powershell
$env:GOWORK = 'off'
$env:CGO_ENABLED = '0'
go mod download
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
go test ./... -count=1
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
go run .
exit $LASTEXITCODE
```

Actual executable smoke is `GOWORK=off go run .` on native Windows (use environment syntax above). Output is one redacted JSON result. Any OS error, failed assertion, or cleanup error produces `status=failed` and nonzero exit. A successful CI result must retain the JSON and runner identity; a build alone is not native evidence.

Darwin compile-only check:

```sh
GOWORK=off CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -o /tmp/historywindowssecurityprobe.exe .
GOWORK=off CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go test -c -o /tmp/historywindowssecurityprobe.test.exe
```

A later shared SQLCipher probe will need its selected driver's Windows CGO/toolchain and encryption-library prerequisites. This proof has none and does not establish that a particular Windows SQLCipher toolchain works. Pin those dependencies in that module before claiming encrypted Windows runtime acceptance.

## Guarantees exercised by native smoke

- Native `CredWriteW`, `CredReadW`, `CredDeleteW`, and `CredFree`, using generic credentials with local-machine persistence under the current user's vault, not a machine-wide secret.
- Random unique owned target only; no credential enumeration and no production targets. Two random 256-bit keys prove create/read and replace/read. Delete/read and repeated delete must return `ERROR_NOT_FOUND`.
- Missing keys never regenerate implicitly. Explicit recreation uses a third independent random key and proves readback. Existing ciphertext must be treated as unrecoverable when its original key is lost; this probe does not claim recreated keys recover old data.
- Every OS failure propagates, including unavailable credential service/logon session and access denial. Locked/unavailable vault failures are explicit failed outcomes, never a fallback. This probe does not lock the runner's vault or simulate an OS failure and does not claim to prove vault-lock behavior under every logon type.
- A random fresh directory is created atomically with a protected DACL. Only current user and SYSTEM receive full control. SYSTEM is allowed for OS maintenance; Administrators, Everyone, Users, inherited ACEs, and inheritance propagation flags are rejected. Exact owner, protected control bit, two unique trustees, ACE kind and rights are checked from native security descriptors.
- Three empty synthetic stand-ins named `history.db`, `history.db-wal`, and `history.db-shm` are created atomically with the same explicit protected DACL. Each is closed/reopened and its DACL rechecked. Directory enumeration requires exactly those three entries. These are filesystem security checks, NOT SQLite-created sidecar evidence. Real driver sidecar creation, journaling, reparse-point races, wrong-key rejection, and encrypted data-at-rest checks remain shared encrypted-probe work.
- Deferred credential cleanup is registered only after `ERROR_NOT_FOUND` establishes target absence, before the first write. An existing target is rejected without deletion or replacement. Cleanup deletes only the random owned vault item and owned directory, including after assertion failure. Cleanup errors fail the run. Process termination or machine failure can interrupt cleanup; no external resource cleanup can be guaranteed after forced termination.

Deterministic tests cover broad/admin/inherited/partial-rights ACL rejection, intended owner/SYSTEM acceptance, malformed key lengths before vault writes, and embedded-NUL target rejection. Native buffer tests use `LocalAlloc` to verify clearing both accepted and rejected credential blobs before release, while preserving the independent returned key. A native vault regression proves freshness rejection preserves an existing synthetic credential. These native tests remain pending Windows execution. Smoke covers actual native API behavior.

## Threat limits

Credential Manager and DACLs do not isolate hostile code running as the same user. Administrators with privilege, SYSTEM, debugging, memory capture, and compromised OS are outside this boundary. Keys briefly live in Go and native process memory; returned Go buffers are wiped, and native credential blobs are wiped before `CredFree`, including rejected key shapes. Compiler/runtime copies and paging cannot be proven erased. No key bytes are logged, written to files, or passed as process arguments. Stand-in database files contain no keys or real resource data.
