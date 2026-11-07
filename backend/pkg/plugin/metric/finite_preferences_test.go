package metric

import (
	"path/filepath"
	"strconv"
	"testing"

	settingsstore "github.com/omniviewdev/omniview/internal/settings/store"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/stretchr/testify/require"
)

func TestMetricPreferencesDurableCASPreservesConcurrentEdits(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.db")
	store, err := settingsstore.Open(path)
	require.NoError(t, err)
	c := NewController(logging.NewNop(), nil, nil).(*controller)
	c.SetMetricPreferencesStore(store)
	first, err := c.GetMetricViewPreferences("kubernetes", "core::v1::Pod")
	require.NoError(t, err)
	second, err := c.GetMetricViewPreferences("kubernetes", "core::v1::Pod")
	require.NoError(t, err)
	first.MetricIDs = []string{"memory", "cpu"}
	first.Displays["disk"] = "sample-bars"
	first.Details["disk"] = true
	first.Layout = "grid"
	require.NoError(t, c.SaveMetricViewPreferences("kubernetes", "core::v1::Pod", first))
	second.TimeMode = "absolute"
	second.StartMs = 1793880000000
	second.EndMs = 1793883600000
	require.Error(t, c.SaveMetricViewPreferences("kubernetes", "core::v1::Pod", second), "stale revision must not overwrite layout")
	merged, err := c.GetMetricViewPreferences("kubernetes", "core::v1::Pod")
	require.NoError(t, err)
	require.Equal(t, uint64(1), merged.Revision)
	require.Equal(t, "grid", merged.Layout)
	require.Equal(t, "relative", merged.TimeMode)
	merged.TimeMode = second.TimeMode
	merged.StartMs = second.StartMs
	merged.EndMs = second.EndMs
	merged.Displays[merged.MetricIDs[0]] = "capacity"
	require.NoError(t, c.SaveMetricViewPreferences("kubernetes", "core::v1::Pod", merged))
	require.NoError(t, store.Close())
	reopened, err := settingsstore.Open(path)
	require.NoError(t, err)
	defer reopened.Close()
	restarted := NewController(logging.NewNop(), nil, nil).(*controller)
	restarted.SetMetricPreferencesStore(reopened)
	durable, err := restarted.GetMetricViewPreferences("kubernetes", "core::v1::Pod")
	require.NoError(t, err)
	require.Equal(t, uint64(2), durable.Revision)
	require.Equal(t, "grid", durable.Layout)
	require.Equal(t, []string{"memory", "cpu"}, durable.MetricIDs)
	require.Equal(t, "sample-bars", durable.Displays["disk"])
	require.True(t, durable.Details["disk"])
	require.Equal(t, "absolute", durable.TimeMode)
	require.Equal(t, second.StartMs, durable.StartMs)
	require.Equal(t, "capacity", durable.Displays[durable.MetricIDs[0]])
	other, err := restarted.GetMetricViewPreferences("other-plugin", "core::v1::Pod")
	require.NoError(t, err)
	require.Zero(t, other.Revision)
	require.Equal(t, "auto", other.Layout)
}
func TestMetricPreferencesRejectUnavailableStoreAndInvalidDocuments(t *testing.T) {
	c := NewController(logging.NewNop(), nil, nil).(*controller)
	_, err := c.GetMetricViewPreferences("kubernetes", "core::v1::Pod")
	require.ErrorIs(t, err, settingsstore.ErrUnavailable)
	require.ErrorIs(t, c.SaveMetricViewPreferences("kubernetes", "core::v1::Pod", defaultMetricViewPreferences()), settingsstore.ErrUnavailable)
	store, err := settingsstore.Open(filepath.Join(t.TempDir(), "settings.db"))
	require.NoError(t, err)
	defer store.Close()
	c.SetMetricPreferencesStore(store)
	invalid := defaultMetricViewPreferences()
	invalid.MetricIDs = []string{"cpu", "cpu"}
	require.Error(t, c.SaveMetricViewPreferences("kubernetes", "core::v1::Pod", invalid))
	invalid = defaultMetricViewPreferences()
	invalid.Displays["cpu"] = "unknown"
	require.Error(t, c.SaveMetricViewPreferences("kubernetes", "core::v1::Pod", invalid))
	current, err := c.GetMetricViewPreferences("kubernetes", "core::v1::Pod")
	require.NoError(t, err)
	require.Zero(t, current.Revision)
}

func TestMetricPreferencesPersistExplicitEmptySelection(t *testing.T) {
	store, err := settingsstore.Open(filepath.Join(t.TempDir(), "settings.db"))
	require.NoError(t, err)
	defer store.Close()
	c := NewController(logging.NewNop(), nil, nil).(*controller)
	c.SetMetricPreferencesStore(store)
	uninitialized, err := c.GetMetricViewPreferences("any-plugin", "any-resource")
	require.NoError(t, err)
	require.Zero(t, uninitialized.Revision)
	require.Empty(t, uninitialized.MetricIDs)
	require.NoError(t, c.SaveMetricViewPreferences("any-plugin", "any-resource", uninitialized))
	empty, err := c.GetMetricViewPreferences("any-plugin", "any-resource")
	require.NoError(t, err)
	require.Equal(t, uint64(1), empty.Revision)
	require.Empty(t, empty.MetricIDs)
}

func TestMetricPreferencesRetainUnselectedConfigurationAndSelectionOrder(t *testing.T) {
	store, err := settingsstore.Open(filepath.Join(t.TempDir(), "settings.db"))
	require.NoError(t, err)
	defer store.Close()
	c := NewController(logging.NewNop(), nil, nil).(*controller)
	c.SetMetricPreferencesStore(store)
	selected, err := c.GetMetricViewPreferences("kubernetes", "core::v1::Pod")
	require.NoError(t, err)
	selected.MetricIDs = []string{"memory", "cpu"}
	selected.Displays = map[string]string{"memory": "area", "cpu": "capacity"}
	selected.Details = map[string]bool{"memory": true, "cpu": false}
	require.NoError(t, c.SaveMetricViewPreferences("kubernetes", "core::v1::Pod", selected))
	selected, err = c.GetMetricViewPreferences("kubernetes", "core::v1::Pod")
	require.NoError(t, err)
	require.Equal(t, []string{"memory", "cpu"}, selected.MetricIDs)
	selected.MetricIDs = []string{"cpu"}
	require.NoError(t, c.SaveMetricViewPreferences("kubernetes", "core::v1::Pod", selected))
	unselected, err := c.GetMetricViewPreferences("kubernetes", "core::v1::Pod")
	require.NoError(t, err)
	require.Equal(t, []string{"cpu"}, unselected.MetricIDs)
	require.Equal(t, "area", unselected.Displays["memory"])
	require.True(t, unselected.Details["memory"])
	unselected.MetricIDs = []string{"cpu", "memory"}
	require.NoError(t, c.SaveMetricViewPreferences("kubernetes", "core::v1::Pod", unselected))
	reselected, err := c.GetMetricViewPreferences("kubernetes", "core::v1::Pod")
	require.NoError(t, err)
	require.Equal(t, []string{"cpu", "memory"}, reselected.MetricIDs)
	require.Equal(t, selected.Displays, reselected.Displays)
	require.Equal(t, selected.Details, reselected.Details)
}

func TestMetricPreferencesBoundRetainedConfigurationIndependently(t *testing.T) {
	for _, field := range []string{"displays", "details"} {
		t.Run(field, func(t *testing.T) {
			store, err := settingsstore.Open(filepath.Join(t.TempDir(), "settings.db"))
			require.NoError(t, err)
			defer store.Close()
			c := NewController(logging.NewNop(), nil, nil).(*controller)
			c.SetMetricPreferencesStore(store)
			preferences, err := c.GetMetricViewPreferences("kubernetes", "core::v1::Pod")
			require.NoError(t, err)
			for i := range 128 {
				id := "retained-" + strconv.Itoa(i)
				if field == "displays" {
					preferences.Displays[id] = "value"
				} else {
					preferences.Details[id] = true
				}
			}
			require.NoError(t, c.SaveMetricViewPreferences("kubernetes", "core::v1::Pod", preferences))
			persisted, err := c.GetMetricViewPreferences("kubernetes", "core::v1::Pod")
			require.NoError(t, err)
			require.Empty(t, persisted.MetricIDs)
			if field == "displays" {
				require.Len(t, persisted.Displays, 128)
				persisted.Displays["overflow"] = "value"
			} else {
				require.Len(t, persisted.Details, 128)
				persisted.Details["overflow"] = true
			}
			require.Error(t, c.SaveMetricViewPreferences("kubernetes", "core::v1::Pod", persisted))
			unchanged, err := c.GetMetricViewPreferences("kubernetes", "core::v1::Pod")
			require.NoError(t, err)
			require.Equal(t, persisted.Revision, unchanged.Revision)
			require.NotContains(t, unchanged.Displays, "overflow")
			require.NotContains(t, unchanged.Details, "overflow")
		})
	}
}

func TestMetricPreferencesRetainExactChartModesAcrossRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.db")
	store, err := settingsstore.Open(path)
	require.NoError(t, err)
	c := NewController(logging.NewNop(), nil, nil).(*controller)
	c.SetMetricPreferencesStore(store)
	preferences, err := c.GetMetricViewPreferences("kubernetes", "k8s:/pods")
	require.NoError(t, err)
	preferences.Displays = map[string]string{"cpu": "area", "memory": "line", "network": "sample-bars"}
	require.NoError(t, c.SaveMetricViewPreferences("kubernetes", "k8s:/pods", preferences))
	require.NoError(t, store.Close())
	store, err = settingsstore.Open(path)
	require.NoError(t, err)
	defer store.Close()
	restarted := NewController(logging.NewNop(), nil, nil).(*controller)
	restarted.SetMetricPreferencesStore(store)
	persisted, err := restarted.GetMetricViewPreferences("kubernetes", "k8s:/pods")
	require.NoError(t, err)
	require.Equal(t, preferences.Displays, persisted.Displays)
	other, err := restarted.GetMetricViewPreferences("kubernetes", "k8s:/nodes")
	require.NoError(t, err)
	require.Empty(t, other.Displays)
	persisted.Displays["cpu"] = "chart"
	require.Error(t, restarted.SaveMetricViewPreferences("kubernetes", "k8s:/pods", persisted))
}
