package devworkspace

import (
	"context"
)

// PreflightCreateLaunch rejects missing launch inputs before Create publishes
// intent, branches, worktrees or a profile. It reads the selected committed
// module files, never a checkout. Launch verifies materialized source.
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
	sources := map[string]Source{}
	for _, s := range registry.Repositories {
		sources[s.ID] = s
	}
	report := preflightLaunch(ctx, manifest, options, committedModuleFiles(manifest, sources), m.options.SDKPolicy)
	if !report.Ready {
		return report.Issues[0]
	}
	return nil
}
