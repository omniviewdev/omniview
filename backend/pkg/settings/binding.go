package settings

import pkgsettings "github.com/omniviewdev/plugin-sdk/settings"

// Binding exposes only authorized settings operations to the desktop transport.
type Binding struct{ Service *Service }

func (b *Binding) GetSnapshot(scope Scope) (Snapshot, error) { return b.Service.GetSnapshot(scope) }
func (b *Binding) Validate(scope Scope, id string, value any) (pkgsettings.ValidationResult, error) {
	return b.Service.Validate(scope, id, value)
}
func (b *Binding) Commit(scope Scope, values map[string]any) (CommitResult, error) {
	return b.Service.Commit(scope, values)
}
