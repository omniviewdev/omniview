//go:build !darwin

package devworkspace

import (
	"context"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

// Other platforms retain the existing stopped/profile flock contract. Darwin's
// native helper is the only consumer requiring inherited BSD-flock capabilities.
func (m *Manager) lockRemoval(ctx context.Context, w devcontract.ResolvedWorkspace) (func(), []GuardFile, error) {
	unlock, err := m.lockStopped(ctx, w)
	return unlock, nil, err
}
