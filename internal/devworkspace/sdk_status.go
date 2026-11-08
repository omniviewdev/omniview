package devworkspace

import (
	"context"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsdk"
)

// Verification labels of one SDK consumer. A declared requirement is never
// reported as an effective resolution: only a verifier's observation is.
const (
	// SDKUnresolved: only the consumer's declared requirement was read. Nothing
	// was resolved, downloaded or integrity-checked.
	SDKUnresolved = "unresolved"
	// SDKVerified: the running (or just launched) supervisor resolved and
	// verified the consumer's effective SDK.
	SDKVerified = "verified"
	// SDKHistorical: a previous launch verified it. The workspace may have
	// changed since; this is evidence of that launch, not a fresh observation.
	SDKHistorical = "historical"
)

// SDKStatus reports which plugin SDK a workspace builds against. The mode is
// derived from the manifest's single selection authority: a linked SDK
// repository means source mode, no link means each Go consumer's published
// module. It is observation, never authorization.
type SDKStatus struct {
	Mode devsdk.Mode `json:"mode"`
	// RepositoryID is the selected SDK repository in source mode.
	RepositoryID string `json:"repositoryID,omitempty"`
	// Consumers lists the published mode's Go consumers: the host and every
	// selected plugin repository with a Go module.
	Consumers []SDKConsumer `json:"consumers,omitempty"`
}

// SDKConsumer is one Go consumer's published SDK, as far as it is known.
type SDKConsumer struct {
	RepositoryID string `json:"repositoryID"`
	// RequiredVersion is the version the consumer's go.mod requires.
	RequiredVersion string `json:"requiredVersion,omitempty"`
	// ResolvedVersion is the effective MVS-selected version, present only when a
	// verification observed it. ModuleSum and GoModSum are its checksums.
	ResolvedVersion string `json:"resolvedVersion,omitempty"`
	ModuleSum       string `json:"moduleSum,omitempty"`
	GoModSum        string `json:"goModSum,omitempty"`
	Verification    string `json:"verification"`
}

// moduleFileSource reads one repository's Go module files: the checked-out
// worktree of a materialized workspace, or committed blobs before a worktree
// exists. found is false for a repository that has no go.mod.
type moduleFileSource func(ctx context.Context, repositoryID string) (files devsdk.ModuleFiles, found bool, err error)

// worktreeModuleFiles reads module files from the workspace's checkouts.
func worktreeModuleFiles(w Workspace) moduleFileSource {
	return func(_ context.Context, id string) (devsdk.ModuleFiles, bool, error) {
		var files devsdk.ModuleFiles
		for _, repository := range w.Manifest.Repositories {
			if repository.ID != id {
				continue
			}
			if !filepath.IsLocal(repository.Directory) {
				return files, false, nil
			}
			root := filepath.Join(w.Root, repository.Directory)
			data, err := os.ReadFile(filepath.Join(root, "go.mod"))
			if errors.Is(err, fs.ErrNotExist) {
				return files, false, nil
			}
			if err != nil {
				return files, false, err
			}
			files.GoMod = data
			if files.GoSum, err = os.ReadFile(filepath.Join(root, "go.sum")); err != nil && !errors.Is(err, fs.ErrNotExist) {
				return files, false, err
			}
			if _, err = os.Lstat(filepath.Join(root, "vendor")); err == nil {
				files.Vendored = true
			} else if !errors.Is(err, fs.ErrNotExist) {
				return files, false, err
			}
			return files, true, nil
		}
		return files, false, nil
	}
}

// committedModuleFiles reads module files from the commits a manifest selects,
// before any worktree exists. Only committed blobs are read: no network, no
// checkout.
func committedModuleFiles(manifest devcontract.WorkspaceManifest, sources map[string]Source) moduleFileSource {
	return func(ctx context.Context, id string) (devsdk.ModuleFiles, bool, error) {
		var files devsdk.ModuleFiles
		for _, repository := range manifest.Repositories {
			source, ok := sources[repository.ID]
			if repository.ID != id || !ok {
				continue
			}
			listing, err := git(ctx, source.CommonDir, "", "ls-tree", "--name-only", repository.BaseCommit, "--", "go.mod", "go.sum", "vendor")
			if err != nil {
				return files, false, err
			}
			present := map[string]bool{}
			for _, name := range strings.Fields(listing) {
				present[name] = true
			}
			if !present["go.mod"] {
				return files, false, nil
			}
			mod, err := git(ctx, source.CommonDir, "", "show", repository.BaseCommit+":go.mod")
			if err != nil {
				return files, false, err
			}
			files.GoMod = []byte(mod)
			if present["go.sum"] {
				sum, sumErr := git(ctx, source.CommonDir, "", "show", repository.BaseCommit+":go.sum")
				if sumErr != nil {
					return files, false, sumErr
				}
				files.GoSum = []byte(sum)
			}
			files.Vendored = present["vendor"]
			return files, true, nil
		}
		return files, false, nil
	}
}

// sdkConsumers lists the repositories that build Go against the SDK: the host,
// then each selected plugin repository once, in manifest order. Whether a plugin
// repository has a Go module is decided where its files are read.
func sdkConsumers(manifest devcontract.WorkspaceManifest) []string {
	ids := []string{"omniview"}
	seen := map[string]bool{"omniview": true}
	for _, plugin := range manifest.Plugins {
		if !seen[plugin.RepositoryID] {
			seen[plugin.RepositoryID] = true
			ids = append(ids, plugin.RepositoryID)
		}
	}
	return ids
}

// workspaceConsumerName labels a Go consumer directory in typed diagnostics: the
// ID of the selected repository that owns it, or its directory name.
func workspaceConsumerName(w Workspace, directory string) string {
	for _, repository := range w.Manifest.Repositories {
		root := filepath.Join(w.Root, repository.Directory)
		if directory == root || inside(root, directory) {
			return repository.ID
		}
	}
	return filepath.Base(directory)
}

// sdkSelectionStatus reports only what the manifest decides.
func sdkSelectionStatus(manifest devcontract.WorkspaceManifest) SDKStatus {
	if link := manifest.Links.SDKRepositoryID; link != nil {
		return SDKStatus{Mode: devsdk.ModeSource, RepositoryID: *link}
	}
	return SDKStatus{Mode: devsdk.ModePublished}
}

// inspectSDK reads the SDK each published consumer declares, without running Go
// or touching the network, and returns the independent refusals the declaration
// already proves: an SDK replace or vendored tree, no SDK requirement, missing
// checksums, and a declared version the policy does not admit. Every consumer
// stays "unresolved": the effective MVS version, the module bytes and the
// capability are verified only at launch. In source mode nothing is inspected:
// the selected checkout is the authority.
func inspectSDK(ctx context.Context, manifest devcontract.WorkspaceManifest, read moduleFileSource, policy devsdk.Policy) (SDKStatus, []*devcontract.Error) {
	status := sdkSelectionStatus(manifest)
	if status.Mode != devsdk.ModePublished {
		return status, nil
	}
	var issues []*devcontract.Error
	for _, id := range sdkConsumers(manifest) {
		files, found, err := read(ctx, id)
		if err != nil {
			issues = append(issues, workspaceError(err))
			continue
		}
		if !found {
			if id == "omniview" {
				issues = append(issues, devcontract.Fail(3, "sdk_contract_mismatch", "the omniview host source has no go.mod; select compatible host and plugin branches"))
			}
			continue
		}
		consumer := SDKConsumer{RepositoryID: id, Verification: SDKUnresolved}
		declared, err := devsdk.Declare(id, files)
		consumer.RequiredVersion = declared.Version
		if err == nil {
			err = devsdk.AdmitDeclared(policy, id, declared)
		}
		if err != nil {
			issues = append(issues, workspaceError(err))
		}
		status.Consumers = append(status.Consumers, consumer)
	}
	return status, issues
}

// refusePublishedNative refuses a native launch of a published SDK workspace:
// the native host build still requires explicit SDK source.
func refusePublishedNative(selection devsdk.Selection, options LaunchOptions) error {
	if selection.Mode() == devsdk.ModePublished && options.Mode == "native" {
		return publishedNativeUnsupported()
	}
	return nil
}

func publishedNativeUnsupported() *devcontract.Error {
	return devcontract.Fail(2, "sdk_published_native_unsupported",
		"native mode is not supported with the published plugin SDK yet; launch with --mode browser, or create the workspace with --repo plugin-sdk to build natively against explicit SDK source")
}

// observeSDK records the SDK a build verified so launch status can report the
// resolved version. It reports; it never authorizes.
func (s *workspaceSupervisor) observeSDK(consumer string, identity devsdk.Identity) {
	published, ok := identity.Published()
	if !ok {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.status.SDK == nil {
		status := sdkSelectionStatus(s.workspace.Manifest)
		s.status.SDK = &status
	}
	for index := range s.status.SDK.Consumers {
		entry := &s.status.SDK.Consumers[index]
		if entry.RepositoryID == consumer {
			entry.ResolvedVersion, entry.ModuleSum, entry.GoModSum = published.Version, published.ModuleSum, published.GoModSum
			entry.Verification = SDKVerified
			return
		}
	}
	s.status.SDK.Consumers = append(s.status.SDK.Consumers, SDKConsumer{
		RepositoryID: consumer, RequiredVersion: published.Version, ResolvedVersion: published.Version,
		ModuleSum: published.ModuleSum, GoModSum: published.GoModSum, Verification: SDKVerified,
	})
}

// workspaceSDKStatus derives a workspace's SDK status from its files alone, for
// status reports with no live supervisor evidence: the mode and the declared
// requirements, all unresolved. It reads no network and starts nothing.
func workspaceSDKStatus(ctx context.Context, w Workspace) *SDKStatus {
	status, _ := inspectSDK(ctx, w.Manifest, worktreeModuleFiles(w), devsdk.Policy{})
	return &status
}

// historicalSDKStatus relabels the verified entries of a previous launch's
// saved status: they are evidence of that launch, not a fresh observation.
func historicalSDKStatus(saved *SDKStatus) *SDKStatus {
	if saved == nil {
		return nil
	}
	status := *saved
	status.Consumers = append([]SDKConsumer(nil), saved.Consumers...)
	for index := range status.Consumers {
		if status.Consumers[index].Verification == SDKVerified {
			status.Consumers[index].Verification = SDKHistorical
		}
	}
	return &status
}
