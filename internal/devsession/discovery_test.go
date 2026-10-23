package devsession

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

func fixtureDescriptor(t *testing.T, generation string) devcontract.InstanceDescriptor {
	t.Helper()
	return devcontract.InstanceDescriptor{SchemaVersion: devcontract.SchemaVersion, WorkspaceID: fixtureWorkspace, InstanceID: fixtureWorkspace, Generation: generation, Kind: "development", StateRoot: t.TempDir(), Process: fixtureOwner(t, fixtureWorkspace, generation), Readiness: "starting"}
}

func TestDiscoveryPublishesPrivateTokenReferenceAndRejectsForeignRemoval(t *testing.T) {
	root := t.TempDir()
	store, err := OpenDiscoveryStore(root)
	if err != nil {
		t.Fatal(err)
	}
	token := []byte("secret-token-fixture-at-least-32-bytes")
	descriptor := fixtureDescriptor(t, "discovery-one")
	discovery, err := store.Publish(context.Background(), descriptor, token)
	if err != nil {
		t.Fatal(err)
	}
	payload, err := os.ReadFile(filepath.Join(root, "discovery.json"))
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(payload, token) {
		t.Fatal("token value leaked into discovery JSON")
	}
	canonicalRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatal(err)
	}
	if !filepath.IsAbs(discovery.TokenFile) || filepath.Dir(discovery.TokenFile) != canonicalRoot {
		t.Fatalf("uncontained token reference: %s", discovery.TokenFile)
	}
	if runtime.GOOS != "windows" {
		for path, mode := range map[string]os.FileMode{root: 0700, filepath.Join(root, "discovery.json"): 0600, discovery.TokenFile: 0600} {
			info, err := os.Stat(path)
			if err != nil {
				t.Fatal(err)
			}
			if info.Mode().Perm() != mode {
				t.Fatalf("%s mode = %o, want %o", path, info.Mode().Perm(), mode)
			}
		}
	}
	if err := store.Remove(context.Background(), fixtureWorkspace, "foreign-generation"); !errors.Is(err, ErrOwnership) {
		t.Fatalf("foreign cleanup succeeded: %v", err)
	}
	actual, err := os.ReadFile(discovery.TokenFile)
	if err != nil || !bytes.Equal(actual, token) {
		t.Fatalf("foreign cleanup damaged token: %v", err)
	}
	if err := store.Remove(context.Background(), fixtureWorkspace, descriptor.Generation); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{discovery.TokenFile, filepath.Join(root, "discovery.json")} {
		if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("owned file remains: %s: %v", path, err)
		}
	}
	if err := store.Remove(context.Background(), fixtureWorkspace, descriptor.Generation); err != nil {
		t.Fatal(err)
	}
}

func TestDiscoveryRefusesToReplaceLiveGenerationAndReadsCurrentGeneration(t *testing.T) {
	store, err := OpenDiscoveryStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	first := fixtureDescriptor(t, "live-first")
	token := []byte("fixture-token-012345678901234567890123456789")
	if _, err := store.Publish(context.Background(), first, token); err != nil {
		t.Fatal(err)
	}
	second := fixtureDescriptor(t, "live-second")
	if _, err := store.Publish(context.Background(), second, token); !errors.Is(err, ErrOwnership) {
		t.Fatalf("replaced live generation: %v", err)
	}
	actual, err := store.Read(context.Background(), fixtureWorkspace, first.Generation)
	if err != nil || actual.Generation != first.Generation {
		t.Fatalf("wrong descriptor read: %+v %v", actual, err)
	}
	current, err := store.Read(context.Background(), fixtureWorkspace, "")
	if err != nil || current.Generation != first.Generation {
		t.Fatalf("current explicit-workspace discovery unavailable: %+v %v", current, err)
	}
	if _, err := store.Read(context.Background(), fixtureWorkspace, second.Generation); !errors.Is(err, ErrOwnership) {
		t.Fatalf("wrong generation read accepted: %v", err)
	}
	if _, err := store.Read(context.Background(), secondWorkspace, first.Generation); !errors.Is(err, ErrOwnership) {
		t.Fatalf("wrong workspace read accepted: %v", err)
	}
}

func TestDiscoveryReadersNeverObservePartialUpdates(t *testing.T) {
	root := t.TempDir()
	store, err := OpenDiscoveryStore(root)
	if err != nil {
		t.Fatal(err)
	}
	descriptor := fixtureDescriptor(t, "atomic")
	token := []byte("fixture-token-012345678901234567890123456789")
	if _, err := store.Publish(context.Background(), descriptor, token); err != nil {
		t.Fatal(err)
	}
	var group sync.WaitGroup
	errs := make(chan error, 1)
	group.Add(1)
	go func() {
		defer group.Done()
		for range 50 {
			current, err := store.Read(context.Background(), fixtureWorkspace, descriptor.Generation)
			if err != nil {
				errs <- err
				return
			}
			if current.DisplayName != "" && current.DisplayName != strings.Repeat("complete", 100) {
				errs <- errors.New("partial descriptor observed")
				return
			}
		}
	}()
	for range 20 {
		descriptor.DisplayName = strings.Repeat("complete", 100)
		if _, err := store.Publish(context.Background(), descriptor, token); err != nil {
			t.Fatal(err)
		}
	}
	group.Wait()
	close(errs)
	for err := range errs {
		t.Fatal(err)
	}
}

func TestInterruptedAtomicWritePreservesPreviouslyPublishedBytes(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "discovery.json")
	original := []byte(`{"generation":"complete"}`)
	if err := atomicPrivateWrite(path, func(file *os.File) error { _, err := file.Write(original); return err }); err != nil {
		t.Fatal(err)
	}
	interrupted := errors.New("fixture interrupted write")
	err := atomicPrivateWrite(path, func(file *os.File) error {
		if _, err := file.WriteString(`{"generation":`); err != nil {
			return err
		}
		return interrupted
	})
	if !errors.Is(err, interrupted) {
		t.Fatalf("interruption lost: %v", err)
	}
	actual, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(actual, original) {
		t.Fatalf("published file corrupted: %q %v", actual, err)
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name() != "discovery.json" {
		t.Fatalf("partial files remain: %v", entries)
	}
}

func TestDiscoveryRejectsSymlinkTargetsWithoutModifyingExternalFile(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("creating fixture symlinks requires optional Windows privileges")
	}
	root := t.TempDir()
	store, err := OpenDiscoveryStore(root)
	if err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(t.TempDir(), "outside")
	if err := os.WriteFile(outside, []byte("untouched"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "discovery.json")); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Publish(context.Background(), fixtureDescriptor(t, "symlink"), []byte("fixture-token-012345678901234567890123456789")); err == nil {
		t.Fatal("symlink discovery accepted")
	}
	actual, err := os.ReadFile(outside)
	if err != nil || string(actual) != "untouched" {
		t.Fatalf("external file changed: %q %v", actual, err)
	}
}

func TestStaleDiscoveryCanBeReplacedButOldGenerationCannotDeleteNewToken(t *testing.T) {
	root := t.TempDir()
	store, err := OpenDiscoveryStore(root)
	if err != nil {
		t.Fatal(err)
	}
	token := []byte("fixture-token-012345678901234567890123456789")
	previous, err := store.Publish(context.Background(), fixtureDescriptor(t, "stale-first"), token)
	if err != nil {
		t.Fatal(err)
	}
	previous.Process.StartIdentity = "reused-pid-with-another-start"
	if err := WritePrivateJSON(filepath.Join(root, "discovery.json"), previous); err != nil {
		t.Fatal(err)
	}
	current, err := store.Publish(context.Background(), fixtureDescriptor(t, "stale-second"), token)
	if err != nil {
		t.Fatal(err)
	}
	if current.TokenFile == previous.TokenFile {
		t.Fatal("generations shared a token filename")
	}
	if err := store.Remove(context.Background(), fixtureWorkspace, previous.Generation); !errors.Is(err, ErrOwnership) {
		t.Fatalf("old generation deleted new discovery: %v", err)
	}
	actual, err := os.ReadFile(current.TokenFile)
	if err != nil || !bytes.Equal(actual, token) {
		t.Fatalf("new token damaged by stale cleanup: %v", err)
	}
}

func TestMissingTokenDoesNotMakeLiveDiscoveryUnowned(t *testing.T) {
	store, err := OpenDiscoveryStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	token := []byte("fixture-token-012345678901234567890123456789")
	first, err := store.Publish(context.Background(), fixtureDescriptor(t, "missing-token-first"), token)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(first.TokenFile); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Publish(context.Background(), fixtureDescriptor(t, "missing-token-second"), token); !errors.Is(err, ErrOwnership) {
		t.Fatalf("live discovery without token was stolen: %v", err)
	}
}

func TestGenerationTokenCannotBeRotatedByDiscoveryRefresh(t *testing.T) {
	store, err := OpenDiscoveryStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	descriptor := fixtureDescriptor(t, "stable-token")
	token, err := GenerateToken()
	if err != nil {
		t.Fatal(err)
	}
	first, err := store.Publish(context.Background(), descriptor, token)
	if err != nil {
		t.Fatal(err)
	}
	replacement, err := GenerateToken()
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(token, replacement) {
		t.Fatal("independently generated bearer tokens matched")
	}
	if _, err := store.Publish(context.Background(), descriptor, replacement); !errors.Is(err, ErrOwnership) {
		t.Fatalf("generation token silently rotated: %v", err)
	}
	actual, err := os.ReadFile(first.TokenFile)
	if err != nil || !bytes.Equal(actual, token) {
		t.Fatalf("failed refresh changed token: %v", err)
	}
}
