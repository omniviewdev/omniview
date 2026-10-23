package devsession

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

type metadataFixture struct {
	WorkspaceID string `json:"workspaceID"`
	Generation  string `json:"generation"`
}

func TestPrivateMetadataPreservesSeparateWorkspacePayloadsAndEncoderBytes(t *testing.T) {
	base := t.TempDir()
	one, err := EnsurePrivateDirectory(filepath.Join(base, fixtureWorkspace, "runtime"))
	if err != nil {
		t.Fatal(err)
	}
	two, err := EnsurePrivateDirectory(filepath.Join(base, secondWorkspace, "runtime"))
	if err != nil {
		t.Fatal(err)
	}
	if one == two {
		t.Fatal("distinct workspace directories collapsed")
	}
	onePath, twoPath := filepath.Join(one, "ledger.json"), filepath.Join(two, "ledger.json")
	if err := WritePrivateJSON(onePath, metadataFixture{WorkspaceID: fixtureWorkspace, Generation: "one"}); err != nil {
		t.Fatal(err)
	}
	if err := WritePrivateJSON(twoPath, metadataFixture{WorkspaceID: secondWorkspace, Generation: "two"}); err != nil {
		t.Fatal(err)
	}
	firstBytes, err := os.ReadFile(onePath)
	if err != nil {
		t.Fatal(err)
	}
	if string(firstBytes) != "{\"workspaceID\":\"f14566c4-5130-4e3f-aa09-3e49c63b29a6\",\"generation\":\"one\"}\n" {
		t.Fatalf("metadata encoder bytes changed: %q", firstBytes)
	}
	if err := WritePrivateJSON(onePath, metadataFixture{WorkspaceID: fixtureWorkspace, Generation: "replacement"}); err != nil {
		t.Fatal(err)
	}
	var first, second metadataFixture
	if err := ReadPrivateJSON(onePath, &first); err != nil {
		t.Fatal(err)
	}
	if err := ReadPrivateJSON(twoPath, &second); err != nil {
		t.Fatal(err)
	}
	if first.WorkspaceID != fixtureWorkspace || first.Generation != "replacement" || second.WorkspaceID != secondWorkspace || second.Generation != "two" {
		t.Fatalf("workspace metadata crossed roots: %+v %+v", first, second)
	}
	if runtime.GOOS != "windows" {
		for path, mode := range map[string]os.FileMode{one: 0700, onePath: 0600, two: 0700, twoPath: 0600} {
			info, err := os.Stat(path)
			if err != nil {
				t.Fatal(err)
			}
			if info.Mode().Perm() != mode {
				t.Fatalf("%s mode = %o", path, info.Mode().Perm())
			}
		}
	}
}

func TestPrivateMetadataEncodingFailurePreservesPublishedBytes(t *testing.T) {
	root, err := EnsurePrivateDirectory(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "ledger.json")
	if err := WritePrivateJSON(path, metadataFixture{WorkspaceID: fixtureWorkspace, Generation: "complete"}); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := WritePrivateJSON(path, make(chan int)); err == nil {
		t.Fatal("unencodable metadata was accepted")
	}
	after, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatalf("failed encoding damaged published metadata: %v", err)
	}
	entries, err := os.ReadDir(root)
	if err != nil || len(entries) != 1 {
		t.Fatalf("failed encoding left temporary metadata: %v %v", entries, err)
	}
}

func TestPrivateByteWriterPersistsUnencodedTokenAndAtomicallyReplacesIt(t *testing.T) {
	root, err := EnsurePrivateDirectory(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "supervisor.secret")
	first := []byte("raw-token-012345678901234567890123456789")
	second := []byte("replacement-token-012345678901234567890123")
	if err := WritePrivateFile(path, first); err != nil {
		t.Fatal(err)
	}
	actual, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(actual, first) {
		t.Fatalf("raw token was JSON encoded or damaged: %v", err)
	}
	if err := WritePrivateFile(path, second); err != nil {
		t.Fatal(err)
	}
	actual, err = os.ReadFile(path)
	if err != nil || !bytes.Equal(actual, second) {
		t.Fatalf("raw replacement failed: %v", err)
	}
}

func TestPrivateMetadataRejectsSymlinkLeafWithoutChangingOutsideBytes(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("fixture symlink creation requires optional Windows privileges")
	}
	root, err := EnsurePrivateDirectory(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(t.TempDir(), "outside.json")
	original := []byte("{\"workspaceID\":\"foreign\",\"generation\":\"untouched\"}\n")
	if err := os.WriteFile(outside, original, 0600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(root, "ledger.json")
	if err := os.Symlink(outside, link); err != nil {
		t.Fatal(err)
	}
	var value metadataFixture
	if err := ReadPrivateJSON(link, &value); !errors.Is(err, ErrOwnership) {
		t.Fatalf("metadata symlink read accepted: %v", err)
	}
	if err := WritePrivateJSON(link, metadataFixture{WorkspaceID: fixtureWorkspace, Generation: "replacement"}); !errors.Is(err, ErrOwnership) {
		t.Fatalf("metadata symlink write accepted: %v", err)
	}
	if err := WritePrivateFile(link, []byte("replacement")); !errors.Is(err, ErrOwnership) {
		t.Fatalf("raw symlink write accepted: %v", err)
	}
	actual, err := os.ReadFile(outside)
	if err != nil || !bytes.Equal(actual, original) {
		t.Fatalf("foreign bytes changed: %v", err)
	}
}

func TestPrivateMetadataRejectsPublicUnixFileWithoutRewritingIt(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows DACL behavior has a platform-specific test")
	}
	root, err := EnsurePrivateDirectory(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "ledger.json")
	if err := WritePrivateJSON(path, metadataFixture{WorkspaceID: fixtureWorkspace, Generation: "private"}); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, 0644); err != nil {
		t.Fatal(err)
	}
	var value metadataFixture
	if err := ReadPrivateJSON(path, &value); !errors.Is(err, ErrOwnership) {
		t.Fatalf("public metadata read accepted: %v", err)
	}
	if err := WritePrivateJSON(path, metadataFixture{WorkspaceID: fixtureWorkspace, Generation: "replacement"}); !errors.Is(err, ErrOwnership) {
		t.Fatalf("public metadata overwritten: %v", err)
	}
	after, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatalf("rejected public metadata was rewritten: %v", err)
	}
}

func TestEmptyPrivateFileInitializesOwnedAppendLog(t *testing.T) {
	root, err := EnsurePrivateDirectory(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "compiler.log")
	if err := WritePrivateFile(path, nil); err != nil {
		t.Fatal(err)
	}
	if err := ValidatePrivateFile(path); err != nil {
		t.Fatalf("empty log lacks private ownership: %v", err)
	}
	checked, err := os.Lstat(path)
	if err != nil {
		t.Fatal(err)
	}
	log, err := os.OpenFile(path, os.O_WRONLY|os.O_APPEND, 0)
	if err != nil {
		t.Fatal(err)
	}
	opened, err := log.Stat()
	if err != nil {
		log.Close()
		t.Fatal(err)
	}
	if !os.SameFile(checked, opened) {
		log.Close()
		t.Fatal("append handle differs from validated log")
	}
	if _, err := log.WriteString("owned compiler output\n"); err != nil {
		log.Close()
		t.Fatal(err)
	}
	if err := log.Close(); err != nil {
		t.Fatal(err)
	}
	if err := ValidatePrivateFile(path); err != nil {
		t.Fatal(err)
	}
	actual, err := os.ReadFile(path)
	if err != nil || string(actual) != "owned compiler output\n" {
		t.Fatalf("owned append output lost: %v", err)
	}
}

func TestPrivateLockRetainsInodeAcrossContentionAndReacquisition(t *testing.T) {
	root, err := EnsurePrivateDirectory(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	first, err := AcquirePrivateLock(context.Background(), root, "supervisor.lock")
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	path := filepath.Join(root, "supervisor.lock")
	if err := ValidatePrivateFile(path); err != nil {
		t.Fatal(err)
	}
	before, err := os.Lstat(path)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Millisecond)
	defer cancel()
	if competing, err := AcquirePrivateLock(ctx, root, "supervisor.lock"); err == nil {
		competing.Close()
		t.Fatal("contending acquisition replaced or bypassed the held inode")
	} else if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("contending lock error = %v", err)
	}
	after, err := os.Lstat(path)
	if err != nil || !os.SameFile(before, after) {
		t.Fatalf("contention replaced lock inode: %v", err)
	}
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}
	second, err := AcquirePrivateLock(context.Background(), root, "supervisor.lock")
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	locked, err := second.Stat()
	if err != nil || !os.SameFile(before, locked) {
		t.Fatalf("reacquisition changed lock inode: %v", err)
	}
}

func TestPrivateLockRejectsNonLeafNamesBeforeCreatingFiles(t *testing.T) {
	root, err := EnsurePrivateDirectory(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"", ".", "..", "../escape", "nested/lock", "nested\\lock", "lock\x00name"} {
		if lock, err := AcquirePrivateLock(context.Background(), root, name); !errors.Is(err, ErrOwnership) {
			if lock != nil {
				lock.Close()
			}
			t.Errorf("invalid lock name %q accepted: %v", name, err)
		}
	}
	files, err := os.ReadDir(root)
	if err != nil || len(files) != 0 {
		t.Fatalf("invalid lock names created files: %v %v", files, err)
	}
}

func TestPrivateLockRejectsSymlinkWithoutFollowingOutsideFile(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("fixture symlink creation requires optional Windows privileges")
	}
	root, err := EnsurePrivateDirectory(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(t.TempDir(), "outside.lock")
	if err := os.WriteFile(outside, []byte("foreign lock bytes"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "supervisor.lock")); err != nil {
		t.Fatal(err)
	}
	if lock, err := AcquirePrivateLock(context.Background(), root, "supervisor.lock"); !errors.Is(err, ErrOwnership) {
		if lock != nil {
			lock.Close()
		}
		t.Fatalf("symlink lock adopted: %v", err)
	}
	actual, err := os.ReadFile(outside)
	if err != nil || string(actual) != "foreign lock bytes" {
		t.Fatalf("outside lock file changed: %v", err)
	}
}
