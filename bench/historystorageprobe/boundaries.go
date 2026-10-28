package main

import (
	"database/sql"
	"fmt"
	"path/filepath"
)

// boundaryProof uses disposable synthetic tables, not a proposed history schema.
func boundaryProof(root string) map[string]bool {
	path := filepath.Join(root, "boundaries.db")
	writer := open(path)
	defer writer.Close()
	var mode string
	must(writer.QueryRow("PRAGMA journal_mode=WAL").Scan(&mode))
	expect(mode == "wal", "WAL not enabled for boundary proof")
	_, err := writer.Exec(`CREATE TABLE evidence(id INTEGER PRIMARY KEY, summary TEXT);
CREATE VIRTUAL TABLE search USING fts5(summary);
CREATE TABLE recovery(position INTEGER);
INSERT INTO recovery VALUES(0);
PRAGMA user_version=1;`)
	must(err)
	contender := open(path)
	defer contender.Close()
	_, err = contender.Exec("PRAGMA busy_timeout=25")
	must(err)
	tx, err := writer.Begin()
	must(err)
	_, err = tx.Exec("INSERT INTO evidence VALUES(1,'allowed replicas'); INSERT INTO search(rowid,summary) VALUES(1,'allowed replicas'); UPDATE recovery SET position=1")
	must(err)
	_, err = contender.Exec("INSERT INTO evidence VALUES(2,'blocked writer')")
	expect(sqliteCode(err, 5), fmt.Sprintf("expected SQLITE_BUSY, got %v", err))
	expect(number(contender, "SELECT position FROM recovery") == 0, "uncommitted checkpoint visible")
	must(tx.Commit())
	expect(number(contender, "SELECT position FROM recovery") == 1, "committed checkpoint absent")

	migration, err := writer.Begin()
	must(err)
	_, err = migration.Exec("ALTER TABLE evidence ADD COLUMN revision INTEGER; PRAGMA user_version=2")
	must(err)
	var inTx int64
	must(migration.QueryRow("PRAGMA user_version").Scan(&inTx))
	expect(inTx == 2, "migration version not applied inside transaction")
	must(migration.QueryRow("SELECT count(*) FROM pragma_table_info('evidence') WHERE name='revision'").Scan(&inTx))
	expect(inTx == 1, "migration DDL not applied inside transaction")
	must(migration.QueryRow("SELECT count(*) FROM sqlite_schema WHERE name='absent_table'").Scan(&inTx))
	expect(inTx == 0, "failure target table unexpectedly exists")
	_, err = migration.Exec("INSERT INTO absent_table VALUES(1)")
	expect(sqliteCode(err, 1), fmt.Sprintf("expected SQLITE_ERROR for missing table, got %v", err))
	must(migration.Rollback())
	expect(number(writer, "PRAGMA user_version") == 1, "failed migration advanced version")
	expect(number(writer, "SELECT count(*) FROM pragma_table_info('evidence') WHERE name='revision'") == 0, "failed migration retained DDL")

	purge, err := writer.Begin()
	must(err)
	_, err = purge.Exec("DELETE FROM evidence WHERE id=1; DELETE FROM search WHERE rowid=1")
	must(err)
	must(purge.Rollback())
	expect(number(writer, "SELECT count(*) FROM evidence") == 1, "rolled back purge lost evidence")
	expect(number(writer, "SELECT count(*) FROM search WHERE search MATCH 'replicas'") == 1, "rolled back purge lost search")
	_, err = writer.Exec("BEGIN; DELETE FROM evidence WHERE id=1; DELETE FROM search WHERE rowid=1; COMMIT")
	must(err)
	expect(number(writer, "SELECT count(*) FROM search WHERE search MATCH 'replicas'") == 0, "purged summary still searchable")

	readonly, err := sql.Open("sqlite", "file:"+filepath.ToSlash(path)+"?mode=ro")
	must(err)
	defer readonly.Close()
	_, err = readonly.Exec("INSERT INTO evidence VALUES(3,'forbidden write')")
	expect(sqliteCode(err, 8), fmt.Sprintf("expected SQLITE_READONLY, got %v", err))
	return map[string]bool{"writer_contention_no_partial_commit": true, "failed_migration_ddl_and_version_rollback": true, "purge_evidence_and_fts_transaction": true, "readonly_connection_rejects_write": true}
}
