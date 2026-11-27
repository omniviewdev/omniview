//go:build ui_next

package bootstrap

import (
	"context"
	"encoding/json"
	"maps"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"

	settingsservice "github.com/omniviewdev/omniview/backend/pkg/settings"
	coresettings "github.com/omniviewdev/omniview/internal/settings"
	settingsstore "github.com/omniviewdev/omniview/internal/settings/store"
	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
)

func TestAppearanceBootAndCommittedEffects(t *testing.T) {
	store, err := settingsstore.Open(filepath.Join(t.TempDir(), "settings.db"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })
	require.NoError(t, store.SaveCategory("appearance", map[string]any{
		"windowMaterial": "glass", "glassStyle": "clear", "chromeOpacity": 74,
		"contentOpacity": 999, // Rejected during hydration, before any window sees it.
	}))
	category := coresettings.Appearance
	category.Settings = maps.Clone(category.Settings)
	category.Settings["future"] = pkgsettings.Setting{ID: "future", Type: pkgsettings.Password, Default: "private-example", Sensitive: true}
	service, err := settingsservice.Initialize(settingsservice.Options{Store: store, Categories: []pkgsettings.Category{category}})
	require.NoError(t, err)
	var applied []settingsservice.AppearanceRequest
	var notifications []uint64
	material := settingsservice.AppearanceMaterial{Effective: "in-page", Translucent: true, Reason: "unsupported"}
	service.SetupAppearance(
		func(request settingsservice.AppearanceRequest) { applied = append(applied, request) },
		func(context.Context) settingsservice.AppearanceMaterial { return material },
		func(revision uint64) { notifications = append(notifications, revision) },
	)
	bootstrap := &Service{Settings: service}
	bootstrap.attachSettingsEffects(context.Background())
	binding := &settingsservice.Binding{Service: service}
	read := func() settingsservice.AppearanceSnapshot {
		t.Helper()
		snapshot, readErr := binding.GetAppearance(context.Background())
		require.NoError(t, readErr)
		return snapshot
	}
	commit := func(key string, value any) {
		t.Helper()
		result, commitErr := binding.Commit(settingsservice.Scope{Kind: "host"}, map[string]any{"appearance." + key: value})
		require.NoError(t, commitErr)
		require.True(t, result.Applied)
	}
	initial := read()
	require.Equal(t, "glass", initial.Preferences.WindowMaterial)
	require.Equal(t, "clear", initial.Preferences.GlassStyle)
	require.Equal(t, 74, initial.Preferences.ChromeOpacity)
	require.Equal(t, 94, initial.Preferences.ContentOpacity)
	require.Equal(t, material, initial.Material)
	require.Equal(t, []settingsservice.AppearanceRequest{{WindowMaterial: "glass", GlassStyle: "clear", Theme: "void"}}, applied)
	wire, err := json.Marshal(initial)
	require.NoError(t, err)
	require.NotContains(t, string(wire), "private-example")
	require.NotContains(t, string(wire), "future")

	// Independent windows commit only their own scalar, over the same durable store.
	commit("chromeOpacity", 0)
	commit("sheetOpacity", 100)
	paint := read()
	require.Equal(t, initial.Revision+2, paint.Revision)
	require.Equal(t, 0, paint.Preferences.ChromeOpacity)
	require.Equal(t, 100, paint.Preferences.SheetOpacity)
	require.Len(t, applied, 1, "alpha changes are not native material transitions")
	commit("chromeOpacity", 0)
	commit("future", "another-private-example")
	require.Equal(t, paint, read(), "unrelated and identical changes do not invalidate the projection")
	require.Equal(t, []uint64{initial.Revision + 1, paint.Revision}, notifications)
	commit("windowMaterial", "translucent")
	require.Len(t, applied, 2)
	require.Equal(t, "translucent", applied[1].WindowMaterial)

	beforeOverride := read()
	material = settingsservice.AppearanceMaterial{Effective: "opaque", Translucent: true, ForcedOpaque: true, Reason: "accessibility"}
	service.AppearanceChanged()
	override := read()
	require.Greater(t, override.Revision, beforeOverride.Revision)
	require.Equal(t, beforeOverride.Preferences, override.Preferences)
	require.Equal(t, material, override.Material)
	saved, err := store.LoadCategory("appearance")
	require.NoError(t, err)
	require.Equal(t, "translucent", saved["windowMaterial"])
	require.Equal(t, float64(0), saved["chromeOpacity"])
	require.Equal(t, float64(100), saved["sheetOpacity"])

	_, err = binding.Commit(settingsservice.Scope{Kind: "host"}, map[string]any{"appearance.chromeOpacity": -1})
	require.Error(t, err)
	require.NoError(t, store.Close())
	_, err = binding.Commit(settingsservice.Scope{Kind: "host"}, map[string]any{"appearance.windowMaterial": "opaque"})
	require.Error(t, err)
	require.Equal(t, override, read(), "rejected and failed writes do not change committed paint")
	require.Len(t, applied, 2)
}
