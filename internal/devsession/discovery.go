package devsession

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

// GenerateToken returns 256 bits of randomness encoded for a bearer token file.
// Callers must never serialize its value into discovery, inspect or log output.
func GenerateToken() ([]byte, error) {
	var random [32]byte
	if _, err := rand.Read(random[:]); err != nil {
		return nil, err
	}
	return base64.RawURLEncoding.AppendEncode(make([]byte, 0, 43), random[:]), nil
}

// DiscoveryStore owns one dedicated profile runtime directory. Its shared lock
// serializes publication and generation-checked cleanup across host processes.
type DiscoveryStore struct{ root string }

func OpenDiscoveryStore(runtimeDirectory string) (*DiscoveryStore, error) {
	root, err := EnsurePrivateDirectory(runtimeDirectory)
	if err != nil {
		return nil, err
	}
	return &DiscoveryStore{root: root}, nil
}

func (store *DiscoveryStore) tokenPath(workspaceID, generation string) string {
	hash := sha256.Sum256([]byte(workspaceID + "\x00" + generation))
	return filepath.Join(store.root, "control-token-"+hex.EncodeToString(hash[:])+".secret")
}

func validateDescriptor(descriptor devcontract.InstanceDescriptor) error {
	if descriptor.SchemaVersion != devcontract.SchemaVersion || !validWorkspace(descriptor.WorkspaceID) || !validWorkspace(descriptor.InstanceID) || !validLabel(descriptor.Generation) || descriptor.Kind != "development" || !filepath.IsAbs(descriptor.StateRoot) {
		return fmt.Errorf("%w: invalid development discovery identity", ErrOwnership)
	}
	if descriptor.Process.WorkspaceID != descriptor.WorkspaceID || descriptor.Process.Generation != descriptor.Generation {
		return fmt.Errorf("%w: discovery process disagrees with its workspace/generation", ErrOwnership)
	}
	return validateOwnedRecord(descriptor.Process, ownerOf(descriptor.Process))
}

func (store *DiscoveryStore) read() (devcontract.Discovery, error) {
	var discovery devcontract.Discovery
	if err := ReadPrivateJSON(filepath.Join(store.root, "discovery.json"), &discovery); err != nil {
		return discovery, err
	}
	if err := validateDescriptor(discovery.InstanceDescriptor); err != nil {
		return discovery, err
	}
	if discovery.TokenFile != store.tokenPath(discovery.WorkspaceID, discovery.Generation) {
		return discovery, fmt.Errorf("%w: discovery token reference is outside its generation", ErrOwnership)
	}
	if err := ValidatePrivateFile(discovery.TokenFile); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return discovery, fmt.Errorf("%w: published discovery token is missing", ErrOwnership)
		}
		return discovery, err
	}
	return discovery, nil
}

// Publish writes the private token before atomically advertising its reference.
// Refreshes within a generation preserve both process identity and token. A new
// generation may replace only a provably stale host, never an inaccessible one.
// A lease, PID or endpoint alone is not evidence of application readiness.
func (store *DiscoveryStore) Publish(ctx context.Context, descriptor devcontract.InstanceDescriptor, token []byte) (devcontract.Discovery, error) {
	if err := validateDescriptor(descriptor); err != nil {
		return devcontract.Discovery{}, err
	}
	if len(token) < 32 {
		return devcontract.Discovery{}, fmt.Errorf("%w: control token is too short", ErrOwnership)
	}
	if err := VerifyOwnedProcess(descriptor.Process, ownerOf(descriptor.Process)); err != nil {
		return devcontract.Discovery{}, err
	}
	lock, err := AcquirePrivateLock(ctx, store.root, "discovery.lock")
	if err != nil {
		return devcontract.Discovery{}, err
	}
	defer lock.Close()
	previous, err := store.read()
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return devcontract.Discovery{}, err
	}
	if err == nil {
		if previous.WorkspaceID != descriptor.WorkspaceID || previous.InstanceID != descriptor.InstanceID {
			return devcontract.Discovery{}, ErrOwnership
		}
		if previous.Generation == descriptor.Generation {
			if previous.Process != descriptor.Process {
				return devcontract.Discovery{}, ErrOwnership
			}
		} else {
			live, err := processRecordLive(previous.Process)
			if err != nil {
				return devcontract.Discovery{}, err
			}
			if live {
				return devcontract.Discovery{}, fmt.Errorf("%w: discovery belongs to a live generation", ErrOwnership)
			}
		}
	}
	discovery := devcontract.Discovery{InstanceDescriptor: descriptor, TokenFile: store.tokenPath(descriptor.WorkspaceID, descriptor.Generation)}
	if err := ValidatePrivateFile(discovery.TokenFile); err == nil {
		stored, err := os.ReadFile(discovery.TokenFile)
		if err != nil {
			return devcontract.Discovery{}, err
		}
		if subtle.ConstantTimeCompare(stored, token) != 1 {
			return devcontract.Discovery{}, fmt.Errorf("%w: generation token cannot be silently replaced", ErrOwnership)
		}
	} else if errors.Is(err, os.ErrNotExist) {
		if err := WritePrivateFile(discovery.TokenFile, token); err != nil {
			return devcontract.Discovery{}, err
		}
	} else {
		return devcontract.Discovery{}, err
	}
	// Do not remove the token on a publication error: rename may have succeeded
	// before a directory sync failed. A private orphan is safer than a dangling
	// token reference in a complete, already-published descriptor.
	if err := WritePrivateJSON(filepath.Join(store.root, "discovery.json"), discovery); err != nil {
		return devcontract.Discovery{}, err
	}
	return discovery, nil
}

// Read requires an explicit workspace and never falls back to production. An
// empty generation selects its current discovery; a nonempty generation must
// match exactly. Callers must verify process and endpoint identity before use.
func (store *DiscoveryStore) Read(ctx context.Context, workspaceID, generation string) (devcontract.Discovery, error) {
	if !validWorkspace(workspaceID) || generation != "" && !validLabel(generation) {
		return devcontract.Discovery{}, ErrOwnership
	}
	lock, err := AcquirePrivateLock(ctx, store.root, "discovery.lock")
	if err != nil {
		return devcontract.Discovery{}, err
	}
	defer lock.Close()
	discovery, err := store.read()
	if err != nil {
		return devcontract.Discovery{}, err
	}
	if discovery.WorkspaceID != workspaceID || generation != "" && discovery.Generation != generation {
		return devcontract.Discovery{}, ErrOwnership
	}
	return discovery, nil
}

// Remove is idempotent only for absent discovery or its exact generation. It
// cannot remove another host's descriptor or an arbitrary token-file reference.
// Superseded/crash-orphan token files are intentionally not swept by a new host.
func (store *DiscoveryStore) Remove(ctx context.Context, workspaceID, generation string) error {
	if !validWorkspace(workspaceID) || !validLabel(generation) {
		return ErrOwnership
	}
	lock, err := AcquirePrivateLock(ctx, store.root, "discovery.lock")
	if err != nil {
		return err
	}
	defer lock.Close()
	discovery, err := store.read()
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if discovery.WorkspaceID != workspaceID || discovery.Generation != generation {
		return ErrOwnership
	}
	if err := os.Remove(filepath.Join(store.root, "discovery.json")); err != nil {
		return err
	}
	if err := os.Remove(discovery.TokenFile); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return syncPrivateDirectory(store.root)
}
