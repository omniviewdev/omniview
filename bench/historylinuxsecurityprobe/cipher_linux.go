//go:build linux && cgo

package main

import (
	"bytes"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"runtime"

	"github.com/godbus/dbus/v5"
	_ "github.com/mattn/go-sqlite3"
)

func keySQL(key []byte) string { return `"x'` + hex.EncodeToString(key) + `'"` }
func openCipher(path string, key []byte) (*sql.DB, error) {
	// SQLCipher handles URI keying before mattn's initialization PRAGMAs.
	// Never log this URI, any DSN-bearing error, or key-bearing SQL.
	uri := &url.URL{Scheme: "file", Path: path}
	if len(key) > 0 {
		uri.RawQuery = url.Values{"key": {"x'" + hex.EncodeToString(key) + "'"}}.Encode()
	}
	db, err := sql.Open("sqlite3", uri.String())
	if err != nil {
		return nil, errors.New("driver rejected")
	}
	db.SetMaxOpenConns(2)
	var count int
	if db.QueryRowContext(ctx, "SELECT count(*) FROM sqlite_master").Scan(&count) != nil {
		db.Close()
		return nil, errors.New("database rejected")
	}
	first, err := db.Conn(ctx)
	if err != nil {
		db.Close()
		return nil, errors.New("first connection rejected")
	}
	defer first.Close()
	second, err := db.Conn(ctx)
	if err != nil {
		first.Close()
		db.Close()
		return nil, errors.New("second connection rejected")
	}
	defer second.Close()
	for _, c := range []*sql.Conn{first, second} {
		check(c.QueryRowContext(ctx, "SELECT count(*) FROM sqlite_master").Scan(&count) == nil, "pooled keyed schema read rejected")
		var cipher, core, provider string
		check(c.QueryRowContext(ctx, "PRAGMA cipher_version").Scan(&cipher) == nil && cipher == "4.20.0 community", "SQLCipher identity rejected")
		check(c.QueryRowContext(ctx, "SELECT sqlite_version()").Scan(&core) == nil && core == "3.54.1", "SQLite identity rejected")
		check(c.QueryRowContext(ctx, "PRAGMA cipher_provider").Scan(&provider) == nil && provider == "openssl", "crypto provider rejected")
		for _, option := range []string{"HAS_CODEC", "ENABLE_FTS5", "TEMP_STORE=2", "THREADSAFE=1"} {
			var yes int
			check(c.QueryRowContext(ctx, "SELECT sqlite_compileoption_used(?)", option).Scan(&yes) == nil && yes == 1, "compile option absent")
		}
	}
	// The two distinct handles above both independently admitted their keys.
	// Serialize journal mode and rekey mechanics after returning these handles.
	db.SetMaxOpenConns(1)
	return db, nil
}
func rejected(path string, key []byte) {
	db, err := openCipher(path, key)
	if db != nil {
		db.Close()
	}
	check(err != nil, "wrong or missing key admitted")
}
func exec(db *sql.DB, sql string, args ...any) {
	_, err := db.ExecContext(ctx, sql, args...)
	check(err == nil, "SQL operation failed")
}
func privateRoot() string {
	setPrivateUmask()
	root, err := os.MkdirTemp("", "history-linux-cipher-")
	must(err)
	info, err := os.Stat(root)
	must(err)
	check(info.Mode().Perm() == 0700 && owned(info), "root not private")
	return root
}
func create(path string) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600)
	must(err)
	must(f.Close())
}
func scan(root string, sentinels []string) int {
	entries, err := os.ReadDir(root)
	must(err)
	for _, entry := range entries {
		info, err := entry.Info()
		must(err)
		check(info.Mode().IsRegular() && info.Mode().Perm() == 0600 && owned(info), "artifact not private regular file")
		data, err := os.ReadFile(filepath.Join(root, entry.Name()))
		must(err)
		for _, s := range sentinels {
			check(!bytes.Contains(data, []byte(s)), "plaintext sentinel found")
		}
	}
	return len(entries)
}

// Preflight only, NOT a race-proof SQLite VFS. The fresh private parent excludes
// other UIDs, not a hostile same-UID process or root.
func refuseLinks(root string) error {
	for _, name := range []string{"proof.db", "proof.db-wal", "proof.db-shm"} {
		info, err := os.Lstat(filepath.Join(root, name))
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return errors.New("nonregular sidecar")
		}
	}
	return nil
}
func symlinks(root string) {
	target := filepath.Join(root, "sentinel")
	must(os.WriteFile(target, []byte("unchanged"), 0600))
	for _, name := range []string{"proof.db", "proof.db-wal", "proof.db-shm"} {
		path := filepath.Join(root, name)
		must(os.Symlink(target, path))
		check(refuseLinks(root) != nil, "symlink preflight admitted")
		must(os.Remove(path))
	}
	must(os.Remove(target))
}
func digest(path string) [32]byte {
	data, err := os.ReadFile(path)
	must(err)
	return sha256.Sum256(data)
}
func deniedOpen(v *vault, path, id string) {
	db, err := v.open(path, id)
	if db != nil {
		db.Close()
	}
	check(err != nil, "vault denial admitted database")
}
func absentProof() error {
	// Real encrypted database exists before the simulated caller attempts to open
	// through the absent vault. This does not create a fallback key for that caller.
	root := privateRoot()
	defer os.RemoveAll(root)
	path := filepath.Join(root, "proof.db")
	db, err := openCipher(path, random(32))
	if err != nil {
		return err
	}
	exec(db, "CREATE TABLE guard(value TEXT); INSERT INTO guard VALUES('synthetic')")
	must(db.Close())
	before := digest(path)
	v := &vault{items: map[string]dbus.ObjectPath{}}
	deniedOpen(v, path, "missing")
	check(before == digest(path), "absent vault mutated existing database")
	fresh := filepath.Join(root, "must-not-exist.db")
	deniedOpen(v, fresh, "missing")
	_, err = os.Lstat(fresh)
	check(os.IsNotExist(err), "absent vault created database")
	return nil
}
func cipherProof(v *vault) map[string]any {
	root := privateRoot()
	defer os.RemoveAll(root)
	symlinks(root)
	path := filepath.Join(root, "proof.db")
	create(path)
	db, err := v.open(path, "partition-v1")
	must(err)
	defer db.Close()
	exec(db, "PRAGMA temp_store=MEMORY; PRAGMA synchronous=FULL; PRAGMA wal_autocheckpoint=0")
	var mode string
	must(db.QueryRowContext(ctx, "PRAGMA journal_mode=WAL").Scan(&mode))
	check(mode == "wal", "WAL unavailable")
	metadata := "HR02_METADATA_synthetic_actor_resource_31c6705e"
	payload := "HR02_PAYLOAD_synthetic_diff_snapshot_eb974ff1"
	indexed := "HR02FTSSENTINEL935cdef191"
	sentinels := []string{metadata, payload, indexed}
	exec(db, "CREATE TABLE evidence(metadata TEXT,payload TEXT); CREATE INDEX metadata_index ON evidence(metadata); CREATE VIRTUAL TABLE search USING fts5(summary)")
	exec(db, "INSERT INTO evidence VALUES(?,?)", metadata, payload)
	exec(db, "INSERT INTO search VALUES(?)", indexed)
	var n int
	must(db.QueryRowContext(ctx, "SELECT count(*) FROM search WHERE search MATCH ?", indexed).Scan(&n))
	check(n == 1, "FTS mismatch")
	wal, err := os.Stat(path + "-wal")
	must(err)
	check(wal.Size() > 32, "WAL unpopulated")
	for _, suffix := range []string{"", "-wal", "-shm"} {
		info, err := os.Stat(path + suffix)
		must(err)
		check(info.Mode().Perm() == 0600 && owned(info), "DB sidecar not private")
	}
	files := scan(root, sentinels)
	must(refuseLinks(root))
	rejected(path, nil)
	rejected(path, random(32))
	must(db.Close())
	db, err = v.open(path, "partition-v1")
	must(err)
	var actual string
	must(db.QueryRowContext(ctx, "SELECT payload FROM evidence").Scan(&actual))
	check(actual == payload, "payload reopen mismatch")
	backupKey := random(32)
	v.put("backup-v1", backupKey)
	backupKey, err = v.get("backup-v1")
	must(err)
	backup := filepath.Join(root, "backup.db")
	create(backup)
	exec(db, "ATTACH DATABASE ? AS backup KEY "+keySQL(backupKey), backup)
	exec(db, "SELECT sqlcipher_export('backup')")
	exec(db, "DETACH DATABASE backup")
	rejected(backup, nil)
	oldKey, err := v.get("partition-v1")
	must(err)
	rejected(backup, oldKey)
	copyDB, err := v.open(backup, "backup-v1")
	must(err)
	must(copyDB.QueryRowContext(ctx, "SELECT payload FROM evidence").Scan(&actual))
	check(actual == payload, "backup mismatch")
	must(copyDB.Close())
	exec(db, "PRAGMA wal_checkpoint(TRUNCATE)")
	must(db.QueryRowContext(ctx, "PRAGMA journal_mode=DELETE").Scan(&mode))
	check(mode == "delete", "rekey journal transition failed")
	newKey := random(32)
	v.put("partition-v2", newKey)
	newKey, err = v.get("partition-v2")
	must(err)
	exec(db, "PRAGMA rekey="+keySQL(newKey))
	must(db.Close())
	rejected(path, oldKey)
	rotated, err := v.open(path, "partition-v2")
	must(err)
	must(rotated.QueryRowContext(ctx, "SELECT payload FROM evidence").Scan(&actual))
	check(actual == payload, "rekey lost payload")
	must(rotated.Close())
	v.remove("partition-v1")
	_, err = v.get("partition-v1")
	check(err != nil, "retired key found")
	v.remove("partition-v2")
	v.remove("backup-v1")
	before := digest(path)
	deniedOpen(v, path, "partition-v2")
	check(before == digest(path), "deleted key mutated database")
	fresh := filepath.Join(root, "must-not-exist.db")
	deniedOpen(v, fresh, "partition-v2")
	_, err = os.Stat(fresh)
	check(os.IsNotExist(err), "deleted key created database")
	v.lock()
	deniedOpen(v, path, "partition-v2")
	check(before == digest(path), "locked vault mutated database")
	deniedOpen(v, fresh, "partition-v2")
	_, err = os.Stat(fresh)
	check(os.IsNotExist(err), "locked vault created database")
	var item, prompt dbus.ObjectPath
	props := map[string]dbus.Variant{iface + "Item.Label": dbus.MakeVariant(v.prefix + "locked"), iface + "Item.Attributes": dbus.MakeVariant(map[string]string{"proof-id": v.prefix})}
	callErr := call(v.collection, iface+"Collection.CreateItem", props, secret{v.session, []byte{}, random(32), "application/octet-stream"}, false).Store(&item, &prompt)
	if callErr == nil && item != "/" {
		var ignored dbus.ObjectPath
		call(item, iface+"Item.Delete").Store(&ignored)
	}
	check(callErr != nil, "locked vault accepted creation")
	files += scan(root, sentinels)
	return map[string]any{"target": runtime.GOOS + "/" + runtime.GOARCH, "driver": "mattn/go-sqlite3 v1.14.52", "sqlcipher": "4.20.0 community", "sqlite": "3.54.1", "crypto_provider": "openssl", "source_commit": "355d4db92d3404e71faa8088d071a71d767807f4", "keyed_pool_connections_verified": 2, "required_codec_compile_options": true, "real_secret_service_keys": true, "metadata_index_payload_fts_db_wal_no_plaintext_sentinels": true, "private_artifacts_scanned": files, "wrong_and_missing_database_key_rejected": true, "encrypted_backup_distinct_key_reopen": true, "rekey_old_key_rejected_new_key_reopens": true, "native_key_retirement": true, "locked_and_deleted_vault_key_prevent_actual_database_mutation": true, "containment": "preexisting-symlinks-rejected-only", "limits": "synthetic Linux proof; not race-proof VFS containment, crash-safe rotation, signed application policy, desktop prompt/logout behavior, physical erasure or production history implementation"}
}
