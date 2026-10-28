package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"

	"modernc.org/sqlite"
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
func sqliteCode(err error, code int) bool {
	var failure *sqlite.Error
	return errors.As(err, &failure) && failure.Code() == code
}
func open(path string) *sql.DB {
	db, err := sql.Open("sqlite", path)
	must(err)
	db.SetMaxOpenConns(1)
	_, err = db.Exec("PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;")
	must(err)
	return db
}
func number(db *sql.DB, query string, args ...any) int64 {
	var n int64
	must(db.QueryRow(query, args...).Scan(&n))
	return n
}
func child() {
	db := open(os.Args[2])
	tx, err := db.Begin()
	must(err)
	_, err = tx.Exec("INSERT INTO records VALUES(99, 99, 'uid-old', 'child'); INSERT INTO checkpoint VALUES('child', 99);")
	must(err)
	if os.Args[1] == "after" {
		must(tx.Commit())
	}
	os.Exit(23) // Deliberately bypass deferred cleanup; not a power-loss simulation.
}
func main() {
	if len(os.Args) > 1 {
		if len(os.Args) != 3 || (os.Args[1] != "before" && os.Args[1] != "after") {
			fmt.Fprintln(os.Stderr, "Run without arguments; before/after are internal child modes.")
			os.Exit(2)
		}
		child()
		return
	}
	root, err := os.MkdirTemp("", "history-sqlite-proof-")
	must(err)
	defer os.RemoveAll(root)
	path := filepath.Join(root, "evidence.db")
	f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600)
	must(err)
	must(f.Close())
	db := open(path)
	defer db.Close()
	var mode, version string
	must(db.QueryRow("PRAGMA journal_mode=WAL").Scan(&mode))
	expect(mode == "wal", "WAL not enabled")
	must(db.QueryRow("SELECT sqlite_version()").Scan(&version))
	_, err = db.Exec(`CREATE TABLE records(id INTEGER PRIMARY KEY, t INTEGER, resource TEXT, body TEXT);
 CREATE INDEX timeline ON records(resource,t,id);
 CREATE VIRTUAL TABLE text_index USING fts5(body);
 CREATE TABLE checkpoint(source TEXT PRIMARY KEY, pos INTEGER);
 INSERT INTO checkpoint VALUES('seed',0);`)
	must(err)
	tx, err := db.Begin()
	must(err)
	for _, r := range []struct {
		id, t          int
		resource, body string
	}{{1, 10, "uid-old", "replicas café 東京"}, {2, 10, "uid-old", "image changed"}, {3, 11, "uid-new", "replicas changed"}} {
		_, err = tx.Exec("INSERT INTO records VALUES(?,?,?,?)", r.id, r.t, r.resource, r.body)
		must(err)
		_, err = tx.Exec("INSERT INTO text_index(rowid,body) VALUES(?,?)", r.id, r.body)
		must(err)
	}
	_, err = tx.Exec("UPDATE checkpoint SET pos=3 WHERE source='seed'")
	must(err)
	must(tx.Commit())
	expect(number(db, "SELECT count(*) FROM text_index WHERE text_index MATCH ?", "cafe") == 1, "Unicode tokenizer mismatch")
	expect(number(db, "SELECT count(*) FROM text_index WHERE text_index MATCH ?", "rep") == 0, "FTS is not substring")
	expect(number(db, "SELECT count(*) FROM records WHERE instr(body,?)>0", "rep") == 2, "substring control mismatch")
	expect(number(db, "SELECT count(*) FROM text_index WHERE text_index MATCH ?", "東京") == 1, "Unicode token mismatch")
	expect(number(db, "SELECT id FROM records WHERE resource=? AND (t,id)>(?,?) ORDER BY t,id LIMIT 1", "uid-old", 10, 1) == 2, "equal-time keyset mismatch")
	reader := open(path)
	snapshot, err := reader.Begin()
	must(err)
	var old int64
	must(snapshot.QueryRow("SELECT count(*) FROM records").Scan(&old))
	_, err = db.Exec("INSERT INTO records VALUES(4,12,'uid-old','concurrent writer')")
	must(err)
	var stillOld int64
	must(snapshot.QueryRow("SELECT count(*) FROM records").Scan(&stillOld))
	expect(old == 3 && stillOld == 3, "WAL snapshot changed")
	must(snapshot.Rollback())
	expect(number(reader, "SELECT count(*) FROM records") == 4, "fresh reader missed commit")
	must(reader.Close())
	modes := map[string]string{}
	for _, name := range []string{"evidence.db", "evidence.db-wal", "evidence.db-shm"} {
		info, e := os.Stat(filepath.Join(root, name))
		must(e)
		modes[name] = info.Mode().Perm().String()
		expect(info.Mode().Perm()&0077 == 0, "nonprivate sidecar")
	}
	must(db.Close())
	exe, err := os.Executable()
	must(err)
	for _, stage := range []string{"before", "after"} {
		cmd := exec.Command(exe, stage, path)
		output, e := cmd.CombinedOutput()
		exit, ok := e.(*exec.ExitError)
		expect(ok && exit.ExitCode() == 23, fmt.Sprintf("child %s failed: %v %s", stage, e, output))
		reopened := open(path)
		expected := int64(0)
		if stage == "after" {
			expected = 1
		}
		expect(number(reopened, "SELECT count(*) FROM records WHERE id=99") == expected, "crash evidence mismatch")
		expect(number(reopened, "SELECT count(*) FROM checkpoint WHERE source='child'") == expected, "checkpoint ahead of evidence")
		must(reopened.Close())
	}
	reopened := open(path)
	start := time.Now()
	batch, err := reopened.Begin()
	must(err)
	stmt, err := batch.Prepare("INSERT INTO records VALUES(?,?,?,?)")
	must(err)
	for i := 1000; i < 11000; i++ {
		_, err = stmt.Exec(i, i, "uid-perf", "synthetic replicas image changed")
		must(err)
	}
	must(stmt.Close())
	must(batch.Commit())
	elapsed := time.Since(start)
	var checkpointed, logFrames, doneFrames int
	must(reopened.QueryRow("PRAGMA wal_checkpoint(TRUNCATE)").Scan(&checkpointed, &logFrames, &doneFrames))
	must(reopened.Close())
	size, err := os.Stat(path)
	must(err)
	fullPath := filepath.Join(root, "full.db")
	full := open(fullPath)
	_, err = full.Exec("CREATE TABLE data(value BLOB); CREATE TABLE checkpoint(pos INTEGER); INSERT INTO checkpoint VALUES(0);")
	must(err)
	pages := number(full, "PRAGMA page_count")
	_, err = full.Exec(fmt.Sprintf("PRAGMA max_page_count=%d", pages))
	must(err)
	constrained, err := full.Begin()
	must(err)
	_, err = constrained.Exec("UPDATE checkpoint SET pos=1; INSERT INTO data VALUES(zeroblob(1048576));")
	expect(sqliteCode(err, 13), fmt.Sprintf("expected SQLITE_FULL, got %v", err))
	_ = constrained.Rollback()
	expect(number(full, "SELECT pos FROM checkpoint") == 0, "full database advanced checkpoint")
	must(full.Close())
	corruptPath := filepath.Join(root, "corrupt.db")
	must(os.WriteFile(corruptPath, []byte("not a sqlite database"), 0600))
	corrupt, err := sql.Open("sqlite", corruptPath)
	must(err)
	var x string
	err = corrupt.QueryRow("PRAGMA integrity_check").Scan(&x)
	expect(sqliteCode(err, 26), fmt.Sprintf("expected SQLITE_NOTADB, got %v", err))
	must(corrupt.Close())
	before, err := os.ReadFile(corruptPath)
	must(err)
	expect(string(before) == "not a sqlite database", "corrupt database replaced")
	report := map[string]any{"driver": "modernc.org/sqlite v1.61.0", "sqlite": version, "target": runtime.GOOS + "/" + runtime.GOARCH, "journal": mode, "synchronous": "FULL", "fts5": true, "unicode61_controls": true, "fts_is_not_substring": true, "equal_time_keyset": true, "wal_reader_snapshot": true, "process_exit_before_commit": "rolled back evidence and checkpoint", "process_exit_after_commit": "retained evidence and checkpoint", "page_quota_failure": "checkpoint unchanged", "corruption": "rejected without replacement", "permissions": modes, "synthetic_rows_inserted": 10000, "insert_elapsed_ms": elapsed.Milliseconds(), "database_bytes": size.Size(), "limits": "Synthetic local driver mechanics only; no authorization, redaction, encryption, canonical domain, power-loss, OS disk-full or cross-platform execution proof"}
	report["transaction_boundaries"] = boundaryProof(root)
	must(json.NewEncoder(os.Stdout).Encode(report))
}
