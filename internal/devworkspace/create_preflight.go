package devworkspace

import (
	"context"
	"fmt"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

// PreflightCreateLaunch rejects missing launch inputs and divergent SDK ancestry
// before Create publishes intent, branches, worktrees or a profile. Launch still
// verifies the actual materialized source, including isolation-boundary bytes.
func (m *Manager) PreflightCreateLaunch(ctx context.Context, create CreateOptions, options LaunchOptions) error {
	if err := options.Validate(); err != nil {
		return err
	}
	registry, err := LoadRegistry(ctx, m.Root)
	if err != nil {
		return err
	}
	manifest, err := m.plan(ctx, registry, create)
	if err != nil {
		return err
	}
	if manifest.Links.SDKRepositoryID == nil {
		return devcontract.Fail(2, "sdk_source_required", "create --start requires --repo plugin-sdk even without SDK development; omit --start for source-only creation")
	}
	report := PreflightLaunch(Workspace{ResolvedWorkspace: devcontract.ResolvedWorkspace{Manifest: manifest}}, options)
	if !report.Ready {
		return report.Issues[0]
	}
	for _, repository := range manifest.Repositories {
		if repository.ID != *manifest.Links.SDKRepositoryID {
			continue
		}
		for _, source := range registry.Repositories {
			if source.ID != repository.ID {
				continue
			}
			if _, err := git(ctx, source.CommonDir, "", "merge-base", "--is-ancestor", options.ReviewedSDKRevision, repository.BaseCommit); err != nil {
				return devcontract.Fail(4, "sdk_source_untrusted", fmt.Sprintf("selected SDK ref %q commit %s must descend from independently reviewed commit %s; select an approved descendant with --ref plugin-sdk=COMMIT before create --start; no workspace was created: %v", repository.BaseRef, repository.BaseCommit, options.ReviewedSDKRevision, err))
			}
			return nil
		}
	}
	return devcontract.Fail(3, "sdk_source_required", "launch requires --repo plugin-sdk; source-only creation remains available without --start")
}
