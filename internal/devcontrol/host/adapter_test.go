//go:build devcontrol

package host

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/devserver"
	"github.com/omniviewdev/omniview/internal/devcontrol"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
)

type managerFixture struct {
	devcontrol.Plugins
	info           sdktypes.PluginInfo
	reloads, stops int
	stopErr        error
}

func (m *managerFixture) GetPlugin(string) (sdktypes.PluginInfo, error) { return m.info, nil }
func (m *managerFixture) ReloadPlugin(string) (sdktypes.PluginInfo, error) {
	m.reloads++
	m.info.Phase = "Running"
	return m.info, nil
}
func (m *managerFixture) StopDevPlugin(string) error {
	m.stops++
	if m.stopErr != nil {
		return m.stopErr
	}
	m.info.Phase = "Stopped"
	return nil
}

type devFixture struct {
	state              devserver.DevServerState
	entries            []devserver.LogEntry
	waitGeneration     string
	rebuildErr         error
	dependencyWatching bool
	dependencyChanges  int
}

func (d *devFixture) StartDevServer(string) (devserver.DevServerState, error) { return d.state, nil }
func (d *devFixture) GetDevServerState(string) devserver.DevServerState       { return d.state }
func (d *devFixture) GetDevServerLogs(string, int) []devserver.LogEntry       { return d.entries }
func (d *devFixture) RebuildPluginGeneration(_ context.Context, _ string, generation string) error {
	if generation != d.state.Generation {
		return errors.New("stale generation")
	}
	return d.rebuildErr
}
func (d *devFixture) WaitReady(_ context.Context, _ string, generation string) (devserver.DevServerState, error) {
	d.waitGeneration = generation
	if generation != d.state.Generation {
		return d.state, errors.New("stale generation")
	}
	return d.state, nil
}
func (d *devFixture) SetDependencyWatching(id, generation string, enabled bool) error {
	if id != d.state.PluginID || generation != d.state.Generation {
		return errors.New("stale managed generation")
	}
	d.dependencyWatching = enabled
	d.dependencyChanges++
	return nil
}

func TestUIOnlyStoppedRecordIsActivatedDespiteViteReadiness(t *testing.T) {
	manager := &managerFixture{info: sdktypes.PluginInfo{ID: "ui-only", DevMode: true, Phase: "Stopped"}}
	dev := &devFixture{state: devserver.DevServerState{PluginID: "ui-only", Generation: "managed-generation", Ready: true, BuildStatus: devserver.StageNotApplicable, RPCStatus: devserver.StageNotApplicable, ControllerStatus: devserver.StageNotApplicable, ViteStatus: devserver.DevProcessStatusReady}}
	adapter := &lifecycle{manager: manager, dev: dev}
	result, err := adapter.Start(context.Background(), "ui-only")
	if err != nil || !result.Ready || manager.info.Phase != "Running" || manager.reloads != 1 || dev.waitGeneration != "managed-generation" {
		t.Fatalf("activation result=%+v manager=%+v err=%v", result, manager, err)
	}
}
func TestCanonicalStopRetainsBindingAndPropagatesFailure(t *testing.T) {
	manager := &managerFixture{info: sdktypes.PluginInfo{ID: "fixture", DevMode: true, DevPath: "/owned/source", Phase: "Running"}, stopErr: errors.New("stop failure")}
	adapter := &lifecycle{manager: manager, dev: &devFixture{}}
	if err := adapter.Stop(context.Background(), "fixture"); err == nil {
		t.Fatal("stop failure hidden")
	}
	if manager.info.Phase != "Running" {
		t.Fatal("failed stop claimed stopped")
	}
	manager.stopErr = nil
	if err := adapter.Stop(context.Background(), "fixture"); err != nil {
		t.Fatal(err)
	}
	if manager.info.Phase != "Stopped" || manager.info.DevPath != "/owned/source" {
		t.Fatal("stopped binding was lost")
	}
}
func TestLogsRequireExplicitUnsafeOutputAndRemainBounded(t *testing.T) {
	manager := &managerFixture{info: sdktypes.PluginInfo{ID: "fixture", DevMode: true}}
	entries := []devserver.LogEntry{{Timestamp: "actual-time", Source: "go-build", Level: "error", Message: "compiler failure: private-value"}, {Timestamp: "second-time", Source: "vite", Level: "info", Message: strings.Repeat("x", 3000)}}
	adapter := &lifecycle{manager: manager, dev: &devFixture{entries: entries}}
	safe, err := adapter.Logs("fixture", 0, 1, false)
	if err != nil || len(safe.Entries) != 1 || safe.NextCursor != 1 || !safe.Truncated || safe.Entries[0].Timestamp != "actual-time" || strings.Contains(safe.Entries[0].Message, "private-value") {
		t.Fatalf("safe page=%+v err=%v", safe, err)
	}
	unsafe, err := adapter.Logs("fixture", 0, 2, true)
	if err != nil || unsafe.Entries[0].Message != entries[0].Message || len(unsafe.Entries[1].Message) != 2048 || !unsafe.Truncated {
		t.Fatalf("explicit output=%+v err=%v", unsafe, err)
	}
	if _, err := adapter.Logs("fixture", 0, 501, true); err == nil {
		t.Fatal("unbounded log limit accepted")
	}
}

func TestDependencyControlInvokesGenerationTargetedProducerHook(t *testing.T) {
	manager := &managerFixture{info: sdktypes.PluginInfo{ID: "fixture", DevMode: true}}
	dev := &devFixture{state: devserver.DevServerState{PluginID: "fixture", Generation: "current-plugin"}, dependencyWatching: true}
	adapter := &lifecycle{manager: manager, dev: dev}
	if err := adapter.SetDependencyWatching(context.Background(), "fixture", "stale-plugin", false); err == nil {
		t.Fatal("stale dependency watch toggle accepted")
	}
	if !dev.dependencyWatching || dev.dependencyChanges != 0 {
		t.Fatal("stale generation changed producer watch state")
	}
	if err := adapter.SetDependencyWatching(context.Background(), "fixture", "current-plugin", false); err != nil {
		t.Fatal(err)
	}
	if dev.dependencyWatching || dev.dependencyChanges != 1 {
		t.Fatal("producer dependency watcher was not actually toggled")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := adapter.SetDependencyWatching(ctx, "fixture", "current-plugin", true); err == nil {
		t.Fatal("cancelled toggle accepted")
	}
	if dev.dependencyWatching || dev.dependencyChanges != 1 {
		t.Fatal("cancelled toggle reached producer")
	}
}
