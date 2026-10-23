//go:build darwin || linux

package devsession

import (
	"errors"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/omniviewdev/omniview/internal/devcontract"
)

func socketDirectoryFixture(t *testing.T, workspace string) (string, devcontract.ProcessIdentity) {
	t.Helper()
	runtime := filepath.Join(t.TempDir(), strings.Repeat("long-profile-", 12), "runtime")
	if err := os.MkdirAll(runtime, 0700); err != nil {
		t.Fatal(err)
	}
	runtime, err := filepath.EvalSymlinks(runtime)
	if err != nil {
		t.Fatal(err)
	}
	owner, err := CaptureProcess(os.Getpid(), ProcessOwner{WorkspaceID: workspace, Generation: uuid.NewString(), Role: "supervisor", Source: filepath.Dir(runtime)})
	if err != nil {
		t.Fatal(err)
	}
	return runtime, owner
}

func exchangeSocketNonce(t *testing.T, path, nonce string) net.Listener {
	t.Helper()
	listener, err := net.Listen("unix", path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { listener.Close() })
	served := make(chan error, 1)
	go func() {
		connection, err := listener.Accept()
		if err == nil {
			defer connection.Close()
			_, err = io.WriteString(connection, nonce)
		}
		served <- err
	}()
	connection, err := net.DialTimeout("unix", path, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	if err := connection.SetReadDeadline(time.Now().Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	actual, err := io.ReadAll(connection)
	if err != nil || string(actual) != nonce {
		t.Fatalf("socket nonce=%q want=%q err=%v", actual, nonce, err)
	}
	if err := <-served; err != nil {
		t.Fatal(err)
	}
	return listener
}

func TestUnixSocketDirectoryLongHOMEAndIndependentGenerations(t *testing.T) {
	runtimeA, ownerA := socketDirectoryFixture(t, "9d799eef-e491-493f-942a-54ac906ca34e")
	runtimeB, ownerB := socketDirectoryFixture(t, "22f2dbb0-9ecd-4b17-9690-a0c2239387ac")
	t.Setenv("HOME", filepath.Dir(runtimeA))
	t.Setenv("TMPDIR", runtimeA)
	a, err := CreateUnixSocketDirectory(runtimeA, ownerA)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := a.Close(); err != nil {
			t.Error(err)
		}
	})
	b, err := CreateUnixSocketDirectory(runtimeB, ownerB)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := b.Close(); err != nil {
			t.Error(err)
		}
	})
	pathA, err := ReadUnixSocketDirectory(runtimeA, ownerA.WorkspaceID, ownerA.Generation, ownerA.Source)
	if err != nil {
		t.Fatal(err)
	}
	pathB, err := ReadUnixSocketDirectory(runtimeB, ownerB.WorkspaceID, ownerB.Generation, ownerB.Source)
	if err != nil {
		t.Fatal(err)
	}
	if pathA == pathB || a.record.Nonce == b.record.Nonce {
		t.Fatal("independent profiles shared socket namespace")
	}
	for _, path := range []string{pathA, pathB} {
		info, err := os.Lstat(path)
		if err != nil || info.Mode().Perm() != 0700 {
			t.Fatalf("socket directory is not exclusive/private: %v %v", info, err)
		}
	}
	listenerA := exchangeSocketNonce(t, filepath.Join(pathA, "plugin1234567890"), "profile-A-nonce")
	listenerA.(*net.UnixListener).SetUnlinkOnClose(false)
	listenerB := exchangeSocketNonce(t, filepath.Join(pathB, "plugin9876543210"), "profile-B-nonce")
	if _, err := ReadUnixSocketDirectory(runtimeA, ownerA.WorkspaceID, ownerB.Generation, ownerA.Source); err == nil {
		t.Fatal("foreign generation adopted socket root")
	}
	if err := ValidateUnixSocketDirectoriesRemoved(runtimeA); !errors.Is(err, ErrOwnership) {
		t.Fatalf("live ownership record permitted profile purge: %v", err)
	}
	if err := listenerA.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(filepath.Join(pathA, "plugin1234567890")); err != nil {
		t.Fatalf("fixture did not retain the disposed socket inode: %v", err)
	}
	if err := a.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(pathA); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("owned root retained: %v", err)
	}
	if _, err := os.Lstat(pathB); err != nil {
		t.Fatalf("A cleanup touched B: %v", err)
	}
	if err := listenerB.Close(); err != nil {
		t.Fatal(err)
	}
	if err := b.Close(); err != nil {
		t.Fatal(err)
	}
	if err := ValidateUnixSocketDirectoriesRemoved(runtimeA); err != nil {
		t.Fatal(err)
	}
	if err := ValidateUnixSocketDirectoriesRemoved(runtimeB); err != nil {
		t.Fatal(err)
	}
}

func TestUnixSocketDirectoryRefusesAdoptionAndForeignReplacement(t *testing.T) {
	runtime, owner := socketDirectoryFixture(t, "9d799eef-e491-493f-942a-54ac906ca34e")
	directory, err := CreateUnixSocketDirectory(runtime, owner)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := CreateUnixSocketDirectory(runtime, owner); !errors.Is(err, ErrOwnership) {
		t.Fatalf("existing generation adopted: %v", err)
	}
	path := directory.record.Root
	retained := path + "-retained"
	if err := os.Rename(path, retained); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(path, 0700); err != nil {
		t.Fatal(err)
	}
	foreign := filepath.Join(path, "foreign")
	if err := os.WriteFile(foreign, []byte("not owned"), 0600); err != nil {
		t.Fatal(err)
	}
	defer func() {
		os.Remove(foreign)
		os.Remove(path)
		if err := os.Rename(retained, path); err != nil {
			t.Error(err)
			return
		}
		if err := directory.Close(); err != nil {
			t.Error(err)
		}
	}()
	if err := directory.Close(); !errors.Is(err, ErrOwnership) {
		t.Fatalf("foreign inode cleanup was accepted: %v", err)
	}
	if _, err := ReadUnixSocketDirectory(runtime, owner.WorkspaceID, owner.Generation, owner.Source); !errors.Is(err, ErrOwnership) {
		t.Fatalf("foreign root read was accepted: %v", err)
	}
	if content, err := os.ReadFile(foreign); err != nil || string(content) != "not owned" {
		t.Fatalf("foreign replacement changed: %q %v", content, err)
	}
	if err := ValidateUnixSocketDirectoriesRemoved(runtime); !errors.Is(err, ErrOwnership) {
		t.Fatalf("retained proof permitted purge: %v", err)
	}
}

func TestUnixSocketDirectoryRefusesUnrecordedContentsAndMalformedProof(t *testing.T) {
	runtime, owner := socketDirectoryFixture(t, "9d799eef-e491-493f-942a-54ac906ca34e")
	directory, err := CreateUnixSocketDirectory(runtime, owner)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := directory.Close(); err != nil {
			t.Error(err)
		}
	}()
	foreign := filepath.Join(directory.record.Root, "plugin123")
	if err := os.WriteFile(foreign, []byte("regular files are not plugin sockets"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := directory.Close(); !errors.Is(err, ErrOwnership) {
		t.Fatalf("unknown file was adopted: %v", err)
	}
	if err := os.Remove(foreign); err != nil {
		t.Fatal(err)
	}
	proof, err := os.ReadFile(directory.recordPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(directory.recordPath, []byte("{"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := directory.Close(); err == nil {
		t.Fatal("malformed record authorized deletion")
	}
	if err := ValidateUnixSocketDirectoriesRemoved(runtime); !errors.Is(err, ErrOwnership) {
		t.Fatalf("malformed proof permitted purge: %v", err)
	}
	if err := os.WriteFile(directory.recordPath, proof, 0600); err != nil {
		t.Fatal(err)
	}
}

func TestUnixSocketDirectoryMissingRootRetainsProofUntilParentSyncSucceeds(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root bypasses the directory read-permission failure")
	}
	runtime, owner := socketDirectoryFixture(t, "9d799eef-e491-493f-942a-54ac906ca34e")
	base, err := os.MkdirTemp("/tmp", "ov-sync-")
	if err != nil {
		t.Fatal(err)
	}
	base, err = filepath.EvalSymlinks(base)
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(base)
	defer os.Chmod(base, 0700)
	t.Setenv("TMPDIR", base)
	directory, err := CreateUnixSocketDirectory(runtime, owner)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		os.Chmod(base, 0700)
		if err := directory.Close(); err != nil {
			t.Error(err)
		}
	}()
	if filepath.Dir(directory.record.Root) != base {
		t.Fatal("short private temp base was not selected")
	}
	// Reproduce a completed root unlink with a retained retirement record.
	// Execute-only parent access permits Lstat of the missing child, but
	// opening the parent to fsync it must fail without a production test hook.
	directory.record.Phase = "removing"
	if err := WritePrivateJSON(directory.recordPath, directory.record); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(directory.record.Root, socketOwnerMarker)); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(directory.record.Root); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(base, 0111); err != nil {
		t.Fatal(err)
	}
	if err := directory.Close(); err == nil {
		t.Fatal("missing-root retry retired ownership without successfully syncing the parent directory")
	}
	if _, err := os.Lstat(directory.recordPath); err != nil {
		t.Fatalf("failed parent sync discarded the last ownership record: %v", err)
	}
	if err := ValidateUnixSocketDirectoriesRemoved(runtime); !errors.Is(err, ErrOwnership) {
		t.Fatalf("failed parent sync permitted profile purge: %v", err)
	}
	if err := os.Chmod(base, 0700); err != nil {
		t.Fatal(err)
	}
	if err := directory.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(directory.recordPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("successful retry retained retirement proof: %v", err)
	}
}
