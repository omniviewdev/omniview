# Encrypted history storage and native key-custody probe

Standalone verification module, not a host dependency or production store. The user requires encrypted metadata, indexes and retained payloads, with OS credential storage and no plaintext fallback. Existing `../historystorageprobe` remains an unencrypted comparison only.

## Run on native macOS

Requires Go 1.26, CGO, Xcode clang, Security.framework and CoreFoundation. No Homebrew SQLCipher or external OpenSSL is required by the pinned self-contained driver.

```sh
GOWORK=off CGO_ENABLED=1 go run -tags sqlite_fts5 .
GOWORK=off CGO_ENABLED=1 go vet -tags sqlite_fts5 ./...
GOWORK=off CGO_ENABLED=1 go build -tags sqlite_fts5 -o /tmp/history-hr02-cipher-native .
otool -L /tmp/history-hr02-cipher-native
```

The module creates an owned 0700 temporary directory and private native Keychain, never changing the login/default Keychain or search list. It stores only random synthetic keys and synthetic evidence. No arguments, environment secrets, credentials, user state, cloud queries or key material in output. Normal completion removes both private Keychain and data. Abrupt process termination can leave owned temporary encrypted artifacts; do not generalize normal cleanup into crash-proof cleanup.

The native Keychain API used for isolation is deprecated; warnings are visible. This is a concrete OS custody experiment, not a recommended production vault adapter. Production must use reviewed modern native access controls and signed-app evidence. No Linux/Windows stub or plaintext fallback is supplied: this executable is intentionally Darwin+CGO only. Parent-owned platform custody modules and CI integration establish those separate gates.

## Assertions

- Native vault creates, reads and deletes a 32-byte random data key; a foreign partition account lookup fails.
- Locked private Keychain refuses key retrieval with user interaction disabled; explicit native unlock restores access.
- SQLCipher encrypts a synthetic metadata/payload table and FTS5 index; actual token queries still find admitted data.
- Populated WAL, DB, SHM and owned vault/backup artifacts contain none of the synthetic metadata, payload or FTS sentinels. Files have no group/other mode bits after explicit owned-file restriction.
- Keyless and wrong-key opens reject; correct key reopens retained payload.
- `sqlcipher_export` produces an encrypted consistent copy under a distinct native-vault key; original/no key cannot read it, backup key can.
- SQLCipher rekey invalidates the old data key and permits the new key. Native old/new key deletion prevents later vault lookup.
- Missing-vault-key admission leaves the existing database bytes unchanged. No replacement key or database is created.

Sentinel scanning is not a mathematical proof of ciphertext for all bytes. A read-only temporary Keychain does not prove hostile-plugin protection. Key deletion does not erase keys already in process memory or OS backups. Rekey here is codec behavior only, not crash-safe generation switching. This synthetic schema has no canonical history ABI or authorization contract.

## Candidate and evidence

Pin: `github.com/WissCore/go-sqlcipher/v4 v4.15.1`, reporting SQLCipher 4.15.0 community and SQLite 3.53.0. FTS5 requires the build tag. The source embeds LibTomCrypt and requires CGO; do not infer OpenSSL linkage from upstream README wording. Native Darwin ARM64 executed successfully. No encrypted Intel macOS, Windows or Linux build/runtime evidence is claimed.

The candidate trails current upstream SQLCipher 4.20.0 / SQLite 3.54.1. Independent freshness, vulnerability, licensing and packaging review blocks production admission. Preserve MIT/BSD-style/SQLite-public-domain/LibTomCrypt-Unlicense notices from the dependency. No FIPS or independent audit claim is made.

See [security decision and exact execution receipt](../../docs/superpowers/specs/2026-10-28-history-storage-security.md) for source links, failures fixed during implementation, native-platform tasks, and remaining release gates.
