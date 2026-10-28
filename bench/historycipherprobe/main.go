//go:build darwin && cgo

package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"runtime"

	_ "github.com/mattn/go-sqlite3"
)

func must(err error) {
	if err != nil {
		panic(err)
	}
}
func expect(ok bool, message string) {
	if !ok {
		panic(message)
	}
}
func randomKey() []byte {
	key := make([]byte, 32)
	_, err := rand.Read(key)
	must(err)
	return key
}
func keySQL(key []byte) string { return `"x'` + hex.EncodeToString(key) + `'"` }
func openCipher(path string, key []byte) (*sql.DB, error) {
	// Official SQLCipher consumes URI key before mattn initialization PRAGMAs.
	// ConnectHook runs too late for initial keying. Never log this URI.
	uri := &url.URL{Scheme: "file", Path: path}
	if len(key) != 0 {
		values := url.Values{"key": {"x'" + hex.EncodeToString(key) + "'"}}
		uri.RawQuery = values.Encode()
	}
	db, err := sql.Open("sqlite3", uri.String())
	if err != nil {
		return nil, errors.New("driver open failed")
	}
	db.SetMaxOpenConns(2)
	var count int
	if err = db.QueryRow("SELECT count(*) FROM sqlite_master").Scan(&count); err != nil {
		db.Close()
		return nil, errors.New("encrypted database rejected")
	}
	// Hold both pooled connections so each must open and admit its own key.
	first, err := db.Conn(context.Background())
	if err != nil {
		db.Close()
		return nil, errors.New("first keyed connection rejected")
	}
	defer first.Close()
	second, err := db.Conn(context.Background())
	if err != nil {
		db.Close()
		return nil, errors.New("second keyed connection rejected")
	}
	defer second.Close()
	for _, conn := range []*sql.Conn{first, second} {
		var cipher, core, provider string
		if conn.QueryRowContext(context.Background(), "PRAGMA cipher_version").Scan(&cipher) != nil ||
			conn.QueryRowContext(context.Background(), "SELECT sqlite_version()").Scan(&core) != nil ||
			conn.QueryRowContext(context.Background(), "PRAGMA cipher_provider").Scan(&provider) != nil {
			db.Close()
			return nil, errors.New("codec identity unavailable")
		}
		if cipher != "4.20.0 community" || core != "3.54.1" || provider != "commoncrypto" {
			db.Close()
			return nil, errors.New("unapproved codec version or provider")
		}
		for _, option := range []string{"HAS_CODEC", "ENABLE_FTS5", "TEMP_STORE=2", "THREADSAFE=1"} {
			var enabled int
			if conn.QueryRowContext(context.Background(), "SELECT sqlite_compileoption_used(?)", option).Scan(&enabled) != nil || enabled != 1 {
				db.Close()
				return nil, errors.New("required codec compile option unavailable")
			}
		}
	}
	// Codec mechanics below use one serialized handle. In particular, changing
	// journal mode/rekey cannot run while another pooled handle keeps WAL open.
	db.SetMaxOpenConns(1)
	return db, nil
}
func reject(path string, key []byte) {
	db, err := openCipher(path, key)
	if db != nil {
		db.Close()
	}
	expect(err != nil, "unexpected keyless or wrong-key access")
}
func scanPrivate(root string, sentinels []string) int {
	entries, err := os.ReadDir(root)
	must(err)
	count := 0
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		path := filepath.Join(root, entry.Name())
		data, err := os.ReadFile(path)
		must(err)
		for _, sentinel := range sentinels {
			expect(!bytes.Contains(data, []byte(sentinel)), "plaintext sentinel found in owned artifact")
		}
		info, err := entry.Info()
		must(err)
		expect(info.Mode().Perm()&0077 == 0, fmt.Sprintf("nonprivate encrypted artifact %s %s", entry.Name(), info.Mode().Perm()))
		count++
	}
	return count
}
func run() {
	root, err := os.MkdirTemp("", "history-cipher-proof-")
	must(err)
	defer func() { must(os.RemoveAll(root)) }()
	password := randomKey()
	vault, err := newVault(filepath.Join(root, "private.keychain"), password)
	must(err)
	defer func() { must(vault.close()) }()
	openFromVault := func(path, account string) (*sql.DB, error) {
		key, err := vault.get(account)
		if err != nil {
			return nil, err
		}
		defer clear(key)
		return openCipher(path, key)
	}
	// Native Keychain creation can use 0644 inside our private 0700 directory.
	// Restrict only these freshly created owned regular files, before storing keys.
	entries, err := os.ReadDir(root)
	must(err)
	for _, entry := range entries {
		info, err := entry.Info()
		must(err)
		expect(info.Mode().IsRegular(), "unexpected native vault artifact")
		must(os.Chmod(filepath.Join(root, entry.Name()), 0600))
	}
	key := randomKey()
	must(vault.put("partition-a-v1", key))
	loaded, err := vault.get("partition-a-v1")
	must(err)
	expect(bytes.Equal(key, loaded), "native vault changed key")
	_, err = vault.get("partition-b-v1")
	expect(err != nil, "foreign partition found key")
	must(vault.lock())
	_, err = vault.get("partition-a-v1")
	expect(err != nil, "locked keychain disclosed key")
	must(vault.unlock(password))
	loaded, err = vault.get("partition-a-v1")
	must(err)

	path := filepath.Join(root, "encrypted.db")
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600)
	must(err)
	must(file.Close())
	db, err := openFromVault(path, "partition-a-v1")
	must(err)
	defer db.Close()
	var cipher, sqlite, journal string
	must(db.QueryRow("PRAGMA cipher_version").Scan(&cipher))
	expect(cipher != "", "missing SQLCipher codec")
	must(db.QueryRow("SELECT sqlite_version()").Scan(&sqlite))
	_, err = db.Exec("PRAGMA temp_store=MEMORY; PRAGMA synchronous=FULL; PRAGMA wal_autocheckpoint=0")
	must(err)
	must(db.QueryRow("PRAGMA journal_mode=WAL").Scan(&journal))
	expect(journal == "wal", "encrypted WAL unavailable")
	metadata := "HR02_METADATA_actor_resource_72eb0b851df0"
	payload := "HR02_PAYLOAD_synthetic_sensitive_7cd3a9b32144"
	indexed := "HR02FTSSENTINEL935cdef191"
	_, err = db.Exec("CREATE TABLE evidence(metadata TEXT,payload TEXT); CREATE VIRTUAL TABLE search USING fts5(summary)")
	must(err)
	_, err = db.Exec("INSERT INTO evidence VALUES(?,?)", metadata, payload)
	must(err)
	_, err = db.Exec("INSERT INTO search VALUES(?)", indexed)
	must(err)
	var matches int
	must(db.QueryRow("SELECT count(*) FROM search WHERE search MATCH ?", indexed).Scan(&matches))
	expect(matches == 1, "encrypted FTS did not match")
	wal, err := os.Stat(path + "-wal")
	must(err)
	expect(wal.Size() > 32, "no populated encrypted WAL")
	files := scanPrivate(root, []string{metadata, payload, indexed})
	reject(path, nil)
	reject(path, randomKey())
	must(db.Close())
	db, err = openFromVault(path, "partition-a-v1")
	must(err)
	var actual string
	must(db.QueryRow("SELECT payload FROM evidence").Scan(&actual))
	expect(actual == payload, "reopen lost encrypted payload")

	// Separate encrypted backup key; no plaintext intermediate database.
	backupKey := randomKey()
	must(vault.put("backup-v1", backupKey))
	backup := filepath.Join(root, "backup.db")
	backupFile, err := os.OpenFile(backup, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600)
	must(err)
	must(backupFile.Close())
	_, err = db.Exec("ATTACH DATABASE ? AS backup KEY "+keySQL(backupKey), backup)
	must(err)
	_, err = db.Exec("SELECT sqlcipher_export('backup')")
	must(err)
	_, err = db.Exec("DETACH DATABASE backup")
	must(err)
	reject(backup, nil)
	reject(backup, loaded)
	copyDB, err := openFromVault(backup, "backup-v1")
	must(err)
	must(copyDB.QueryRow("SELECT payload FROM evidence").Scan(&actual))
	expect(actual == payload, "encrypted backup restore changed payload")
	must(copyDB.Close())

	// Prove SQLCipher rekey and native key retirement, not crash-safe rotation.
	_, err = db.Exec("PRAGMA wal_checkpoint(TRUNCATE)")
	must(err)
	must(db.QueryRow("PRAGMA journal_mode=DELETE").Scan(&journal))
	expect(journal == "delete", "rekey journal transition failed")
	newKey := randomKey()
	must(vault.put("partition-a-v2", newKey))
	_, err = db.Exec("PRAGMA rekey=" + keySQL(newKey))
	must(err)
	must(db.Close())
	reject(path, loaded)
	rotated, err := openFromVault(path, "partition-a-v2")
	must(err)
	must(rotated.QueryRow("SELECT payload FROM evidence").Scan(&actual))
	expect(actual == payload, "rotation lost payload")
	must(rotated.Close())
	must(vault.remove("partition-a-v1"))
	_, err = vault.get("partition-a-v1")
	expect(err != nil, "retired key still available")
	must(vault.remove("partition-a-v2"))
	before, err := os.ReadFile(path)
	must(err)
	denied, err := openFromVault(path, "partition-a-v2")
	if denied != nil {
		must(denied.Close())
	}
	expect(err != nil, "deleted key admitted existing database")
	fresh := filepath.Join(root, "must-not-exist.db")
	denied, err = openFromVault(fresh, "partition-a-v2")
	if denied != nil {
		must(denied.Close())
	}
	expect(err != nil, "deleted key admitted fresh database")
	_, err = os.Lstat(fresh)
	expect(os.IsNotExist(err), "missing key created database")
	after, err := os.ReadFile(path)
	must(err)
	expect(sha256.Sum256(before) == sha256.Sum256(after), "missing key changed database")
	must(vault.remove("backup-v1"))
	files = files + scanPrivate(root, []string{metadata, payload, indexed})
	must(json.NewEncoder(os.Stdout).Encode(map[string]any{
		"target": runtime.GOOS + "/" + runtime.GOARCH, "sqlcipher": cipher, "sqlite": sqlite,
		"keyed_pool_connections_verified": 2, "crypto_provider": "commoncrypto",
		"required_codec_compile_options": true,
		"native_private_keychain":        true, "locked_vault_denied": true, "partition_key_lookup_isolated": true,
		"metadata_payload_fts_db_wal_no_plaintext_sentinels": true, "private_artifacts_scanned": files,
		"wrong_and_missing_database_key_rejected": true, "encrypted_backup_distinct_key_reopen": true,
		"rekey_old_key_rejected_new_key_reopens": true, "native_key_retirement": true,
		"missing_vault_key_preserves_database": true,
		"limits":                               "Synthetic native macOS proof only; no signed app, crash-safe rotation, hostile plugin isolation, production schema, Windows/Linux native evidence or physical erasure guarantee",
	}))
}
func main() { run(); fmt.Fprintln(os.Stderr, "owned temporary database and private keychain removed") }
