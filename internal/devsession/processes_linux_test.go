//go:build linux

package devsession

import (
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// Linux changes /proc/<pid>/exe to "... (deleted)" after unlink while the
// exact same process remains alive. That mismatch must never release its lease
// or authorize another generation to replace its discovery.
func TestUnlinkedLiveExecutableRetainsGenerationOwnership(t *testing.T) {
	if os.Getenv("OMNIVIEW_SESSION_UNLINK_FIXTURE") == "1" {
		_, _ = io.Copy(io.Discard, os.Stdin)
		return
	}
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	source, err := os.Open(executable)
	if err != nil {
		t.Fatal(err)
	}
	defer source.Close()
	ownedExecutable := filepath.Join(t.TempDir(), "owned-supervisor")
	copy, err := os.OpenFile(ownedExecutable, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0700)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := io.Copy(copy, source); err != nil {
		copy.Close()
		t.Fatal(err)
	}
	if err := copy.Close(); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(ownedExecutable, "-test.run=^TestUnlinkedLiveExecutableRetainsGenerationOwnership$")
	cmd.Env = append(os.Environ(), "GOWORK=off", "OMNIVIEW_SESSION_UNLINK_FIXTURE=1")
	input, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		input.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = input.Close(); _ = cmd.Wait() })
	owner := ProcessOwner{WorkspaceID: fixtureWorkspace, Generation: "unlink-old", Role: "supervisor", Source: "/fixture/source"}
	record, err := CaptureProcess(cmd.Process.Pid, owner)
	if err != nil {
		t.Fatal(err)
	}
	r := fixtureRegistry(t, t.TempDir(), RegistryOptions{})
	key := ServiceKey{WorkspaceID: fixtureWorkspace, Role: "vite"}
	if _, err := r.Reserve(context.Background(), LeaseRequest{Key: key, Owner: record}); err != nil {
		t.Fatal(err)
	}
	store, err := OpenDiscoveryStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	descriptor := fixtureDescriptor(t, owner.Generation)
	descriptor.Process = record
	token := []byte("fixture-token-012345678901234567890123456789")
	if _, err := store.Publish(context.Background(), descriptor, token); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(ownedExecutable); err != nil {
		t.Fatal(err)
	}
	current, err := CaptureProcess(cmd.Process.Pid, owner)
	if err != nil {
		t.Fatal(err)
	}
	if current.StartIdentity != record.StartIdentity || current.Executable == record.Executable || !strings.HasSuffix(current.Executable, " (deleted)") {
		t.Fatalf("fixture did not retain a live unlinked executable: before=%+v after=%+v", record, current)
	}
	if err := VerifyOwnedProcess(record, owner); !errors.Is(err, ErrOwnership) {
		t.Fatalf("executable mismatch accepted: %v", err)
	}
	if err := TerminateOwnedProcess(record, owner); !errors.Is(err, ErrOwnership) {
		t.Fatalf("changed executable authorized termination: %v", err)
	}
	newOwner := fixtureOwner(t, fixtureWorkspace, "unlink-new")
	if _, err := r.Reserve(context.Background(), LeaseRequest{Key: key, Owner: newOwner}); !errors.Is(err, ErrOwnership) {
		t.Errorf("live unlinked supervisor's lease stolen: %v", err)
	}
	if _, err := store.Publish(context.Background(), fixtureDescriptor(t, "unlink-new"), token); !errors.Is(err, ErrOwnership) {
		t.Errorf("live unlinked supervisor's discovery replaced: %v", err)
	}
	if _, err := store.Read(context.Background(), fixtureWorkspace, owner.Generation); err != nil {
		t.Errorf("live generation discovery lost: %v", err)
	}
}
