package window

import (
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// gatedSettingsHost holds native creation while other requests enter the service.
// Its callback models a UI-thread lifecycle hook during creation.
type gatedSettingsHost struct {
	*fakeHost
	entered chan struct{}
	release chan struct{}
}

func (h *gatedSettingsHost) createWindow(spec windowSpec, sink windowEventSink) nativeWindow {
	close(h.entered)
	<-h.release
	sink.windowVisibilityChanged(spec.Name, true)
	return h.fakeHost.createWindow(spec, sink)
}

func TestSettingsConcurrentOpenCreatesOneNativeWindow(t *testing.T) {
	h := newTestHarness(t, "", time.Second)
	host := &gatedSettingsHost{fakeHost: h.host, entered: make(chan struct{}), release: make(chan struct{})}
	h.service.host = host
	const requests = 24
	results := make(chan string, requests)
	errors := make(chan error, requests)
	var workers sync.WaitGroup
	for range requests {
		workers.Add(1)
		go func() {
			defer workers.Done()
			name, err := h.service.OpenSettings("")
			results <- name
			errors <- err
		}()
	}
	select {
	case <-host.entered:
	case <-time.After(time.Second):
		t.Fatal("settings creation never started")
	}
	assert.Equal(t, uint64(1), h.service.GetSettingsState().RequestID)
	close(host.release)
	done := make(chan struct{})
	go func() { workers.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("settings creation deadlocked with lifecycle callback")
	}
	for range requests {
		require.NoError(t, <-errors)
		assert.Equal(t, SettingsWindowName, <-results)
	}
	require.Len(t, h.host.specs, 1)
	assert.Equal(t, KindSettings, h.host.specs[0].Kind)
	assert.Equal(t, 1060, h.host.specs[0].Width)
	assert.Equal(t, 640, h.host.specs[0].Height)
	assert.Equal(t, uint64(1), h.service.GetSettingsState().RequestID)
	assert.Equal(t, requests, h.native(SettingsWindowName).activations)
}

func TestSettingsRequestsPreserveAcceptedLocationAndDraftWindow(t *testing.T) {
	h := newTestHarness(t, "", time.Second)
	name, err := h.service.OpenSettings("")
	require.NoError(t, err)
	assert.Equal(t, SettingsState{RequestID: 1, Target: "/settings?category=general", Visible: true}, h.service.GetSettingsState())
	native := h.native(name)
	require.NoError(t, h.service.SetSettingsLocation("/settings?category=appearance", 1))
	require.NoError(t, h.service.Close(name))
	assert.False(t, h.service.GetSettingsState().Visible)
	assert.Same(t, native, h.native(name))
	assert.Len(t, h.service.List(), 2)
	assert.Empty(t, h.emitter.eventsNamed(EventWindowClosed))
	_, err = h.service.OpenSettings("")
	require.NoError(t, err)
	assert.Equal(t, SettingsState{RequestID: 1, Target: "/settings?category=appearance", Visible: true}, h.service.GetSettingsState())
	for _, id := range []uint64{2, 3} {
		_, err = h.service.OpenSettings("/settings?plugin=example")
		require.NoError(t, err)
		assert.Equal(t, id, h.service.GetSettingsState().RequestID)
	}
	require.NoError(t, h.service.SetSettingsLocation("/settings?category=stale", 2))
	assert.Equal(t, "/settings?plugin=example", h.service.GetSettingsState().Target)
	require.NoError(t, h.service.SetSettingsLocation("/settings?plugin=accepted", 3))
	assert.Equal(t, "/settings?plugin=accepted", h.service.GetSettingsState().Target)
	assert.Len(t, h.host.specs, 1)
	events := h.emitter.eventsNamed(EventSettingsState)
	require.NotEmpty(t, events)
	foundHidden := false
	for _, event := range events {
		if !event.data.(SettingsState).Visible {
			foundHidden = true
		}
	}
	assert.True(t, foundHidden)
}

func TestSettingsLocationRaceRejectsOldRequest(t *testing.T) {
	h := newTestHarness(t, "", time.Second)
	_, err := h.service.OpenSettings("/settings?category=general")
	require.NoError(t, err)
	var workers sync.WaitGroup
	workers.Add(2)
	go func() {
		defer workers.Done()
		_, openErr := h.service.OpenSettings("/settings?category=appearance")
		assert.NoError(t, openErr)
	}()
	go func() {
		defer workers.Done()
		assert.NoError(t, h.service.SetSettingsLocation("/settings?category=old", 1))
	}()
	workers.Wait()
	assert.Equal(t, SettingsState{RequestID: 2, Target: "/settings?category=appearance", Visible: true}, h.service.GetSettingsState())
}

func TestSettingsRejectsNonLocalTargetsWithoutChangingWindow(t *testing.T) {
	for _, target := range []string{"/plugins", "/settings-other", "/settings/plugin", "https://example.test/settings", "//example.test/settings"} {
		t.Run(target, func(t *testing.T) {
			h := newTestHarness(t, "", time.Second)
			before := h.service.GetSettingsState()
			name, err := h.service.OpenSettings(target)
			require.Error(t, err)
			assert.Empty(t, name)
			assert.Equal(t, before, h.service.GetSettingsState())
			assert.Empty(t, h.host.specs)

			name, err = h.service.OpenSettings("/settings?category=general")
			require.NoError(t, err)
			require.NoError(t, h.service.HideSettings())
			before = h.service.GetSettingsState()
			activations := h.native(name).activations
			_, err = h.service.OpenSettings(target)
			require.Error(t, err)
			require.Error(t, h.service.SetSettingsLocation(target, before.RequestID))
			assert.Equal(t, before, h.service.GetSettingsState())
			assert.Equal(t, activations, h.native(name).activations)
			assert.Len(t, h.host.specs, 1)
		})
	}
}

func TestSettingsRetainsLocalTargetsWithQueriesAndFragments(t *testing.T) {
	h := newTestHarness(t, "", time.Second)
	for _, target := range []string{"/settings", "/settings/", "/settings?category=general", "/settings#section", "/settings/?category=general#section"} {
		name, err := h.service.OpenSettings(target)
		require.NoError(t, err)
		assert.Equal(t, SettingsWindowName, name)
		assert.Equal(t, target, h.service.GetSettingsState().Target)
		assert.True(t, h.service.GetSettingsState().Visible)
	}
	assert.Len(t, h.host.specs, 1)
}

func TestSettingsExcludedFromSessionAndTransfer(t *testing.T) {
	h := newTestHarness(t, "", time.Second)
	_, err := h.service.OpenSettings("")
	require.NoError(t, err)
	require.ErrorIs(t, h.service.SaveState(SettingsWindowName, "draft", `{}`), ErrInvalidState)
	assert.NotContains(t, h.service.ListStates(), SettingsWindowName)
	snapshot := h.service.snapshotSession()
	assert.NotContains(t, snapshot.States, SettingsWindowName)
	assert.Empty(t, snapshot.Windows)
	_, err = h.service.Open(OpenRequest{Kind: KindSettings})
	assert.ErrorIs(t, err, ErrInvalidKind)
	_, err = h.service.Open(OpenRequest{Kind: KindWorkspace, HasPosition: true, AnchorWindow: SettingsWindowName})
	assert.ErrorIs(t, err, ErrInvalidDrag)
	assert.ErrorIs(t, h.service.MoveToPointer(SettingsWindowName, 10, 10), ErrInvalidDrag)
	assert.ErrorIs(t, h.service.BeginDrag(DragBegin{SessionID: "settings-drag", SourceWindow: SettingsWindowName}), ErrInvalidDrag)
	h.setGeometry(MainWindowName, Bounds{X: 0, Y: 0, Width: 500, Height: 500}, 500, 500)
	h.setGeometry(SettingsWindowName, Bounds{X: 600, Y: 0, Width: 500, Height: 500}, 500, 500)
	h.service.mu.Lock()
	assert.Empty(t, h.service.registry.dropTargetAt(MainWindowName, 650, 100))
	h.service.mu.Unlock()
	h.native(SettingsWindowName).Hide()
	assert.False(t, h.service.GetSettingsState().Visible)
	require.NoError(t, h.service.ServiceShutdown())
	assert.True(t, h.service.shutdownStarted())
	_, err = h.service.OpenSettings("")
	assert.Error(t, err)
}

func TestSettingsNeverRestoredIncludingOrphanSlots(t *testing.T) {
	h := newTestHarness(t, "", time.Second)
	h.service.restoreWindows(persistedSession{
		Windows: []persistedWindow{{Name: SettingsWindowName, Kind: KindSettings}, {Name: "old-settings", Kind: KindSettings}},
		States:  map[string]map[string]string{SettingsWindowName: {"draft": `{}`}, "old-settings": {"draft": `{}`}},
	})
	assert.Len(t, h.service.List(), 1)
	assert.Empty(t, h.service.pendingRestores)
	assert.NotContains(t, h.service.snapshotSession().States, SettingsWindowName)
	assert.NotContains(t, h.service.snapshotSession().States, "old-settings")
}

func TestSettingsGeometryClampsToWorkArea(t *testing.T) {
	h := newTestHarness(t, "", time.Second)
	h.host.workArea = &Bounds{X: 100, Y: 50, Width: 900, Height: 550}
	_, err := h.service.OpenSettings("")
	require.NoError(t, err)
	require.Len(t, h.host.specs, 1)
	assert.Equal(t, 900, h.host.specs[0].Width)
	assert.Equal(t, 550, h.host.specs[0].Height)
	assert.Equal(t, &screenPosition{X: 100, Y: 50}, h.host.specs[0].Position)
}

func TestSettingsIgnoresDelayedVisibilityEventsAfterReopen(t *testing.T) {
	h := newTestHarness(t, "", time.Second)
	_, err := h.service.OpenSettings("")
	require.NoError(t, err)
	require.NoError(t, h.service.HideSettings())
	_, err = h.service.OpenSettings("")
	require.NoError(t, err)
	h.service.windowVisibilityChanged(SettingsWindowName, false)
	assert.True(t, h.service.GetSettingsState().Visible)
	require.NoError(t, h.service.HideSettings())
	h.service.windowFocused(SettingsWindowName)
	h.service.windowVisibilityChanged(SettingsWindowName, true)
	assert.False(t, h.service.GetSettingsState().Visible)
}
