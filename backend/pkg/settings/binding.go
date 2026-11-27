package settings

import (
	"context"

	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
)

// Binding exposes only authorized settings operations to the desktop transport.
type Binding struct{ Service *Service }

func (b *Binding) GetSnapshot(scope Scope) (Snapshot, error) { return b.Service.GetSnapshot(scope) }

// GetAppearance reads only this caller's presentation and the public appearance preferences.
// Browser pages have no native window; never let a caller supply another window's name.
func (b *Binding) GetAppearance(ctx context.Context) (AppearanceSnapshot, error) {
	return b.Service.getAppearance(ctx)
}

func (b *Binding) Validate(scope Scope, id string, value any) (pkgsettings.ValidationResult, error) {
	return b.Service.Validate(scope, id, value)
}
func (b *Binding) Commit(scope Scope, values map[string]any) (CommitResult, error) {
	return b.Service.Commit(scope, values)
}
