package instance

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	"github.com/omniviewdev/plugin-sdk/pkg/state"
)

// artifactRecord is host-owned transient build evidence, never imported from
// plugin.yaml or a baseline. Expected revision and source digest come from the
// trusted builder's independently verified stable selected source snapshot.
type artifactRecord struct {
	SchemaVersion           int                              `json:"schemaVersion"`
	PluginID                string                           `json:"pluginID"`
	ExpectedSDKRevision     string                           `json:"expectedSDKRevision"`
	ExpectedSDKSourceSHA256 string                           `json:"expectedSDKSourceSHA256"`
	Provenance              *config.StateIsolationProvenance `json:"provenance"`
}

func artifactDirectory(workspace devcontract.ResolvedWorkspace) (string, error) {
	if !filepath.IsAbs(workspace.ManifestPath) || !filepath.IsAbs(workspace.StateRoot) {
		return "", fmt.Errorf("instance: artifact workspace requires explicit absolute manifest and state paths")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	// Revalidate the explicit manifest and selected state, including a custom
	// binding/owner marker. Never infer identity from a custom root's parent or
	// from whichever workspace happens to be in the builder's environment.
	resolved, err := devcontract.ResolveWorkspace(devcontract.ResolveOptions{Explicit: workspace.ManifestPath, StateRoot: workspace.StateRoot, Home: home})
	if err != nil {
		return "", err
	}
	if resolved.ManifestPath != workspace.ManifestPath || resolved.Root != workspace.Root || resolved.StateRoot != workspace.StateRoot || resolved.Manifest.WorkspaceID != workspace.Manifest.WorkspaceID {
		return "", fmt.Errorf("instance: artifact workspace identity changed during revalidation")
	}
	profiles, err := devcontract.CanonicalPath(filepath.Join(home, ".omniview-dev", "profiles"))
	if err != nil {
		return "", err
	}
	path := filepath.Join(profiles, resolved.Manifest.WorkspaceID, "runtime", "artifacts")
	canonical, err := devcontract.CanonicalPath(path)
	if err != nil {
		return "", err
	}
	if canonical != path {
		return "", fmt.Errorf("instance: artifact directory must not be a symlink alias")
	}
	return path, nil
}

// RecordBuiltArtifactSource MUST only be called after the trusted builder
// verifies the selected SDK path and reviewed isolation-capable ancestor, then
// confirms the exact source digest is unchanged across a successful build.
// Dirty edits are supported: the digest identifies that working-tree snapshot,
// not a claim that hashing alone proves source inclusion in the executable.
func RecordBuiltArtifactSource(workspace devcontract.ResolvedWorkspace, pluginID, binaryPath, expectedSDKRevision, sourceDigest string) error {
	if err := state.ValidateComponent(pluginID); err != nil {
		return err
	}
	if sourceDigest == "" {
		return fmt.Errorf("instance: verified SDK source snapshot digest is required")
	}
	provenance, err := config.BuildStateIsolationProvenance(binaryPath, expectedSDKRevision, sourceDigest)
	if err != nil {
		return err
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	release, err := devcontract.LockProfile(context.Background(), home, workspace.Manifest.WorkspaceID)
	if err != nil {
		return err
	}
	defer release()
	dir, err := artifactDirectory(workspace)
	if err != nil {
		return err
	}
	if err := devcontract.EnsureDefaultProfileOwnership(home, workspace.Manifest.WorkspaceID); err != nil {
		return err
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	record := artifactRecord{SchemaVersion: 2, PluginID: pluginID, ExpectedSDKRevision: expectedSDKRevision, ExpectedSDKSourceSHA256: sourceDigest, Provenance: provenance}
	encoded, err := json.Marshal(record)
	if err != nil {
		return err
	}
	file, err := os.CreateTemp(dir, ".artifact-*")
	if err != nil {
		return err
	}
	name := file.Name()
	defer os.Remove(name)
	if err := file.Chmod(0600); err != nil {
		file.Close()
		return err
	}
	if _, err := file.Write(encoded); err != nil {
		file.Close()
		return err
	}
	if err := file.Sync(); err != nil {
		file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	return os.Rename(name, filepath.Join(dir, pluginID+".json"))
}

// readPluginArtifactRecord revalidates workspace/root ownership before reading
// host-owned evidence. Both static preflight and private launch verification
// must use this path rather than installed plugin metadata.
func readPluginArtifactRecord(workspace devcontract.ResolvedWorkspace, pluginID string) (string, artifactRecord, error) {
	var record artifactRecord
	if err := state.ValidateComponent(pluginID); err != nil {
		return "", record, err
	}
	dir, err := artifactDirectory(workspace)
	if err != nil {
		return "", record, err
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", record, err
	}
	if err := devcontract.ValidateDefaultProfileOwnership(home, workspace.Manifest.WorkspaceID); err != nil {
		return "", record, err
	}
	recordPath := filepath.Join(dir, pluginID+".json")
	info, err := os.Lstat(recordPath)
	if err != nil || !info.Mode().IsRegular() {
		return "", record, fmt.Errorf("instance: plugin %s has no trusted fixed-SDK artifact evidence; rebuild from the selected verified SDK before launch", pluginID)
	}
	file, err := os.Open(recordPath)
	if err != nil {
		return "", record, err
	}
	decodeErr := json.NewDecoder(io.LimitReader(file, 64*1024)).Decode(&record)
	closeErr := file.Close()
	if decodeErr != nil {
		return "", record, decodeErr
	}
	if closeErr != nil {
		return "", record, closeErr
	}
	if record.SchemaVersion != 2 || record.PluginID != pluginID || record.Provenance == nil || record.ExpectedSDKRevision == "" || record.ExpectedSDKSourceSHA256 == "" {
		return "", record, fmt.Errorf("instance: invalid trusted artifact source evidence for %s", pluginID)
	}
	return dir, record, nil
}

func (record *artifactRecord) verifyArtifact(pluginID, binaryPath string) error {
	if err := record.Provenance.VerifyArtifact(binaryPath, record.ExpectedSDKRevision, record.ExpectedSDKSourceSHA256); err != nil {
		return fmt.Errorf("instance: plugin %s artifact isolation verification failed: %w", pluginID, err)
	}
	return nil
}

// VerifyPluginArtifact statically checks candidate bytes against the same
// workspace ownership and independent trusted build evidence used at launch,
// without copying the executable or writing to the artifact directory.
// The caller must hold the selected root's ownership flock. This is preflight
// only: bytes may subsequently change, so execution must still use the private
// verified snapshot returned by PreparePluginArtifact.
func VerifyPluginArtifact(workspace devcontract.ResolvedWorkspace, pluginID, binaryPath string) error {
	_, record, err := readPluginArtifactRecord(workspace, pluginID)
	if err != nil {
		return err
	}
	return record.verifyArtifact(pluginID, binaryPath)
}

// PreparePluginArtifact fails closed before executing an unknown executable.
// It verifies a private executable snapshot against independent trusted build
// evidence, so replacement of the installed binary cannot race process launch.
// The caller must hold the selected root's ownership flock through launch;
// this read path validates the durable default owner but never claims one.
// cleanup must run only after the process has exited (or before any launch);
// Windows may retain an executing file until process termination.
func PreparePluginArtifact(workspace devcontract.ResolvedWorkspace, pluginID, binaryPath string) (string, func(), error) {
	noop := func() {}
	dir, record, err := readPluginArtifactRecord(workspace, pluginID)
	if err != nil {
		return "", noop, err
	}
	// A private per-launch directory prevents plugin-source/installation changes
	// from replacing the verified executable pathname between digest and exec.
	launchDir, err := os.MkdirTemp(dir, ".launch-"+pluginID+"-")
	if err != nil {
		return "", noop, err
	}
	cleanup := func() { _ = os.RemoveAll(launchDir) }
	source, err := os.Open(binaryPath)
	if err != nil {
		cleanup()
		return "", noop, err
	}
	sourceInfo, err := source.Stat()
	if err != nil || !sourceInfo.Mode().IsRegular() {
		source.Close()
		cleanup()
		return "", noop, fmt.Errorf("instance: plugin artifact is not a regular file")
	}
	prepared := filepath.Join(launchDir, "plugin")
	output, err := os.OpenFile(prepared, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0500)
	if err != nil {
		source.Close()
		cleanup()
		return "", noop, err
	}
	_, copyErr := io.Copy(output, source)
	sourceErr := source.Close()
	outputErr := output.Close()
	for _, err := range []error{copyErr, sourceErr, outputErr} {
		if err != nil {
			cleanup()
			return "", noop, err
		}
	}
	if err := record.verifyArtifact(pluginID, prepared); err != nil {
		cleanup()
		return "", noop, err
	}
	return prepared, cleanup, nil
}
