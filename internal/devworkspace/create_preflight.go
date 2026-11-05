package devworkspace

import (
	"context"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

// PreflightCreateLaunch rejects missing launch inputs before Create publishes
// intent, branches, worktrees or a profile. Launch verifies materialized source.
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
	return nil
}
