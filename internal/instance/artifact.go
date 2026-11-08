package instance

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsdk"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	"github.com/omniviewdev/plugin-sdk/pkg/state"
)

const (
	// sourceArtifactSchemaVersion records selected source SDK identities as
	// flat fields; older hosts read it.
	sourceArtifactSchemaVersion = 3
	// typedArtifactSchemaVersion carries a typed SDK identity that is either
	// the published or the source variant. Older hosts cannot read it.
	typedArtifactSchemaVersion = 4
)

// sourceArtifactRecord is the exact schema 3 encoding of a source identity.
// Its field set must not change: existing profiles and older hosts read it.
type sourceArtifactRecord struct {
	SchemaVersion           int                              `json:"schemaVersion"`
	PluginID                string                           `json:"pluginID"`
	SDKRevision             string                           `json:"sdkRevision"`
	ExpectedSDKSourceSHA256 string                           `json:"expectedSDKSourceSHA256"`
	Provenance              *config.StateIsolationProvenance `json:"provenance"`
}

// typedArtifactRecord is the schema 4 encoding written for published identities.
type typedArtifactRecord struct {
	SchemaVersion int         `json:"schemaVersion"`
	PluginID      string      `json:"pluginID"`
	SDK           artifactSDK `json:"sdk"`
	Capability    string      `json:"capability"`
	BinarySHA256  string      `json:"binarySHA256"`
}

// artifactSDK is the typed SDK identity of a schema 4 record. Only the fields
// of its mode may be set.
type artifactSDK struct {
	Mode         devsdk.Mode                      `json:"mode"`
	Module       string                           `json:"module,omitempty"`
	Version      string                           `json:"version,omitempty"`
	ModuleSum    string                           `json:"moduleSum,omitempty"`
	GoModSum     string                           `json:"goModSum,omitempty"`
	Revision     string                           `json:"revision,omitempty"`
	SourceSHA256 string                           `json:"sourceSHA256,omitempty"`
	Provenance   *config.StateIsolationProvenance `json:"provenance,omitempty"`
}

// artifactRecord is the decoded union of every readable schema. It is
// host-owned transient build evidence, never imported from plugin.yaml or a
// baseline. A source revision and digest identify the stable selected source
// snapshot verified by the builder.
type artifactRecord struct {
	SchemaVersion           int                              `json:"schemaVersion"`
	PluginID                string                           `json:"pluginID"`
	SDKRevision             string                           `json:"sdkRevision"`
	ExpectedSDKSourceSHA256 string                           `json:"expectedSDKSourceSHA256"`
	Provenance              *config.StateIsolationProvenance `json:"provenance"`
	SDK                     *artifactSDK                     `json:"sdk"`
	Capability              string                           `json:"capability"`
	BinarySHA256            string                           `json:"binarySHA256"`

	published devsdk.Identity
	// source evidence a source verification checks the bytes against.
	revision, sourceDigest string
	provenance             *config.StateIsolationProvenance
}

func invalidArtifactEvidence(pluginID string) error {
	return fmt.Errorf("instance: invalid trusted artifact source evidence for %s", pluginID)
}

// resolve validates the record's schema and union shape and reports the
// evidence it carries. A published record is also admitted by the release
// policy of this host binary, evaluated now, so raising the floor revokes
// recorded tuples.
func (record *artifactRecord) resolve(pluginID string) error {
	if record.PluginID != pluginID {
		return invalidArtifactEvidence(pluginID)
	}
	switch record.SchemaVersion {
	case sourceArtifactSchemaVersion:
		if record.SDK != nil || record.Capability != "" || record.BinarySHA256 != "" ||
			record.Provenance == nil || record.SDKRevision == "" || record.ExpectedSDKSourceSHA256 == "" {
			return invalidArtifactEvidence(pluginID)
		}
		record.revision, record.sourceDigest, record.provenance = record.SDKRevision, record.ExpectedSDKSourceSHA256, record.Provenance
		return nil
	case typedArtifactSchemaVersion:
		if record.SDK == nil || record.SDKRevision != "" || record.ExpectedSDKSourceSHA256 != "" || record.Provenance != nil {
			return invalidArtifactEvidence(pluginID)
		}
		switch record.SDK.Mode {
		case devsdk.ModeSource:
			sdk := record.SDK
			if sdk.Provenance == nil || sdk.Revision == "" || sdk.SourceSHA256 == "" ||
				sdk.Module != "" || sdk.Version != "" || sdk.ModuleSum != "" || sdk.GoModSum != "" ||
				record.Capability != "" || record.BinarySHA256 != "" {
				return invalidArtifactEvidence(pluginID)
			}
			record.revision, record.sourceDigest, record.provenance = sdk.Revision, sdk.SourceSHA256, sdk.Provenance
			return nil
		case devsdk.ModePublished:
			sdk := record.SDK
			if sdk.Revision != "" || sdk.SourceSHA256 != "" || sdk.Provenance != nil || record.BinarySHA256 == "" {
				return invalidArtifactEvidence(pluginID)
			}
			if record.Capability != devsdk.Capability {
				return fmt.Errorf("instance: plugin %s artifact evidence declares capability %q, not %q", pluginID, record.Capability, devsdk.Capability)
			}
			identity, err := devsdk.NewPublishedIdentity(devsdk.Published{
				Module: sdk.Module, Version: sdk.Version, ModuleSum: sdk.ModuleSum, GoModSum: sdk.GoModSum,
			})
			if err != nil {
				return fmt.Errorf("instance: invalid trusted artifact SDK identity for %s: %w", pluginID, err)
			}
			if err := devsdk.ReleasePolicy().Admit(identity); err != nil {
				return fmt.Errorf("instance: plugin %s artifact SDK identity is no longer accepted: %w", pluginID, err)
			}
			record.published = identity
			return nil
		}
	}
	return invalidArtifactEvidence(pluginID)
}

// artifactSHA256 is the lowercase hex SHA-256 of a regular file, computed like
// the SDK's artifact digest.
func artifactSHA256(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() {
		return "", fmt.Errorf("artifact must be a regular file")
	}
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
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

// RecordBuiltArtifact MUST only be called after the trusted builder verifies
// the selected SDK and confirms the exact identity is unchanged across a
// successful build. A source identity is written as the schema 3 record; a
// published identity is written as a schema 4 record with its typed identity,
// capability and the SHA-256 of the exact bytes. Dirty source edits are
// supported: the digest identifies that working-tree snapshot, not a claim
// that hashing alone proves source inclusion in the executable.
func RecordBuiltArtifact(
	workspace devcontract.ResolvedWorkspace, pluginID, binaryPath string, sdk devsdk.Identity,
) error {
	if err := state.ValidateComponent(pluginID); err != nil {
		return err
	}
	if err := sdk.Validate(); err != nil {
		return fmt.Errorf("instance: verified SDK identity is required: %w", err)
	}
	var record any
	if source, ok := sdk.Source(); ok {
		provenance, err := config.BuildStateIsolationProvenance(binaryPath, source.Revision, source.SourceDigest)
		if err != nil {
			return err
		}
		record = sourceArtifactRecord{
			SchemaVersion: sourceArtifactSchemaVersion, PluginID: pluginID, SDKRevision: source.Revision,
			ExpectedSDKSourceSHA256: source.SourceDigest, Provenance: provenance,
		}
	} else {
		published, _ := sdk.Published()
		digest, err := artifactSHA256(binaryPath)
		if err != nil {
			return err
		}
		record = typedArtifactRecord{
			SchemaVersion: typedArtifactSchemaVersion, PluginID: pluginID, Capability: devsdk.Capability, BinarySHA256: digest,
			SDK: artifactSDK{
				Mode: devsdk.ModePublished, Module: published.Module, Version: published.Version,
				ModuleSum: published.ModuleSum, GoModSum: published.GoModSum,
			},
		}
	}
	encoded, err := json.Marshal(record)
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
	if err := record.resolve(pluginID); err != nil {
		return "", record, err
	}
	return dir, record, nil
}

func (record *artifactRecord) verifyArtifact(pluginID, binaryPath string) error {
	if record.published.Mode() == devsdk.ModePublished {
		digest, err := artifactSHA256(binaryPath)
		if err != nil {
			return fmt.Errorf("instance: plugin %s artifact verification failed: %w", pluginID, err)
		}
		if digest != record.BinarySHA256 {
			return fmt.Errorf("instance: plugin %s artifact bytes differ from the recorded build", pluginID)
		}
		if err := devsdk.VerifyBinary(pluginID, binaryPath, record.published); err != nil {
			return fmt.Errorf("instance: plugin %s artifact SDK verification failed: %w", pluginID, err)
		}
		return nil
	}
	if err := record.provenance.VerifyArtifact(binaryPath, record.revision, record.sourceDigest); err != nil {
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
