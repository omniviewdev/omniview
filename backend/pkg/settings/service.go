// Package settings owns durable host and plugin settings transactions.
package settings

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"sort"
	"strings"
	"sync"

	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	settingsstore "github.com/omniviewdev/omniview/internal/settings/store"
	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
)

const hostScopeKind = "host"
const pluginScopeKind = "plugin"

type Scope struct {
	Kind     string `json:"kind"`
	PluginID string `json:"pluginId,omitempty"`
}
type Snapshot struct {
	Scope      Scope             `json:"scope"`
	Categories pkgsettings.Store `json:"categories"`
}
type CommitResult struct {
	Snapshot  Snapshot `json:"snapshot"`
	Applied   bool     `json:"applied"`
	Uncertain bool     `json:"uncertain"`
	Message   string   `json:"message"`
}

// CommitError distinguishes invalid proposals from storage or transport failures.
// Error text is safe for public transports; trusted callers may unwrap the cause.
type CommitError struct {
	Validation bool
	cause      error
}

func (e *CommitError) Error() string {
	return "Settings could not be saved. Check the values and try again."
}
func (e *CommitError) Unwrap() error { return e.cause }

type Migration func(map[string]any) (map[string]any, bool)
type Options struct {
	Store      *settingsstore.Store
	Categories []pkgsettings.Category
	Migrations map[string]Migration
	Logger     *zap.SugaredLogger
}
type Diagnostic struct {
	CategoryID string
	SettingID  string
	Message    string
}
type Plugins interface {
	Snapshot(string) (pkgsettings.Category, error)
	ValidateSetting(string, string, any) (pkgsettings.ValidationResult, error)
	CommitSettings(context.Context, string, map[string]any, pkgsettings.PersistFunc) (pkgsettings.CommitResult, error)
}

type Service struct {
	provider    pkgsettings.Provider
	store       *settingsstore.Store
	metadata    map[string]pkgsettings.Category
	baseline    map[string]any
	diagnostics []Diagnostic
	rejected    []string
	mu          sync.RWMutex
	// hostCommitMu preserves durable publication and live-effect order together.
	// Apply and change handlers may read settings, but must not commit recursively.
	hostCommitMu sync.Mutex
	plugins      Plugins
	apply        func(string, map[string]any) error
	changed      func(Scope)
}

func prepareCategories(sourceCategories []pkgsettings.Category) ([]pkgsettings.Category, error) {
	categories := make([]pkgsettings.Category, 0, len(sourceCategories))
	seen := make(map[string]bool)
	for _, cat := range sourceCategories {
		if cat.ID == "" || strings.Contains(cat.ID, ".") || seen[cat.ID] {
			return nil, fmt.Errorf("invalid or duplicate core settings category %q", cat.ID)
		}
		seen[cat.ID] = true
		source := cat.Settings
		cat.Settings = make(map[string]pkgsettings.Setting, len(source))
		for id, setting := range source {
			if id == "" || strings.Contains(id, ".") || setting.ID != id || setting.Default == nil {
				return nil, fmt.Errorf("invalid core setting definition %q", cat.ID+"."+id)
			}
			setting.Value = pkgsettings.CloneValue(setting.Default)
			if err := setting.SetValue(pkgsettings.CloneValue(setting.Default)); err != nil {
				return nil, fmt.Errorf("invalid default for setting %q", cat.ID+"."+id)
			}
			setting.Default = pkgsettings.CloneValue(setting.Value)
			setting.Value = pkgsettings.CloneValue(setting.Value)
			cat.Settings[id] = setting
		}
		categories = append(categories, cat)
	}
	return categories, nil
}

func Initialize(opts Options) (*Service, error) {
	categories, err := prepareCategories(opts.Categories)
	if err != nil {
		return nil, err
	}
	var service Service
	s := &service
	s.provider = pkgsettings.NewProvider(pkgsettings.ProviderOpts{
		Logger: opts.Logger, PluginSettings: categories, PluginID: "",
	})
	s.store = opts.Store
	s.metadata = make(map[string]pkgsettings.Category)
	s.baseline = make(map[string]any)
	if opts.Store == nil {
		s.diagnostics = append(s.diagnostics, Diagnostic{
			CategoryID: "", SettingID: "",
			Message: "Settings persistence is unavailable; using validated defaults. Changes cannot be saved.",
		})
	}
	for _, cat := range categories {
		s.metadata[cat.ID] = cat
		if opts.Store != nil {
			s.hydrate(cat, opts.Migrations[cat.ID])
		}
	}
	for catID, cat := range s.provider.ListSettings() {
		for id, setting := range cat.Settings {
			if setting.RequiresRestart {
				s.baseline[catID+"."+id] = pkgsettings.CloneValue(setting.Value)
			}
		}
	}
	sort.Strings(s.rejected)
	return s, nil
}

func (s *Service) hydrate(cat pkgsettings.Category, migrate Migration) {
	values, err := s.store.LoadCategory(cat.ID)
	if err != nil {
		s.diagnostics = append(s.diagnostics, Diagnostic{
			CategoryID: cat.ID, SettingID: "",
			Message: "Could not read persisted settings; using validated defaults.",
		})
		for id := range cat.Settings {
			s.rejected = append(s.rejected, cat.ID+"."+id)
		}
		return
	}
	if migrate != nil {
		var changed bool
		values, changed = migrate(values)
		if changed {
			if saveErr := s.store.SaveCategory(cat.ID, values); saveErr != nil {
				s.diagnostics = append(s.diagnostics, Diagnostic{
					CategoryID: cat.ID, SettingID: "",
					Message: "Could not persist migrated settings; this migration will be retried at next startup.",
				})
			}
		}
	}
	keys := make([]string, 0, len(values))
	for id := range values {
		keys = append(keys, id)
	}
	sort.Strings(keys)
	for _, id := range keys {
		if _, ok := cat.Settings[id]; !ok {
			s.diagnostics = append(s.diagnostics, Diagnostic{
				CategoryID: cat.ID, SettingID: id, Message: "Ignoring an unknown persisted setting.",
			})
			continue
		}
		_, commitErr := s.provider.CommitSettings(
			context.Background(), map[string]any{cat.ID + "." + id: values[id]}, nil,
		)
		if commitErr != nil {
			s.rejected = append(s.rejected, cat.ID+"."+id)
			s.diagnostics = append(s.diagnostics, Diagnostic{
				CategoryID: cat.ID, SettingID: id,
				Message: "Rejected an invalid persisted setting; using its validated default.",
			})
		}
	}
}

func (s *Service) Provider() pkgsettings.Provider { return s.provider }
func (s *Service) CategoryValues(id string) map[string]any {
	values, _ := s.provider.GetCategoryValues(id)
	return values
}
func (s *Service) Diagnostics() []Diagnostic    { return append([]Diagnostic(nil), s.diagnostics...) }
func (s *Service) RejectedSettingIDs() []string { return append([]string(nil), s.rejected...) }
func (s *Service) AttachPlugins(p Plugins)      { s.mu.Lock(); s.plugins = p; s.mu.Unlock() }
func (s *Service) SetApplyHandler(fn func(string, map[string]any) error) {
	s.mu.Lock()
	s.apply = fn
	s.mu.Unlock()
}
func (s *Service) SetChangeHandler(fn func(Scope)) { s.mu.Lock(); s.changed = fn; s.mu.Unlock() }
func validScope(scope Scope) error {
	if scope.Kind == hostScopeKind && scope.PluginID == "" || scope.Kind == pluginScopeKind && scope.PluginID != "" {
		return nil
	}
	return errors.New("invalid settings scope")
}
func (s *Service) GetSnapshot(scope Scope) (Snapshot, error) {
	result := Snapshot{Scope: scope, Categories: make(pkgsettings.Store)}
	if err := validScope(scope); err != nil {
		return result, err
	}
	if scope.Kind == pluginScopeKind {
		s.mu.RLock()
		p := s.plugins
		s.mu.RUnlock()
		if p == nil {
			return result, errors.New("plugin settings unavailable")
		}
		cat, err := p.Snapshot(scope.PluginID)
		if err != nil {
			return result, err
		}
		result.Categories[pluginScopeKind] = cat
		return result, nil
	}
	for catID, cat := range s.provider.ListSettings() {
		meta := s.metadata[catID]
		cat.Label = meta.Label
		cat.Description = meta.Description
		cat.Icon = meta.Icon
		for id, setting := range cat.Settings {
			baseline, ok := s.baseline[catID+"."+id]
			setting.PendingRestart = ok && !reflect.DeepEqual(baseline, setting.Value)
			if setting.Sensitive || setting.Type == pkgsettings.Password {
				setting.Sensitive = true
				setting.Value = nil
				setting.Default = nil
				setting.Options = nil
				setting.FileSelection = nil
			}
			cat.Settings[id] = setting
		}
		result.Categories[catID] = cat
	}
	return result, nil
}
func (s *Service) Validate(scope Scope, id string, value any) (pkgsettings.ValidationResult, error) {
	if err := validScope(scope); err != nil {
		return pkgsettings.ValidationResult{}, err
	}
	if scope.Kind == pluginScopeKind {
		s.mu.RLock()
		p := s.plugins
		s.mu.RUnlock()
		if p == nil {
			return pkgsettings.ValidationResult{}, errors.New("plugin settings unavailable")
		}
		return p.ValidateSetting(scope.PluginID, id, value)
	}
	setting, err := s.provider.GetSetting(id)
	if err != nil {
		return pkgsettings.ValidationResult{}, err
	}
	return setting.Validation(value), nil
}
func (s *Service) Commit(scope Scope, values map[string]any) (CommitResult, error) {
	var result CommitResult
	if err := validScope(scope); err != nil {
		return result, err
	}
	if s.store == nil {
		return result, settingsstore.ErrUnavailable
	}
	if scope.Kind == hostScopeKind {
		s.hostCommitMu.Lock()
		defer s.hostCommitMu.Unlock()
	}
	s.mu.RLock()
	p, apply, changed := s.plugins, s.apply, s.changed
	s.mu.RUnlock()
	var committed pkgsettings.CommitResult
	var err error
	if scope.Kind == pluginScopeKind {
		if p == nil {
			return result, errors.New("plugin settings unavailable")
		}
		committed, err = p.CommitSettings(
			context.Background(), scope.PluginID, values,
			func(normalized map[string]any) error {
				return s.store.PatchPluginSettings(scope.PluginID, normalized)
			},
		)
	} else {
		committed, err = s.provider.CommitSettings(context.Background(), values, s.store.PatchSettings)
	}
	if err != nil {
		var validation *pkgsettings.ValidationError
		return result, &CommitError{
			Validation: errors.As(err, &validation) || status.Code(err) == codes.InvalidArgument,
			cause:      err,
		}
	}
	result.Applied = committed.Applied
	result.Uncertain = committed.Uncertain
	if scope.Kind == hostScopeKind && committed.Committed && apply != nil {
		if !s.applyHostChanges(values, apply) {
			result.Applied = false
		}
	}
	if !result.Applied {
		result.Message = "Settings were saved but could not be applied. Restart Omniview to load the saved configuration."
	}
	result.Snapshot, err = s.GetSnapshot(scope)
	if err != nil {
		result.Snapshot = Snapshot{Scope: scope, Categories: make(pkgsettings.Store)}
		result.Message = "Settings were saved, but the current settings view is unavailable."
	}
	if changed != nil {
		changed(scope)
	}
	return result, nil
}

func (s *Service) applyHostChanges(values map[string]any, apply func(string, map[string]any) error) bool {
	categories := make(map[string]bool)
	for id := range values {
		cat, _, _ := strings.Cut(id, ".")
		categories[cat] = true
	}
	applied := true
	for cat := range categories {
		if applyErr := apply(cat, s.CategoryValues(cat)); applyErr != nil {
			applied = false
		}
	}
	return applied
}
