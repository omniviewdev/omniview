//go:build ui_next

package settings

import (
	"context"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/require"

	coresettings "github.com/omniviewdev/omniview/internal/settings"
	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
)

// A getter that began before a commit cannot publish the old native material under
// the new revision. A reader that arrives mid-apply can cancel while native UI is busy.
func TestAppearanceReadsAcrossNativePublication(t *testing.T) {
	s, err := Initialize(Options{Store: openStore(t), Categories: []pkgsettings.Category{coresettings.Appearance}})
	require.NoError(t, err)
	var applied atomic.Value
	var first atomic.Bool
	reading, finishRead := make(chan struct{}), make(chan struct{})
	applying, finishApply := make(chan struct{}), make(chan struct{})
	s.SetupAppearance(func(request AppearanceRequest) {
		if request.WindowMaterial == "translucent" {
			close(applying)
			<-finishApply
		}
		applied.Store(request.WindowMaterial)
	}, func(context.Context) AppearanceMaterial {
		material, _ := applied.Load().(string)
		if first.CompareAndSwap(false, true) {
			close(reading)
			<-finishRead
		}
		return AppearanceMaterial{Effective: material, Glass: true, Translucent: true}
	}, func(uint64) {})
	s.SetApplyHandler(func(_ string, values map[string]any) error { s.ApplyAppearance(values); return nil })
	type answer struct {
		snapshot AppearanceSnapshot
		err      error
	}
	read := make(chan answer, 1)
	go func() {
		snapshot, readErr := s.getAppearance(context.Background())
		read <- answer{snapshot, readErr}
	}()
	<-reading
	_, err = s.Commit(hostScope(), map[string]any{"appearance.windowMaterial": "glass"})
	close(finishRead)
	require.NoError(t, err)
	got := <-read
	require.NoError(t, got.err)
	require.Equal(t, "glass", got.snapshot.Preferences.WindowMaterial)
	require.Equal(t, "glass", got.snapshot.Material.Effective)

	committed := make(chan error, 1)
	go func() {
		_, commitErr := s.Commit(hostScope(), map[string]any{"appearance.windowMaterial": "translucent"})
		committed <- commitErr
	}()
	<-applying
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, readErr := s.getAppearance(ctx)
	close(finishApply)
	require.ErrorIs(t, readErr, context.Canceled)
	require.NoError(t, <-committed)
	updated, err := s.getAppearance(context.Background())
	require.NoError(t, err)
	require.Equal(t, "translucent", updated.Preferences.WindowMaterial)
	require.Equal(t, "translucent", updated.Material.Effective)
	require.Greater(t, updated.Revision, got.snapshot.Revision)
}
