package devbaseline

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"time"

	bolt "go.etcd.io/bbolt"
)

const integrityArgument = "--omniview-internal-baseline-integrity-v1"
const integrityEnvironment = "OMNIVIEW_INTERNAL_BASELINE_INTEGRITY"
const maxDatabaseBytes int64 = 256 << 20

// The checker runs in the exact executable that links this package (including
// Go test binaries), before its application/test main. Both explicit selectors
// are required. The sole input is a source path on stdin; it opens only read-only
// state and cannot execute arbitrary application commands or write/recover state.
// It deliberately lives in a child process: bbolt Check starts goroutines whose
// malformed-page panics cannot be contained by a caller's deferred recover.
func init() {
	if len(os.Args) != 2 || os.Args[1] != integrityArgument || os.Getenv(integrityEnvironment) != "1" {
		return
	}
	path, err := io.ReadAll(io.LimitReader(os.Stdin, 1<<20))
	if err != nil || len(path) == 0 || len(path) >= 1<<20 || strings.IndexByte(string(path), 0) >= 0 {
		os.Exit(2)
	}
	if checkIntegrity(string(path)) != nil {
		os.Exit(1)
	}
	os.Exit(0)
}

func openReadOnlyDatabase(path string) (*bolt.DB, error) {
	return bolt.Open(path, 0600, &bolt.Options{ReadOnly: true, Timeout: time.Second, OpenFile: func(name string, _ int, _ os.FileMode) (*os.File, error) {
		file, err := openRegular(name)
		if err != nil {
			return nil, err
		}
		info, err := file.Stat()
		if err != nil {
			_ = file.Close()
			return nil, err
		}
		if info.Size() > maxDatabaseBytes {
			_ = file.Close()
			return nil, fmt.Errorf("baseline: settings database exceeds 256 MiB safety limit")
		}
		return file, nil
	}})
}

func checkIntegrity(path string) error {
	db, err := openReadOnlyDatabase(path)
	if err != nil {
		return err
	}
	defer db.Close()
	return db.View(func(tx *bolt.Tx) error {
		invalid := false
		for range tx.Check() {
			invalid = true
		}
		if invalid {
			return fmt.Errorf("baseline: corrupt settings database")
		}
		return nil
	})
}

func probeIntegrity(ctx context.Context, path string) error {
	executable, err := os.Executable()
	if err != nil {
		return fmt.Errorf("baseline: cannot locate integrity checker executable")
	}
	bounded, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	command := exec.CommandContext(bounded, executable, integrityArgument)
	command.Env = append(os.Environ(), integrityEnvironment+"=1", "GOTRACEBACK=none")
	command.Stdin = strings.NewReader(path)
	// Panic traces and driver errors can contain private paths or bytes. They are
	// not logged, included in errors, or exposed as baseline provenance.
	command.Stdout = io.Discard
	command.Stderr = io.Discard
	if err := command.Run(); err != nil {
		if err := bounded.Err(); err != nil {
			return fmt.Errorf("baseline: integrity checker interrupted: %w", err)
		}
		return fmt.Errorf("baseline: settings integrity check failed; source was not modified")
	}
	return nil
}
