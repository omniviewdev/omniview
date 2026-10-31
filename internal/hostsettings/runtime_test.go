package hostsettings

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	settingsstore "github.com/omniviewdev/omniview/internal/settings/store"
	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
)

func testCategories() []pkgsettings.Category {
	return []pkgsettings.Category{
		{ID: "developer", Label: "Developer", Icon: "LuBeaker", Settings: map[string]pkgsettings.Setting{
			"pprof_enabled": {ID: "pprof_enabled", Type: pkgsettings.Toggle, Default: false},
			"pprof_port": {
				ID: "pprof_port", Type: pkgsettings.Integer, Default: 6060,
				Validator: func(value any) pkgsettings.ValidationResult {
					switch v := value.(type) {
					case int:
						return pkgsettings.ValidationResult{Valid: v >= 0 && v <= 65535}
					case float64:
						return pkgsettings.ValidationResult{Valid: v >= 0 && v <= 65535 && v == float64(int(v))}
					default:
						return pkgsettings.ValidationResult{}
					}
				},
			},
		}},
		{ID: "ordinary", Settings: map[string]pkgsettings.Setting{
			"first":  {ID: "first", Type: pkgsettings.Text, Default: "first"},
			"second": {ID: "second", Type: pkgsettings.Text, Default: "second"},
			"secret": {ID: "secret", Type: pkgsettings.Password, Default: "secret", Sensitive: true},
		}},
	}
}

func testStore(t *testing.T) *settingsstore.Store {
	t.Helper()
	store, err := settingsstore.Open(filepath.Join(t.TempDir(), "settings.db"))
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, store.Close()) })
	return store
}

func testRuntime(t *testing.T, store *settingsstore.Store) *Runtime {
	t.Helper()
	runtime, err := Initialize(Options{
		Store: store, Categories: testCategories(),
		RestartRequired: []string{"developer.pprof_enabled", "developer.pprof_port"},
	})
	require.NoError(t, err)
	return runtime
}

func TestInitializeHydratesValidSiblingsAndReportsRejectedIDs(t *testing.T) {
	store := testStore(t)
	require.NoError(t, store.SaveCategory("developer", map[string]any{
		"pprof_enabled": true, "pprof_port": 12.5, "removed": "ignored",
	}))
	runtime := testRuntime(t, store)
	enabled, err := runtime.Provider().GetBool("developer.pprof_enabled")
	require.NoError(t, err)
	assert.True(t, enabled)
	port, err := runtime.Provider().GetInt("developer.pprof_port")
	require.NoError(t, err)
	assert.Equal(t, 6060, port)
	assert.Equal(t, []string{"developer.pprof_port"}, runtime.RejectedSettingIDs())
	assert.Len(t, runtime.Diagnostics(), 2)
	assert.Equal(t, "Developer", runtime.Provider().ListSettings()["developer"].Label)
	assert.Equal(t, "LuBeaker", runtime.Provider().ListSettings()["developer"].Icon)
	for _, state := range runtime.GetSettingStates() {
		assert.True(t, state.RequiresRestart)
		assert.False(t, state.PendingRestart)
	}
	// Returned startup reports cannot mutate the runtime's reports.
	runtime.RejectedSettingIDs()[0] = "changed"
	runtime.Diagnostics()[0].Message = "changed"
	assert.Equal(t, []string{"developer.pprof_port"}, runtime.RejectedSettingIDs())
	assert.NotEqual(t, "changed", runtime.Diagnostics()[0].Message)
}

func TestInitializeMigrationPrecedesHydrationAndBaseline(t *testing.T) {
	store := testStore(t)
	require.NoError(t, store.SaveCategory("developer", map[string]any{"legacy_port": 7070}))
	calls := 0
	runtime, err := Initialize(Options{
		Store: store, Categories: testCategories(), RestartRequired: []string{"developer.pprof_port"},
		Migrations: map[string]Migration{"developer": func(values map[string]any) (map[string]any, bool) {
			calls++
			values["pprof_port"] = values["legacy_port"]
			delete(values, "legacy_port")
			return values, true
		}},
	})
	require.NoError(t, err)
	assert.Equal(t, 1, calls)
	assert.Equal(t, 7070, runtime.CategoryValues("developer")["pprof_port"])
	assert.False(t, runtime.GetSettingStates()["developer.pprof_port"].PendingRestart)
	persisted, err := store.LoadCategory("developer")
	require.NoError(t, err)
	assert.Equal(t, map[string]any{"pprof_port": float64(7070)}, persisted)
	require.NoError(t, runtime.SetSetting("developer.pprof_port", float64(7070)))
	assert.False(t, runtime.GetSettingStates()["developer.pprof_port"].PendingRestart)
}

func TestInitializeUnavailableStoreUsesDefaultsButRejectsWrites(t *testing.T) {
	runtime := testRuntime(t, nil)
	assert.NotEmpty(t, runtime.Diagnostics())
	assert.Equal(t, 6060, runtime.CategoryValues("developer")["pprof_port"])
	require.ErrorIs(t, runtime.SetSetting("developer.pprof_port", 7070), settingsstore.ErrUnavailable)
	require.ErrorIs(t, runtime.SetSettings(map[string]any{}), settingsstore.ErrUnavailable)
	assert.False(t, runtime.GetSettingStates()["developer.pprof_port"].PendingRestart)
}

func TestInitializeReadFailureRejectsEveryAffectedID(t *testing.T) {
	store := testStore(t)
	require.NoError(t, store.Close())
	runtime := testRuntime(t, store)
	assert.Contains(t, runtime.RejectedSettingIDs(), "developer.pprof_enabled")
	assert.Contains(t, runtime.RejectedSettingIDs(), "developer.pprof_port")
	assert.Equal(t, false, runtime.CategoryValues("developer")["pprof_enabled"])
	assert.NotEmpty(t, runtime.Diagnostics())
}

func TestInitializeRejectsInvalidDefinitionsAndRestartMetadata(t *testing.T) {
	for _, categories := range [][]pkgsettings.Category{
		{{ID: "bad.id"}},
		{{ID: "duplicate"}, {ID: "duplicate"}},
		{{ID: "test", Settings: map[string]pkgsettings.Setting{"wrong": {ID: "other", Default: true}}}},
		{{ID: "test", Settings: map[string]pkgsettings.Setting{"nil": {ID: "nil"}}}},
		{{ID: "test", Settings: map[string]pkgsettings.Setting{
			"invalid": {
				ID: "invalid", Default: true,
				Validator: func(any) pkgsettings.ValidationResult { return pkgsettings.ValidationResult{} },
			},
		}}},
	} {
		_, err := Initialize(Options{Categories: categories})
		require.Error(t, err)
	}
	_, err := Initialize(Options{Categories: testCategories(), RestartRequired: []string{"developer.missing"}})
	require.Error(t, err)
}

func TestBulkValidationPublishesAndPersistsNothingOnFailure(t *testing.T) {
	store := testStore(t)
	runtime := testRuntime(t, store)
	calls := 0
	runtime.Provider().RegisterChangeHandler("ordinary", func(map[string]any) { calls++ })
	err := runtime.SetSettings(map[string]any{"ordinary.first": "changed", "developer.pprof_port": 1.5})
	require.Error(t, err)
	assert.Equal(t, "first", runtime.CategoryValues("ordinary")["first"])
	assert.Zero(t, calls)
	for _, category := range []string{"developer", "ordinary"} {
		values, loadErr := store.LoadCategory(category)
		require.NoError(t, loadErr)
		assert.Empty(t, values)
	}
	for _, value := range []any{nil, true, "7070"} {
		require.Error(t, runtime.SetSetting("developer.pprof_port", value))
	}
	require.Error(t, runtime.SetSetting("missing.setting", true))
}

func TestPersistenceFailureDoesNotPublishOrInvalidate(t *testing.T) {
	store := testStore(t)
	runtime := testRuntime(t, store)
	calls := 0
	runtime.Provider().RegisterChangeHandler("developer", func(map[string]any) { calls++ })
	require.NoError(t, store.Close())
	require.Error(t, runtime.SetSetting("developer.pprof_port", 7070))
	assert.Equal(t, 6060, runtime.CategoryValues("developer")["pprof_port"])
	assert.False(t, runtime.GetSettingStates()["developer.pprof_port"].PendingRestart)
	assert.Zero(t, calls)
}

func TestPublishCallbacksSeeDurableAllCategoryCommitAndMayReadRuntime(t *testing.T) {
	store := testStore(t)
	runtime := testRuntime(t, store)
	calls := 0
	callback := func(map[string]any) {
		calls++
		developer, err := store.LoadCategory("developer")
		require.NoError(t, err)
		ordinary, err := store.LoadCategory("ordinary")
		require.NoError(t, err)
		assert.InDelta(t, float64(7070), developer["pprof_port"], 0)
		assert.Equal(t, "changed", ordinary["first"])
		assert.Equal(t, "secret", ordinary["secret"], "secret redaction must not erase stored values")
		assert.True(t, runtime.GetSettingStates()["developer.pprof_port"].PendingRestart)
		assert.Equal(t, 7070, runtime.CategoryValues("developer")["pprof_port"])
	}
	runtime.Provider().RegisterChangeHandler("developer", callback)
	runtime.Provider().RegisterChangeHandler("ordinary", callback)
	require.NoError(t, runtime.SetSettings(map[string]any{
		"developer.pprof_port": float64(7070), "ordinary.first": "changed",
	}))
	assert.Equal(t, 2, calls)
}

func TestRestartStateNormalizesAndRestoresStartupValues(t *testing.T) {
	store := testStore(t)
	runtime := testRuntime(t, store)
	require.NoError(t, runtime.SetSetting("developer.pprof_port", float64(6060)))
	assert.False(t, runtime.GetSettingStates()["developer.pprof_port"].PendingRestart)
	require.NoError(t, runtime.SetSetting("developer.pprof_port", 0))
	assert.True(t, runtime.GetSettingStates()["developer.pprof_port"].PendingRestart)
	require.NoError(t, runtime.SetSetting("developer.pprof_port", float64(6060)))
	assert.False(t, runtime.GetSettingStates()["developer.pprof_port"].PendingRestart)
	assert.NotContains(t, runtime.GetSettingStates(), "ordinary.first")
	require.NoError(t, runtime.SetSetting("developer.pprof_enabled", true))
	restarted := testRuntime(t, store)
	assert.False(t, restarted.GetSettingStates()["developer.pprof_enabled"].PendingRestart)
	assert.Equal(t, true, restarted.CategoryValues("developer")["pprof_enabled"])
}

func TestRestartBaselineAndAcceptedCompositesAreDetached(t *testing.T) {
	store := testStore(t)
	initial := map[string]any{"nested": map[string]any{"a": "one", "b": "two"}, "ordered": []any{"a", "b"}}
	categories := []pkgsettings.Category{{ID: "test", Settings: map[string]pkgsettings.Setting{
		"composite": {ID: "composite", Type: pkgsettings.Select, Default: initial},
	}}}
	runtime, err := Initialize(Options{Store: store, Categories: categories, RestartRequired: []string{"test.composite"}})
	require.NoError(t, err)
	initialNested, ok := initial["nested"].(map[string]any)
	require.True(t, ok)
	initialNested["a"] = "mutated"
	assert.False(t, runtime.GetSettingStates()["test.composite"].PendingRestart)
	equal := map[string]any{"ordered": []any{"a", "b"}, "nested": map[string]any{"b": "two", "a": "one"}}
	require.NoError(t, runtime.SetSetting("test.composite", equal))
	assert.False(t, runtime.GetSettingStates()["test.composite"].PendingRestart)
	ordered, ok := equal["ordered"].([]any)
	require.True(t, ok)
	ordered[0] = "changed outside"
	composite, ok := runtime.CategoryValues("test")["composite"].(map[string]any)
	require.True(t, ok)
	nested, ok := composite["nested"].(map[string]any)
	require.True(t, ok)
	nested["a"] = "changed outside"
	assert.False(t, runtime.GetSettingStates()["test.composite"].PendingRestart)
	require.NoError(t, runtime.SetSetting("test.composite", map[string]any{
		"ordered": []any{"b", "a"}, "nested": map[string]any{"a": "one", "b": "two"},
	}))
	assert.True(t, runtime.GetSettingStates()["test.composite"].PendingRestart)
}

func TestCloneValueDetachesPointersAndPreservesTypedNil(t *testing.T) {
	value := []string{"original"}
	cloned, ok := cloneValue(&value).(*[]string)
	require.True(t, ok)
	require.NotSame(t, &value, cloned)
	(*cloned)[0] = "changed"
	assert.Equal(t, []string{"original"}, value)

	var nilPointer *[]string
	assert.Equal(t, nilPointer, cloneValue(nilPointer))
}

type failingPublishProvider struct {
	pkgsettings.Provider
	fail bool
}

func (p *failingPublishProvider) SetSettings(values map[string]any) error {
	if p.fail {
		return errors.New("publish failed")
	}
	return p.Provider.SetSettings(values)
}

func TestPostCommitPublishFailureIsExplicitAndNextSaveRecovers(t *testing.T) {
	store := testStore(t)
	runtime := testRuntime(t, store)
	provider := &failingPublishProvider{Provider: runtime.provider, fail: true}
	runtime.provider = provider
	err := runtime.SetSetting("ordinary.first", "durable")
	var committed *CommittedApplyError
	require.ErrorAs(t, err, &committed)
	assert.Contains(t, err.Error(), "saved")
	assert.NotContains(t, strings.ToLower(err.Error()), "rollback")
	persisted, loadErr := store.LoadCategory("ordinary")
	require.NoError(t, loadErr)
	assert.Equal(t, "durable", persisted["first"])
	assert.Equal(t, "first", runtime.CategoryValues("ordinary")["first"])
	provider.fail = false
	require.NoError(t, runtime.SetSetting("developer.pprof_enabled", true))
	assert.Equal(t, "durable", runtime.CategoryValues("ordinary")["first"],
		"a later save must retry pending values across categories")
	assert.Empty(t, runtime.pendingPublish)
	require.NoError(t, runtime.SetSetting("ordinary.second", "recovered"))
	assert.Equal(t, "durable", runtime.CategoryValues("ordinary")["first"])
	persisted, loadErr = store.LoadCategory("ordinary")
	require.NoError(t, loadErr)
	assert.Equal(t, "durable", persisted["first"])
	assert.Equal(t, "recovered", persisted["second"])
}

func TestPostCommitLiveEffectErrorIsSafeAndConfiguredStateStillUpdates(t *testing.T) {
	store := testStore(t)
	runtime := testRuntime(t, store)
	cause := errors.New("effect failed with secret credential")
	runtime.Provider().RegisterChangeHandler("developer", func(map[string]any) {
		runtime.ReportApplyError(cause)
		assert.True(t, runtime.GetSettingStates()["developer.pprof_enabled"].PendingRestart)
	})
	err := runtime.SetSetting("developer.pprof_enabled", true)
	var committed *CommittedApplyError
	require.ErrorAs(t, err, &committed)
	require.ErrorIs(t, err, cause)
	assert.NotContains(t, err.Error(), "credential")
	assert.Empty(t, runtime.pendingPublish, "published values must not be retried after a live-effect failure")
	assert.Equal(t, true, runtime.CategoryValues("developer")["pprof_enabled"])
	persisted, loadErr := store.LoadCategory("developer")
	require.NoError(t, loadErr)
	assert.Equal(t, true, persisted["pprof_enabled"])
	runtime.Provider().RegisterChangeHandler("developer", func(map[string]any) {})
	require.NoError(t, runtime.SetSetting("developer.pprof_enabled", false),
		"old live-apply errors must not taint later saves")
}

func TestConcurrentWritesDoNotLoseSiblingValues(t *testing.T) {
	store := testStore(t)
	runtime := testRuntime(t, store)
	var group sync.WaitGroup
	failures := make(chan error, 2)
	for _, id := range []string{"first", "second"} {
		group.Add(1)
		go func() {
			defer group.Done()
			for range 12 {
				if err := runtime.SetSetting("ordinary."+id, id+"-saved"); err != nil {
					failures <- err
					return
				}
			}
		}()
	}
	group.Wait()
	close(failures)
	for err := range failures {
		require.NoError(t, err)
	}
	persisted, err := store.LoadCategory("ordinary")
	require.NoError(t, err)
	assert.Equal(t, "first-saved", persisted["first"])
	assert.Equal(t, "second-saved", persisted["second"])
}

func TestHydrationRejectsInvalidProfilingValuesWithoutDiscardingSiblings(t *testing.T) {
	for _, values := range []map[string]any{
		{"pprof_enabled": "true", "pprof_port": 7070},
		{"pprof_enabled": nil, "pprof_port": 7070},
		{"pprof_enabled": true, "pprof_port": nil},
		{"pprof_enabled": true, "pprof_port": 65536},
	} {
		store := testStore(t)
		require.NoError(t, store.SaveCategory("developer", values))
		runtime := testRuntime(t, store)
		if _, valid := values["pprof_enabled"].(bool); !valid {
			assert.Contains(t, runtime.RejectedSettingIDs(), "developer.pprof_enabled")
			assert.Equal(t, false, runtime.CategoryValues("developer")["pprof_enabled"])
			assert.Equal(t, 7070, runtime.CategoryValues("developer")["pprof_port"])
		} else {
			assert.Contains(t, runtime.RejectedSettingIDs(), "developer.pprof_port")
			assert.Equal(t, true, runtime.CategoryValues("developer")["pprof_enabled"])
			assert.Equal(t, 6060, runtime.CategoryValues("developer")["pprof_port"])
		}
	}
}

func TestUnencodableWriteDoesNotPublishOrChangeRestartState(t *testing.T) {
	store := testStore(t)
	runtime, err := Initialize(Options{
		Store: store,
		Categories: []pkgsettings.Category{{ID: "test", Settings: map[string]pkgsettings.Setting{
			"map": {ID: "map", Type: pkgsettings.Select, Default: map[string]any{"safe": "initial"}},
		}}},
		RestartRequired: []string{"test.map"},
	})
	require.NoError(t, err)
	calls := 0
	runtime.Provider().RegisterChangeHandler("test", func(map[string]any) { calls++ })
	require.Error(t, runtime.SetSetting("test.map", map[string]any{"not_json": make(chan int)}))
	assert.Zero(t, calls)
	assert.False(t, runtime.GetSettingStates()["test.map"].PendingRestart)
	assert.Equal(t, map[string]any{"safe": "initial"}, runtime.CategoryValues("test")["map"])
	values, err := store.LoadCategory("test")
	require.NoError(t, err)
	assert.Empty(t, values)
}

func TestSavingUnrelatedSettingDoesNotRevalidatePublishedFileSibling(t *testing.T) {
	store := testStore(t)
	executable := filepath.Join(t.TempDir(), "go")
	require.NoError(t, os.WriteFile(executable, []byte("executable fixture"), 0o700))
	categories := testCategories()
	validations := 0
	categories[0].Settings["gopath"] = pkgsettings.Setting{
		ID: "gopath", Type: pkgsettings.Text, Default: executable,
		Validator: func(value any) pkgsettings.ValidationResult {
			validations++
			path, ok := value.(string)
			if !ok {
				return pkgsettings.ValidationResult{Message: "Choose an executable."}
			}
			_, err := os.Stat(path)
			return pkgsettings.ValidationResult{Valid: err == nil, Message: "Choose an existing executable."}
		},
	}
	runtime, err := Initialize(Options{
		Store: store, Categories: categories,
		RestartRequired: []string{"developer.pprof_enabled"},
	})
	require.NoError(t, err)
	require.NoError(t, runtime.SetSetting("developer.gopath", executable))
	acceptedValidations := validations
	require.NoError(t, os.Remove(executable))
	callbacks := 0
	runtime.Provider().RegisterChangeHandler("developer", func(map[string]any) { callbacks++ })
	require.NoError(t, runtime.SetSetting("developer.pprof_enabled", true))
	assert.Equal(t, acceptedValidations, validations, "unchanged published siblings must not run validators again")
	assert.True(t, runtime.GetSettingStates()["developer.pprof_enabled"].PendingRestart)
	assert.Equal(t, true, runtime.CategoryValues("developer")["pprof_enabled"])
	assert.Equal(t, 1, callbacks)
	persisted, err := store.LoadCategory("developer")
	require.NoError(t, err)
	assert.Equal(t, executable, persisted["gopath"])
	assert.Equal(t, true, persisted["pprof_enabled"])
}
