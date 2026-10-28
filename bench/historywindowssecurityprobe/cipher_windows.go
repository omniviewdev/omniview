//go:build windows && cgo

package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"unsafe"

	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/sys/windows"
)

func requireCipherSupport() error { return nil }
func freshKey() ([]byte, error)   { key := make([]byte, 32); _, err := rand.Read(key); return key, err }
func keySQL(key []byte) string    { return `"x'` + hex.EncodeToString(key) + `'"` }

func cipherURI(path string, key []byte) string {
	// Windows drive paths require an absolute file URI, not file:C:\... .
	u := url.URL{Scheme: "file", Path: "/" + filepath.ToSlash(path)}
	if len(key) != 0 {
		u.RawQuery = url.Values{"key": {"x'" + hex.EncodeToString(key) + "'"}}.Encode()
	}
	return u.String()
}

// openVaultCipher is the real vault-gated entry path for encrypted database opens.
// A missing or unavailable vault key must stop before SQLite sees the path.
func openVaultCipher(path, target string) (*sql.DB, error) {
	key, err := get(target)
	if err != nil {
		return nil, err
	}
	defer wipe(key)
	return openCipher(path, key)
}

func openCipher(path string, key []byte) (*sql.DB, error) {
	// SQLCipher URI key processing runs before mattn's initialization PRAGMAs.
	// This URI contains a key: never log it or propagate driver errors containing it.
	db, err := sql.Open("sqlite3", cipherURI(path, key))
	if err != nil {
		return nil, errors.New("driver open failed")
	}
	db.SetMaxOpenConns(2)
	fail := func() (*sql.DB, error) { db.Close(); return nil, errors.New("encrypted connection admission failed") }
	var count int
	if db.QueryRow("SELECT count(*) FROM sqlite_master").Scan(&count) != nil {
		return fail()
	}
	first, err := db.Conn(context.Background())
	if err != nil {
		return fail()
	}
	defer first.Close()
	second, err := db.Conn(context.Background())
	if err != nil {
		return fail()
	}
	defer second.Close()
	for _, conn := range []*sql.Conn{first, second} {
		var cipher, core, provider, providerVersion string
		if conn.QueryRowContext(context.Background(), "PRAGMA cipher_version").Scan(&cipher) != nil || conn.QueryRowContext(context.Background(), "SELECT sqlite_version()").Scan(&core) != nil || conn.QueryRowContext(context.Background(), "PRAGMA cipher_provider").Scan(&provider) != nil || conn.QueryRowContext(context.Background(), "PRAGMA cipher_provider_version").Scan(&providerVersion) != nil {
			return fail()
		}
		if cipher != "4.20.0 community" || core != "3.54.1" || provider != "openssl" || !strings.HasPrefix(providerVersion, "OpenSSL 3.") {
			return fail()
		}
		for _, option := range []string{"HAS_CODEC", "ENABLE_FTS5", "TEMP_STORE=2", "THREADSAFE=1"} {
			var enabled int
			if conn.QueryRowContext(context.Background(), "SELECT sqlite_compileoption_used(?)", option).Scan(&enabled) != nil || enabled != 1 {
				return fail()
			}
		}
	}
	db.SetMaxOpenConns(1)
	return db, nil
}
func denyCipher(path string, key []byte) error {
	db, err := openCipher(path, key)
	if db != nil {
		db.Close()
	}
	if err == nil {
		return errors.New("unexpected database key acceptance")
	}
	return nil
}
func createPrivateFile(path, user string) error {
	sd, err := windows.SecurityDescriptorFromString("O:" + user + "D:P(A;;FA;;;" + user + ")(A;;FA;;;SY)")
	if err != nil {
		return err
	}
	sa := windows.SecurityAttributes{Length: uint32(unsafe.Sizeof(windows.SecurityAttributes{})), SecurityDescriptor: sd}
	p, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return err
	}
	h, err := windows.CreateFile(p, windows.GENERIC_READ|windows.GENERIC_WRITE, 0, &sa, windows.CREATE_NEW, windows.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		return err
	}
	if err = windows.CloseHandle(h); err != nil {
		return err
	}
	return checkACL(path, user)
}
func scanCipherArtifacts(root, user string, sentinels []string) (int, error) {
	if err := checkACL(root, user); err != nil {
		return 0, err
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return 0, err
	}
	allowed := map[string]bool{"history.db": true, "history.db-wal": true, "history.db-shm": true, "history.db-journal": true, "backup.db": true, "backup.db-journal": true}
	for _, entry := range entries {
		if !allowed[entry.Name()] || entry.IsDir() {
			return 0, errors.New("unexpected database artifact")
		}
		path := filepath.Join(root, entry.Name())
		if err = checkACL(path, user); err != nil {
			return 0, err
		}
		data, e := os.ReadFile(path)
		if e != nil {
			return 0, e
		}
		for _, s := range sentinels {
			if bytes.Contains(data, []byte(s)) {
				return 0, errors.New("plaintext sentinel found")
			}
		}
		if entry.Name() == "history.db" || entry.Name() == "backup.db" {
			if bytes.HasPrefix(data, []byte("SQLite format 3")) {
				return 0, errors.New("plaintext SQLite header")
			}
		}
	}
	return len(entries), nil
}
func encryptedProof(root, user, target string, key []byte, result map[string]any) (err error) {
	stage := "setup"
	// SQL may include a raw key (ATTACH/rekey). Never publish raw driver errors.
	defer func() {
		if err != nil {
			err = errors.New("encrypted proof failed at " + stage)
		}
	}()
	path := filepath.Join(root, "history.db")
	if err = createPrivateFile(path, user); err != nil {
		return err
	}
	loaded, err := get(target)
	if err != nil {
		return err
	}
	defer wipe(loaded)
	if !bytes.Equal(loaded, key) {
		return errors.New("vault key mismatch")
	}
	db, err := openVaultCipher(path, target)
	if err != nil {
		return err
	}
	defer db.Close()
	var providerVersion string
	if err = db.QueryRow("PRAGMA cipher_provider_version").Scan(&providerVersion); err != nil {
		return err
	}
	stage = "WAL and encrypted FTS writes"
	var journal string
	if _, err = db.Exec("PRAGMA temp_store=MEMORY; PRAGMA synchronous=FULL; PRAGMA wal_autocheckpoint=0"); err != nil {
		return err
	}
	if err = db.QueryRow("PRAGMA journal_mode=WAL").Scan(&journal); err != nil {
		return err
	}
	if journal != "wal" {
		return errors.New("WAL unavailable")
	}
	sentinels := []string{"HR02_METADATA_actor_resource_72eb0b851df0", "HR02_PAYLOAD_synthetic_sensitive_7cd3a9b32144", "HR02FTSSENTINEL935cdef191"}
	if _, err = db.Exec("CREATE TABLE evidence(metadata TEXT,payload TEXT); CREATE VIRTUAL TABLE search USING fts5(summary)"); err != nil {
		return err
	}
	if _, err = db.Exec("INSERT INTO evidence VALUES(?,?)", sentinels[0], sentinels[1]); err != nil {
		return err
	}
	if _, err = db.Exec("INSERT INTO search VALUES(?)", sentinels[2]); err != nil {
		return err
	}
	var matches int
	if err = db.QueryRow("SELECT count(*) FROM search WHERE search MATCH ?", sentinels[2]).Scan(&matches); err != nil {
		return err
	}
	if matches != 1 {
		return errors.New("FTS mismatch")
	}
	stage = "actual DB WAL SHM containment and DACLs"
	for _, suffix := range []string{"-wal", "-shm"} {
		var info os.FileInfo
		info, err = os.Stat(path + suffix)
		if err != nil {
			return err
		}
		if info.Size() <= 32 {
			return errors.New("unpopulated sidecar")
		}
	}
	var files int
	files, err = scanCipherArtifacts(root, user, sentinels)
	if err != nil {
		return err
	}
	stage = "wrong and absent key denial"
	wrong, err := freshKey()
	if err != nil {
		return err
	}
	defer wipe(wrong)
	if err = denyCipher(path, nil); err != nil {
		return err
	}
	if err = denyCipher(path, wrong); err != nil {
		return err
	}
	if err = db.Close(); err != nil {
		return err
	}
	stage = "vault-backed reopen"
	db, err = openVaultCipher(path, target)
	if err != nil {
		return err
	}
	defer db.Close()
	var payload string
	if err = db.QueryRow("SELECT payload FROM evidence").Scan(&payload); err != nil {
		return err
	}
	if payload != sentinels[1] {
		return errors.New("reopen mismatch")
	}
	stage = "distinct-key encrypted backup"
	backupKey, err := freshKey()
	if err != nil {
		return err
	}
	defer wipe(backupKey)
	backupTarget := target + "/backup"
	if err = requireAbsent(backupTarget); err != nil {
		return err
	}
	defer func() {
		e := remove(backupTarget)
		if e != nil && !errors.Is(e, windows.ERROR_NOT_FOUND) {
			err = errors.Join(err, errors.New("backup key cleanup failed"))
		}
	}()
	if err = put(backupTarget, backupKey); err != nil {
		return err
	}
	backupLoaded, err := get(backupTarget)
	if err != nil {
		return err
	}
	defer wipe(backupLoaded)
	backup := filepath.Join(root, "backup.db")
	if err = createPrivateFile(backup, user); err != nil {
		return err
	}
	if _, err = db.Exec("ATTACH DATABASE ? AS backup KEY "+keySQL(backupLoaded), backup); err != nil {
		return err
	}
	if _, err = db.Exec("SELECT sqlcipher_export('backup')"); err != nil {
		return err
	}
	if _, err = db.Exec("DETACH DATABASE backup"); err != nil {
		return err
	}
	if err = denyCipher(backup, nil); err != nil {
		return err
	}
	if err = denyCipher(backup, loaded); err != nil {
		return err
	}
	copyDB, err := openVaultCipher(backup, backupTarget)
	if err != nil {
		return err
	}
	defer copyDB.Close()
	if err = copyDB.QueryRow("SELECT payload FROM evidence").Scan(&payload); err != nil {
		return err
	}
	if payload != sentinels[1] {
		return errors.New("backup payload mismatch")
	}
	if err = copyDB.Close(); err != nil {
		return err
	}
	stage = "rekey and native key retirement"
	if _, err = db.Exec("PRAGMA wal_checkpoint(TRUNCATE)"); err != nil {
		return err
	}
	if err = db.QueryRow("PRAGMA journal_mode=DELETE").Scan(&journal); err != nil {
		return err
	}
	if journal != "delete" {
		return errors.New("rekey journal transition failed")
	}
	newKey, err := freshKey()
	if err != nil {
		return err
	}
	defer wipe(newKey)
	nextTarget := target + "/v2"
	if err = requireAbsent(nextTarget); err != nil {
		return err
	}
	defer func() {
		e := remove(nextTarget)
		if e != nil && !errors.Is(e, windows.ERROR_NOT_FOUND) {
			err = errors.Join(err, errors.New("rotation key cleanup failed"))
		}
	}()
	if err = put(nextTarget, newKey); err != nil {
		return err
	}
	if _, err = db.Exec("PRAGMA rekey=" + keySQL(newKey)); err != nil {
		return err
	}
	if err = db.Close(); err != nil {
		return err
	}
	if err = denyCipher(path, loaded); err != nil {
		return err
	}
	rotated, err := openVaultCipher(path, nextTarget)
	if err != nil {
		return err
	}
	defer rotated.Close()
	if err = rotated.QueryRow("SELECT payload FROM evidence").Scan(&payload); err != nil {
		return err
	}
	if payload != sentinels[1] {
		return errors.New("rekey payload mismatch")
	}
	if err = rotated.Close(); err != nil {
		return err
	}
	if err = remove(target); err != nil {
		return err
	}
	if err = requireAbsent(target); err != nil {
		return err
	}
	if err = remove(nextTarget); err != nil {
		return err
	}
	stage = "missing vault key preserves database"
	before, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	freshPath := filepath.Join(root, "missing-key-must-not-create.db")
	if _, e := os.Lstat(freshPath); !errors.Is(e, os.ErrNotExist) {
		return errors.New("missing-key fresh path was not absent")
	}
	for _, candidate := range []string{path, freshPath} {
		denied, e := openVaultCipher(candidate, nextTarget)
		if denied != nil {
			denied.Close()
			return errors.New("missing vault key opened a database")
		}
		if !errors.Is(e, windows.ERROR_NOT_FOUND) {
			return errors.New("missing vault key did not return ERROR_NOT_FOUND")
		}
	}
	if _, e := os.Lstat(freshPath); !errors.Is(e, os.ErrNotExist) {
		return errors.New("missing vault key created a fresh database artifact")
	}
	after, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	if sha256.Sum256(before) != sha256.Sum256(after) {
		return errors.New("missing key changed ciphertext")
	}
	stage = "final encrypted artifact scan"
	finalFiles, err := scanCipherArtifacts(root, user, sentinels)
	if err != nil {
		return err
	}
	result["encrypted_database"] = "passed"
	result["sqlcipher"] = "4.20.0 community"
	result["sqlite"] = "3.54.1"
	result["crypto_provider"] = "openssl"
	result["crypto_provider_version"] = providerVersion
	result["keyed_pool_connections_verified"] = 2
	result["required_codec_compile_options"] = true
	result["actual_db_wal_shm_private_dacl_verified"] = true
	result["metadata_payload_fts_no_plaintext_sentinels"] = true
	result["private_artifacts_scanned"] = files + finalFiles
	result["wrong_and_absent_key_denied"] = true
	result["encrypted_backup_distinct_key_reopen"] = true
	result["rekey_old_key_denied_new_key_reopens"] = true
	result["native_key_retirement"] = true
	result["missing_vault_key_preserves_database"] = true
	result["missing_vault_key_prevents_fresh_database_creation"] = true
	result["limits"] = "synthetic native Windows proof; no crash-safe rotation; no hostile same-user/admin/memory isolation; no production schema or physical erasure guarantee"
	return nil
}
