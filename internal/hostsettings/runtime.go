// Package hostsettings prepares core settings once and owns durable host writes.
// Provider reads retain the SDK's configured-value semantics. User writes must
// use Runtime, not the provider's in-memory setters.
package hostsettings

import (
	"errors"
	"fmt"
	"reflect"
	"sort"
	"strings"
	"sync"

	"go.uber.org/zap"

	settingsstore "github.com/omniviewdev/omniview/internal/settings/store"
	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
)

// Migration upgrades a category's persisted values before validation.
type Migration func(map[string]any) (map[string]any, bool)

// Writer is the narrow shared host-save boundary for frontend and local control.
type Writer interface {
	SetSetting(string, any) error
	SetSettings(map[string]any) error
}

// Options contains host definitions and optional persistence. A nil store permits
// startup with defaults, but never permits successful user saves.
type Options struct {
	Store           *settingsstore.Store
	Categories      []pkgsettings.Category
	RestartRequired []string
	Migrations      map[string]Migration
	Logger          *zap.SugaredLogger
}

// SettingState exposes restart flags only, never configured or startup values.
type SettingState struct {
	RequiresRestart bool `json:"requiresRestart"`
	PendingRestart  bool `json:"pendingRestart"`
}

// Diagnostic describes recovery without disclosing a persisted value.
type Diagnostic struct {
	CategoryID string
	SettingID  string
	Message    string
}

// CommittedApplyError means persistence succeeded but in-memory publication or a
// live effect failed. Restarting loads the saved configuration; no rollback ran.
type CommittedApplyError struct {
	cause error
}

func (e *CommittedApplyError) Error() string {
	return "Settings were saved but could not be applied. Restart Omniview to load the saved configuration."
}

func (e *CommittedApplyError) Unwrap() error { return e.cause }

// Runtime owns one SDK provider and serializes validation, commit and publish.
// Callbacks may read Runtime and report live-apply failures. They must not write
// settings recursively; they run synchronously inside the serialized write.
type Runtime struct {
	provider pkgsettings.Provider
	store    *settingsstore.Store
	writeMu  sync.Mutex
	// committed preserves durable values even if a rare provider apply fails.
	committed map[string]map[string]any
	// pendingPublish contains only durable values the provider has not accepted.
	pendingPublish map[string]any
	baseline       map[string]any
	diagnostics    []Diagnostic
	rejected       []string
	applyMu        sync.Mutex
	applyErr       error
}

// Initialize registers validated definitions, migrates and hydrates once, then
// freezes restart baselines. Recoverable storage failures become diagnostics.
func Initialize(opts Options) (*Runtime, error) {
	categories, err := prepareCategories(opts.Categories)
	if err != nil {
		return nil, err
	}
	r := &Runtime{
		provider: pkgsettings.NewProvider(pkgsettings.ProviderOpts{
			Logger: opts.Logger, PluginSettings: categories, PluginID: "",
		}),
		store:          opts.Store,
		writeMu:        sync.Mutex{},
		committed:      make(map[string]map[string]any, len(categories)),
		pendingPublish: nil,
		baseline:       make(map[string]any, len(opts.RestartRequired)),
		diagnostics:    nil,
		rejected:       nil,
		applyMu:        sync.Mutex{},
		applyErr:       nil,
	}
	if opts.Store == nil {
		r.addDiagnostic("", "",
			"Settings persistence is unavailable; using validated defaults. Changes cannot be saved.")
	}
	for _, category := range categories {
		if opts.Store != nil {
			r.hydrateCategory(category, opts.Migrations[category.ID])
		}
		r.committed[category.ID] = r.CategoryValues(category.ID)
	}
	for _, id := range opts.RestartRequired {
		setting, getErr := r.provider.GetSetting(id)
		if getErr != nil {
			return nil, fmt.Errorf("restart-required setting %q: %w", id, getErr)
		}
		r.baseline[id] = cloneValue(setting.Value)
	}
	sort.Strings(r.rejected)
	return r, nil
}

func (r *Runtime) addDiagnostic(categoryID, settingID, message string) {
	r.diagnostics = append(r.diagnostics, Diagnostic{
		CategoryID: categoryID, SettingID: settingID, Message: message,
	})
}

func (r *Runtime) hydrateCategory(category pkgsettings.Category, migrate Migration) {
	values, err := r.store.LoadCategory(category.ID)
	if err != nil {
		r.addDiagnostic(category.ID, "", "Could not read persisted settings; using validated defaults.")
		for id := range category.Settings {
			r.rejected = append(r.rejected, category.ID+"."+id)
		}
		return
	}
	if migrate != nil {
		var changed bool
		values, changed = migrate(cloneMap(values))
		if changed {
			if saveErr := r.store.SaveCategory(category.ID, values); saveErr != nil {
				r.addDiagnostic(category.ID, "",
					"Could not persist migrated settings; this migration will be retried at next startup.")
			}
		}
	}
	r.hydrateValues(category, values)
}

func (r *Runtime) hydrateValues(category pkgsettings.Category, values map[string]any) {
	for _, id := range sortedKeys(values) {
		definition, known := category.Settings[id]
		if !known {
			r.addDiagnostic(category.ID, id, "Ignoring an unknown persisted setting.")
			continue
		}
		value, err := normalize(definition, values[id])
		if err == nil {
			err = r.provider.SetSetting(category.ID+"."+id, value)
		}
		if err != nil {
			r.rejected = append(r.rejected, category.ID+"."+id)
			r.addDiagnostic(category.ID, id,
				"Rejected an invalid persisted setting; using its validated default.")
		}
	}
}

// Provider returns the original SDK provider, preserving registration and reads.
func (r *Runtime) Provider() pkgsettings.Provider { return r.provider }

// CategoryValues returns a detached, unredacted host-only configured snapshot.
// Do not expose it as a frontend binding; telemetry needs its sensitive values.
func (r *Runtime) CategoryValues(categoryID string) map[string]any {
	if reader, ok := r.provider.(interface {
		GetCategoryValues(string) (map[string]any, error)
	}); ok {
		values, err := reader.GetCategoryValues(categoryID)
		if err != nil {
			return map[string]any{}
		}
		return cloneMap(values)
	}
	category, ok := r.provider.ListSettings()[categoryID]
	if !ok {
		return map[string]any{}
	}
	values := make(map[string]any, len(category.Settings))
	for id, setting := range category.Settings {
		values[id] = cloneValue(setting.Value)
	}
	return values
}

func (r *Runtime) Diagnostics() []Diagnostic {
	return append([]Diagnostic(nil), r.diagnostics...)
}

func (r *Runtime) RejectedSettingIDs() []string {
	return append([]string(nil), r.rejected...)
}

// GetSettingStates compares configured values against the immutable normalized
// startup snapshot. It does not acquire the write lock, so callbacks may read it.
func (r *Runtime) GetSettingStates() map[string]SettingState {
	current := r.provider.ListSettings()
	states := make(map[string]SettingState, len(r.baseline))
	for id, baseline := range r.baseline {
		categoryID, settingID, _ := strings.Cut(id, ".")
		setting := current[categoryID].Settings[settingID]
		states[id] = SettingState{RequiresRestart: true, PendingRestart: !reflect.DeepEqual(baseline, setting.Value)}
	}
	return states
}

func (r *Runtime) SetSetting(id string, value any) error {
	return r.SetSettings(map[string]any{id: value})
}

// ReportApplyError lets the existing category callback report a failed live
// effect to the current save without taking the writer lock. The public error
// is fixed text, so arbitrary effect errors cannot leak credentials to the UI.
func (r *Runtime) ReportApplyError(err error) {
	if err == nil {
		return
	}
	r.applyMu.Lock()
	r.applyErr = errors.Join(r.applyErr, err)
	r.applyMu.Unlock()
}

// SetSettings validates the whole request, commits categories atomically, then
// publishes to the SDK provider. Callbacks never own persistence.
func (r *Runtime) SetSettings(values map[string]any) error {
	r.writeMu.Lock()
	defer r.writeMu.Unlock()
	if r.store == nil {
		return settingsstore.ErrUnavailable
	}
	if len(values) == 0 {
		return nil
	}
	categories := make(map[string]map[string]any)
	normalizedChanges := make(map[string]any, len(values))
	for _, id := range sortedKeys(values) {
		setting, err := r.provider.GetSetting(id)
		if err != nil {
			return fmt.Errorf("setting %q: %w", id, err)
		}
		categoryID, settingID, _ := strings.Cut(id, ".")
		committed, known := r.committed[categoryID]
		if !known {
			return fmt.Errorf("setting %q: not a core settings category", id)
		}
		normalized, err := normalize(setting, values[id])
		if err != nil {
			return fmt.Errorf("setting %q: %w", id, err)
		}
		if categories[categoryID] == nil {
			categories[categoryID] = cloneMap(committed)
		}
		categories[categoryID][settingID] = normalized
		normalizedChanges[id] = normalized
	}
	if err := r.store.SaveCategories(categories); err != nil {
		return fmt.Errorf("save settings: %w", err)
	}
	for categoryID, category := range categories {
		r.committed[categoryID] = cloneMap(category)
	}
	if r.pendingPublish == nil {
		r.pendingPublish = make(map[string]any, len(normalizedChanges))
	}
	for id, value := range normalizedChanges {
		r.pendingPublish[id] = cloneValue(value)
	}
	// Retry only unpublished durable values. Revalidating already-published
	// siblings could fail because an unrelated executable or file disappeared.
	publish := cloneMap(r.pendingPublish)
	r.applyMu.Lock()
	r.applyErr = nil
	r.applyMu.Unlock()
	publishErr := r.provider.SetSettings(publish)
	if publishErr == nil {
		r.pendingPublish = nil
	}
	r.applyMu.Lock()
	applyErr := errors.Join(publishErr, r.applyErr)
	r.applyErr = nil
	r.applyMu.Unlock()
	if applyErr != nil {
		return &CommittedApplyError{cause: applyErr}
	}
	return nil
}

func prepareCategories(input []pkgsettings.Category) ([]pkgsettings.Category, error) {
	categories := make([]pkgsettings.Category, 0, len(input))
	seen := make(map[string]bool, len(input))
	for _, category := range input {
		if category.ID == "" || strings.Contains(category.ID, ".") || seen[category.ID] {
			return nil, fmt.Errorf("invalid or duplicate core settings category %q", category.ID)
		}
		seen[category.ID] = true
		definitions := category.Settings
		category.Settings = make(map[string]pkgsettings.Setting, len(definitions))
		for _, id := range sortedKeys(definitions) {
			setting := definitions[id]
			if id == "" || strings.Contains(id, ".") || setting.ID != id || setting.Default == nil {
				return nil, fmt.Errorf("invalid core setting definition %q", category.ID+"."+id)
			}
			setting.Default = cloneValue(setting.Default)
			setting.Value = cloneValue(setting.Default)
			value, err := normalize(setting, setting.Default)
			if err != nil {
				return nil, fmt.Errorf("invalid default for setting %q", category.ID+"."+id)
			}
			setting.Default = value
			setting.Value = cloneValue(value)
			setting.Options = append([]pkgsettings.SettingOption(nil), setting.Options...)
			for i := range setting.Options {
				setting.Options[i].Value = cloneValue(setting.Options[i].Value)
			}
			if setting.FileSelection != nil {
				selection := *setting.FileSelection
				selection.Extensions = append([]string(nil), selection.Extensions...)
				setting.FileSelection = &selection
			}
			category.Settings[id] = setting
		}
		categories = append(categories, category)
	}
	return categories, nil
}

// normalize uses Setting.SetValue rather than validation alone. Guard invalid
// nil and asymmetric conversions before entering the SDK's reflection converter.
func normalize(setting pkgsettings.Setting, value any) (any, error) {
	currentType, valueType := reflect.TypeOf(setting.Value), reflect.TypeOf(value)
	if currentType == nil || valueType == nil {
		return nil, errors.New("value has an incompatible type")
	}
	if currentType.Kind() != reflect.Slice || valueType.Kind() != reflect.Slice {
		if currentType.ConvertibleTo(valueType) && !valueType.ConvertibleTo(currentType) {
			return nil, errors.New("value has an incompatible type")
		}
	}
	if err := setting.SetValue(cloneValue(value)); err != nil {
		return nil, err
	}
	return cloneValue(setting.Value), nil
}

func sortedKeys[V any](values map[string]V) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func cloneMap(values map[string]any) map[string]any {
	if values == nil {
		return nil
	}
	cloned := make(map[string]any, len(values))
	for key, value := range values {
		cloned[key] = cloneValue(value)
	}
	return cloned
}

func cloneValue(value any) any {
	if value == nil {
		return nil
	}
	return cloneReflect(reflect.ValueOf(value)).Interface()
}

func cloneReflect(value reflect.Value) reflect.Value {
	switch value.Kind() {
	case reflect.Interface:
		if value.IsNil() {
			return reflect.Zero(value.Type())
		}
		cloned := reflect.New(value.Type()).Elem()
		cloned.Set(cloneReflect(value.Elem()))
		return cloned
	case reflect.Map:
		if value.IsNil() {
			return reflect.Zero(value.Type())
		}
		cloned := reflect.MakeMapWithSize(value.Type(), value.Len())
		iter := value.MapRange()
		for iter.Next() {
			cloned.SetMapIndex(iter.Key(), cloneReflect(iter.Value()))
		}
		return cloned
	case reflect.Slice:
		if value.IsNil() {
			return reflect.Zero(value.Type())
		}
		cloned := reflect.MakeSlice(value.Type(), value.Len(), value.Len())
		for i := range value.Len() {
			cloned.Index(i).Set(cloneReflect(value.Index(i)))
		}
		return cloned
	case reflect.Array:
		cloned := reflect.New(value.Type()).Elem()
		for i := range value.Len() {
			cloned.Index(i).Set(cloneReflect(value.Index(i)))
		}
		return cloned
	case reflect.Pointer:
		if value.IsNil() {
			return reflect.Zero(value.Type())
		}
		cloned := reflect.New(value.Type().Elem())
		cloned.Elem().Set(cloneReflect(value.Elem()))
		return cloned
	case reflect.Invalid, reflect.Bool,
		reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64,
		reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64, reflect.Uintptr,
		reflect.Float32, reflect.Float64, reflect.Complex64, reflect.Complex128,
		reflect.Chan, reflect.Func, reflect.String, reflect.Struct, reflect.UnsafePointer:
		return value
	}
	return value
}
