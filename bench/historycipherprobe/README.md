# Encrypted history storage and native key-custody probe

Standalone verification module, not a host dependency or production store. History requires encrypted metadata, indexes and retained payloads, with OS credential storage and no plaintext fallback. `../historystorageprobe` remains an unencrypted comparison only.

## Reproduce on native macOS

Requires Go 1.26, Xcode clang/ar, git, make and configure's native prerequisites. Run:

```sh
bash native-darwin.sh
```

The script fetches official SQLCipher commit `355d4db92d3404e71faa8088d071a71d767807f4` (4.20.0), generates its unchanged amalgamation, and builds an isolated static `libsqlite3.a` using Apple's CommonCrypto/Security.framework provider. It supplies isolated headers and library paths to maintained `github.com/mattn/go-sqlite3 v1.14.52`, with `CGO_ENABLED=1`, `GOWORK=off` and `libsqlite3`. It builds, vets, inventories dynamic linkage, rejects dynamic SQLite/SQLCipher/third-party crypto linkage, then runs the native smoke. It does not install into system or Homebrew paths. Temporary build products are removed. Git object identity is pinned; independent tag-signature authenticity verification remains a release gate.

Do not run a plain `go run .`: bundled SQLite does not provide SQLCipher. Runtime admission rejects any core other than SQLCipher 4.20.0 community / SQLite 3.54.1, any provider other than `commoncrypto`, and missing HAS_CODEC/ENABLE_FTS5/TEMP_STORE=2/THREADSAFE=1 compile options.

Keying uses official SQLCipher's URL-escaped `key=x'…'` URI parameter at `sqlite3_open`, before mattn's initialization accesses the schema. `hexkey` is not assumed to provide raw-key semantics. ConnectHook runs too late to supply the initial key. Two simultaneously held pool connections must independently pass codec/compile-option admission. No key-bearing URI is logged or returned in errors.

The process creates an owned 0700 temporary directory and private native Keychain, never changing the login/default Keychain or search list. It stores only random synthetic keys and evidence. No environment secrets, cloud queries or key material in output. Normal completion checks removal of both private Keychain and data. Abrupt termination can leave owned encrypted temporary artifacts.

Native Keychain APIs used for isolation are deprecated; warnings remain visible. This is OS custody evidence, not a recommended production adapter. Production requires reviewed modern SecItem access controls and signed-app evidence. No Linux/Windows stub or plaintext fallback exists: this executable is Darwin+CGO only. Parent-owned custody modules and CI integration cover separate platform gates.

## Assertions

- Native vault creates, reads and deletes random 32-byte keys; foreign partition lookup fails.
- Locked private Keychain refuses retrieval with interaction disabled; native unlock restores access.
- Encrypted metadata/payload table and FTS5 index remain readable/searchable with the admitted key.
- Populated WAL, DB, SHM and owned vault/backup artifacts contain no synthetic metadata, payload or FTS sentinels, and have no group/other mode bits after owned-file restriction.
- Keyless and wrong-key opens reject; correct key reopens retained payload.
- `sqlcipher_export` produces an encrypted consistent copy under a distinct native-vault key; original/no key cannot read it.
- SQLCipher rekey rejects the old key and accepts the new key; native key retirement prevents later vault lookup.
- Missing-vault-key admission leaves existing database bytes unchanged. No replacement key or database is created.

Sentinel scanning is not forensic proof for every possible byte. Vault isolation is not hostile-plugin protection. Key deletion does not erase in-process copies, swap or backups. Rekey here proves codec behavior, not crash-safe generation switching. The synthetic schema has no canonical history ABI or authorization contract.

## Dependency decision

Only mattn plus pinned official SQLCipher remains. The earlier WissCore fork was removed, not retained as a fallback: it embedded old SQLite, stale LibTomCrypt and lacked later official crypto fixes. The current probe uses OS CommonCrypto instead. No production dependency admission is implied.

Preserve mattn MIT, SQLCipher BSD-style and SQLite public-domain notices in release artifacts and SBOM. No FIPS, independent audit, commercial license or paid support claim is made. Parent/dependency owner must own upstream security monitoring, exact core/adapter updates, provenance verification and rebuilt native evidence before publication.

See [security decision and execution receipt](../../docs/superpowers/specs/2026-10-28-history-storage-security.md) for primary sources, native packaging gates and applicable exercised evidence. Encrypted Windows, Linux and Intel macOS execution must not be inferred from Darwin ARM64 or older plaintext cross-builds.
