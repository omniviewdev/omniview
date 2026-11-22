package devworkspace

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
	"time"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devoutputs"
	"github.com/omniviewdev/omniview/internal/instance"
	sdkconfig "github.com/omniviewdev/plugin-sdk/pkg/config"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	"gopkg.in/yaml.v3"
)

const (
	pluginArchiveName = "plugin.tar.gz"
	// pluginArchiveMaxEntries bounds a published asset tree before packaging.
	pluginArchiveMaxEntries = 100_000
)

// ArchivePluginStatus is the nonsecret receipt of one published and installed
// static plugin archive. It records observations, not a provenance claim
// beyond the build evidence the producer actually recorded.
type ArchivePluginStatus struct {
	Archive       string   `json:"archive"`
	ArchiveSHA256 string   `json:"archiveSHA256"`
	BackendSHA256 string   `json:"backendSHA256,omitempty"`
	AssetFiles    int      `json:"assetFiles"`
	Capabilities  []string `json:"capabilities,omitempty"`
	OperationID   string   `json:"operationID,omitempty"`
}

type archiveEntry struct {
	name string
	path string
	mode int64
}

// PublishPluginArchive joins the actual frontend and backend outputs this graph
// produced for one selected plugin into a canonical archive under an owned
// generated tree. It only reads outputs whose ownership ledgers still match
// their recorded publication, and only packages a backend binary this graph
// recorded destination-owned build evidence for. It never installs.
func (g *BuildGraph) PublishPluginArchive(ctx context.Context, plugin devcontract.Plugin) (string, ArchivePluginStatus, error) {
	var receipt ArchivePluginStatus
	source, err := g.workspace.RepositoryPath(plugin.RepositoryID)
	if err != nil {
		return "", receipt, err
	}
	metadata, err := sdktypes.LoadPluginMetadata(source)
	if err != nil {
		return "", receipt, fmt.Errorf("archive plugin %s metadata: %w", plugin.ID, err)
	}
	if metadata.ID != plugin.ID {
		return "", receipt, fmt.Errorf("archive plugin %s: source metadata declares %q", plugin.ID, metadata.ID)
	}
	var backend, frontend *BuildNode
	for index := range g.Nodes {
		switch g.Nodes[index].ID {
		case "plugin-backend:" + plugin.ID:
			backend = &g.Nodes[index]
		case "plugin-ui:" + plugin.ID:
			frontend = &g.Nodes[index]
		}
	}
	wantsBackend := metadata.HasBackendCapabilities()
	if wantsBackend && backend == nil {
		return "", receipt, fmt.Errorf("archive plugin %s declares backend capabilities but has no selected Go backend", plugin.ID)
	}
	if backend == nil && frontend == nil {
		return "", receipt, fmt.Errorf("archive plugin %s has no selected frontend or backend output", plugin.ID)
	}

	var entries []archiveEntry
	verifyFrontend := func() error { return nil }
	ledgerDigest := ""
	binaryPath := ""
	if wantsBackend {
		if _, err = publishedGeneratedTree(g.workspace, filepath.Join("build", plugin.ID)); err != nil {
			return "", receipt, fmt.Errorf("archive plugin %s backend output is not an owned published build: %w", plugin.ID, err)
		}
		// The ledger digest of the published binary is the byte authority:
		// the host's own artifact record must accept the file, and the digest
		// stamped into the archive and copied into it must equal the ledger's.
		var ledgerErr error
		ledgerDigest, ledgerErr = publishedGeneratedFileDigest(g.workspace, filepath.Join("build", plugin.ID, "plugin"))
		if ledgerErr != nil {
			return "", receipt, fmt.Errorf("archive plugin %s backend binary: %w", plugin.ID, ledgerErr)
		}
		destination, pathErr := generatedPath(g.workspace, filepath.Join("build", plugin.ID))
		if pathErr != nil {
			return "", receipt, pathErr
		}
		binaryPath = filepath.Join(destination, "plugin")
		identity, ok := g.attestedIdentity(plugin.ID)
		if !ok {
			return "", receipt, fmt.Errorf("archive plugin %s has no build evidence recorded by this workspace build", plugin.ID)
		}
		if err = g.verifyUnchangedSDK(ctx, backend.Directory, identity); err != nil {
			return "", receipt, err
		}
		if err = instance.VerifyPluginArtifactAtHome(g.artifactHome(), g.workspace.ResolvedWorkspace, plugin.ID, binaryPath); err != nil {
			return "", receipt, fmt.Errorf("archive plugin %s backend does not match this workspace's build evidence: %w", plugin.ID, err)
		}
		if sourceIdentity, isSource := identity.Source(); isSource {
			provenance, provenanceErr := sdkconfig.BuildStateIsolationProvenance(binaryPath, sourceIdentity.Revision, sourceIdentity.SourceDigest)
			if provenanceErr != nil {
				return "", receipt, provenanceErr
			}
			if provenance.BinarySHA256 != ledgerDigest {
				return "", receipt, fmt.Errorf("archive plugin %s backend bytes changed after their recorded publication", plugin.ID)
			}
			metadata.StateIsolation = provenance
			receipt.BackendSHA256 = provenance.BinarySHA256
		} else {
			// A published SDK has no checkout revision to attest, and archive
			// metadata is never release trust: the archive carries no source-style
			// provenance. The destination's own private host evidence, verified
			// above against these exact bytes, authorizes the launch.
			metadata.StateIsolation = nil
			receipt.BackendSHA256 = ledgerDigest
		}
		entries = append(entries, archiveEntry{name: "bin/plugin", path: binaryPath, mode: 0o755})
	} else {
		metadata.StateIsolation = nil
	}
	if frontend != nil {
		if _, err = devoutputs.Published(ctx, g.workspace.ResolvedWorkspace, frontend.Directory, devoutputs.Distribution); err != nil {
			return "", receipt, fmt.Errorf("archive plugin %s frontend output is not an owned published build: %w", plugin.ID, err)
		}
		assets := filepath.Join(frontend.Directory, "dist", "assets")
		if err = requireProducerFile(filepath.Join(assets, "entry.js")); err != nil {
			return "", receipt, err
		}
		assetEntries, walkErr := archiveAssetEntries(assets)
		if walkErr != nil {
			return "", receipt, fmt.Errorf("archive plugin %s assets: %w", plugin.ID, walkErr)
		}
		// Re-verify the recorded publication after packaging (below) against
		// this digest: a swap during the copy fails the plugin.
		frontendDigest, digestErr := devoutputs.Published(ctx, g.workspace.ResolvedWorkspace, frontend.Directory, devoutputs.Distribution)
		if digestErr != nil {
			return "", receipt, digestErr
		}
		verifyFrontend = func() error {
			again, err := devoutputs.Published(ctx, g.workspace.ResolvedWorkspace, frontend.Directory, devoutputs.Distribution)
			if err != nil || again != frontendDigest {
				return errors.Join(err, fmt.Errorf("archive plugin %s frontend output changed while packaging", plugin.ID))
			}
			return nil
		}
		receipt.AssetFiles = len(assetEntries)
		entries = append(entries, assetEntries...)
	}
	receipt.Capabilities = append(receipt.Capabilities, metadata.Capabilities...)
	encodedMetadata, err := yaml.Marshal(metadata)
	if err != nil {
		return "", receipt, err
	}
	seen := map[string]bool{"plugin.yaml": true}
	for _, entry := range entries {
		if seen[entry.name] {
			return "", receipt, fmt.Errorf("archive plugin %s has duplicate archive path %s", plugin.ID, entry.name)
		}
		seen[entry.name] = true
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].name < entries[j].name })

	prepared, err := PrepareGeneratedTree(g.workspace, filepath.Join("archive", plugin.ID), g.options.Generation)
	if err != nil {
		return "", receipt, err
	}
	staged := filepath.Join(prepared.Directory, pluginArchiveName)
	digest, writeErr := writePluginArchive(staged, encodedMetadata, entries, ledgerDigest)
	if writeErr == nil {
		writeErr = verifyFrontend()
	}
	if writeErr != nil {
		_ = os.Remove(staged)
	}
	if err = errors.Join(writeErr, RecordGeneratedTree(prepared)); err != nil {
		return "", receipt, err
	}
	archiveRelative := filepath.Join("archive", plugin.ID, pluginArchiveName)
	published, err := publishedGeneratedFileDigest(g.workspace, archiveRelative)
	if err != nil {
		return "", receipt, err
	}
	if published != digest {
		return "", receipt, fmt.Errorf("archive plugin %s published archive differs from the written archive", plugin.ID)
	}
	receipt.Archive = filepath.Join(prepared.Destination, pluginArchiveName)
	receipt.ArchiveSHA256 = digest
	return receipt.Archive, receipt, nil
}

// archiveAssetEntries lists a published asset tree. Symlinks, devices and any
// other non-regular entry are refused, never followed or skipped.
func archiveAssetEntries(root string) ([]archiveEntry, error) {
	var entries []archiveEntry
	canonicalRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return nil, err
	}
	if canonicalRoot != root {
		return nil, fmt.Errorf("asset root %s is redirected through a symlink", root)
	}
	err = filepath.WalkDir(root, func(path string, item fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if item.IsDir() {
			return nil
		}
		if !item.Type().IsRegular() {
			return fmt.Errorf("asset %s is not a regular file", path)
		}
		relative, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		// A redirected parent directory would pass the leaf check below.
		if canonical, err := filepath.EvalSymlinks(path); err != nil || canonical != path {
			return fmt.Errorf("asset %s is redirected through a symlink", path)
		}
		if len(entries) >= pluginArchiveMaxEntries {
			return fmt.Errorf("asset tree exceeds %d files", pluginArchiveMaxEntries)
		}
		entries = append(entries, archiveEntry{name: "assets/" + filepath.ToSlash(relative), path: path, mode: 0o644})
		return nil
	})
	return entries, err
}

// writePluginArchive writes a deterministic gzip tar and returns its digest.
// A binary entry must still hash to expectedBinary while it is copied.
func writePluginArchive(destination string, metadata []byte, entries []archiveEntry, expectedBinary string) (string, error) {
	file, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return "", err
	}
	digest := sha256.New()
	gz := gzip.NewWriter(io.MultiWriter(file, digest))
	tw := tar.NewWriter(gz)
	build := func() error {
		header := func(name string, mode, size int64) *tar.Header {
			return &tar.Header{Typeflag: tar.TypeReg, Name: name, Mode: mode, Size: size, ModTime: time.Unix(0, 0), Format: tar.FormatPAX}
		}
		if err := tw.WriteHeader(header("plugin.yaml", 0o644, int64(len(metadata)))); err != nil {
			return err
		}
		if _, err := tw.Write(metadata); err != nil {
			return err
		}
		for _, entry := range entries {
			if err := copyArchiveEntry(tw, header, entry, expectedBinary); err != nil {
				return err
			}
		}
		return nil
	}
	buildErr := build()
	closeErr := errors.Join(tw.Close(), gz.Close(), file.Sync(), file.Close())
	if err = errors.Join(buildErr, closeErr); err != nil {
		return "", err
	}
	return hex.EncodeToString(digest.Sum(nil)), nil
}

func copyArchiveEntry(tw *tar.Writer, header func(string, int64, int64) *tar.Header, entry archiveEntry, expectedBinary string) error {
	// Classify before opening so a swapped FIFO or device cannot block the open.
	linked, err := os.Lstat(entry.path)
	if err != nil {
		return err
	}
	if !linked.Mode().IsRegular() {
		return fmt.Errorf("archive input %s is not a stable regular file", entry.name)
	}
	source, err := os.OpenFile(entry.path, os.O_RDONLY|syscall.O_NONBLOCK, 0)
	if err != nil {
		return err
	}
	defer source.Close()
	opened, err := source.Stat()
	if err != nil {
		return err
	}
	if !opened.Mode().IsRegular() || !os.SameFile(opened, linked) {
		return fmt.Errorf("archive input %s is not a stable regular file", entry.name)
	}
	if err = tw.WriteHeader(header(entry.name, entry.mode, opened.Size())); err != nil {
		return err
	}
	hash := sha256.New()
	written, err := io.Copy(io.MultiWriter(tw, hash), source)
	if err != nil {
		return err
	}
	if written != opened.Size() {
		return fmt.Errorf("archive input %s changed while packaging", entry.name)
	}
	if entry.name == "bin/plugin" && hex.EncodeToString(hash.Sum(nil)) != expectedBinary {
		return fmt.Errorf("archive backend bytes differ from the build evidence digest")
	}
	return nil
}

// archivePluginReady reports whether a non-dev installed plugin is usable,
// without inventing readiness the plugin has not reported. Backend plugins
// must be Running and have negotiated every declared backend capability.
func archivePluginReady(info sdktypes.PluginInfo) (bool, error) {
	if info.DevMode {
		return false, devcontract.Fail(4, "archive_runtime_conflict", fmt.Sprintf("plugin %s is linked as a managed development source, not an installed archive", info.ID))
	}
	if info.LastError != "" || info.Phase == "Failed" {
		return false, devcontract.Fail(5, "plugin_not_ready", fmt.Sprintf("archive plugin %s reported phase %q with an error", info.ID, info.Phase))
	}
	if !info.Enabled {
		return false, nil
	}
	if !info.Metadata.HasBackendCapabilities() {
		return info.Phase == "Running" || info.Phase == "Installed", nil
	}
	if info.Phase != "Running" {
		return false, nil
	}
	negotiated := map[string]bool{}
	for _, capability := range info.Capabilities {
		negotiated[strings.ToLower(string(capability))] = true
	}
	for _, capability := range info.Metadata.Capabilities {
		if archiveBackendCapability(capability) && !negotiated[strings.ToLower(capability)] {
			return false, nil
		}
	}
	return true, nil
}

func archiveBackendCapability(capability string) bool {
	return sdktypes.Capability(capability).IsBackend()
}
