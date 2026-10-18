//go:build devcontrol

// Package host bridges native host services to the native-free control protocol.
package host

import (
	"context"
	"fmt"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/devserver"
	pluginsettings "github.com/omniviewdev/omniview/backend/pkg/plugin/settings"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devcontrol"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
)

type Manager interface {
	devcontrol.Plugins
	ReloadPlugin(string) (sdktypes.PluginInfo, error)
	StopDevPlugin(string) error
}
type DevServers interface {
	StartDevServer(string) (devserver.DevServerState, error)
	GetDevServerState(string) devserver.DevServerState
	GetDevServerLogs(string, int) []devserver.LogEntry
	RebuildPluginGeneration(context.Context, string, string) error
	SetDependencyWatching(string, string, bool) error
	WaitReady(context.Context, string, string) (devserver.DevServerState, error)
}

func New(manager Manager, dev DevServers, provider pkgsettings.Provider, controller pluginsettings.Controller, inspect func(context.Context) (devcontract.InstanceDescriptor, error)) devcontrol.Adapters {
	return devcontrol.Adapters{Inspect: inspect, Plugins: manager, Dev: &lifecycle{manager: manager, dev: dev}, Settings: devcontrol.NewSettingsAdapter(provider, settingsBridge{controller})}
}

type settingsBridge struct{ controller pluginsettings.Controller }

func (s settingsBridge) SafeSettings(id string) map[string]pkgsettings.Setting {
	return pluginsettings.RedactedPluginSettings(s.controller, id)
}
func (s settingsBridge) SettingForWrite(plugin, id string) (pkgsettings.Setting, error) {
	return s.controller.GetSetting(plugin, id)
}
func (s settingsBridge) SetSetting(plugin, id string, value any) error {
	return s.controller.SetSetting(plugin, id, value)
}
func (s settingsBridge) SetSettings(plugin string, values map[string]any) error {
	return s.controller.SetSettings(plugin, values)
}

type lifecycle struct {
	manager Manager
	dev     DevServers
}

func state(s devserver.DevServerState) devcontrol.DevState {
	result := devcontrol.DevState{PluginState: devcontract.PluginState{ID: s.PluginID, Source: s.DevPath, Generation: s.Generation, Mode: string(s.Mode), BuildStatus: string(s.BuildStatus), ViteStatus: string(s.ViteStatus), RPCStatus: string(s.RPCStatus), ControllerStatus: string(s.ControllerStatus)}, Ready: s.Ready, ViteURL: s.ViteURL, HMRURL: s.HMRURL}
	if s.LastError != "" {
		result.LastError = devcontract.Fail(5, "dependency_failed", "plugin build or readiness failed")
	}
	return result
}
func (l *lifecycle) Status(id string) (devcontrol.DevState, error) {
	plugin, err := l.manager.GetPlugin(id)
	if err != nil {
		return devcontrol.DevState{}, err
	}
	if !plugin.DevMode {
		return devcontrol.DevState{}, devcontract.Fail(4, "conflict", "plugin is not linked in development mode")
	}
	s := state(l.dev.GetDevServerState(id))
	s.Version = plugin.Metadata.Version
	s.Source = plugin.DevPath
	return s, nil
}
func (l *lifecycle) Start(ctx context.Context, id string) (devcontrol.DevState, error) {
	if err := ctx.Err(); err != nil {
		return devcontrol.DevState{}, err
	}
	info, err := l.manager.GetPlugin(id)
	if err != nil {
		return devcontrol.DevState{}, err
	}
	if !info.DevMode {
		return devcontrol.DevState{}, devcontract.Fail(4, "conflict", "plugin is not linked in development mode")
	}
	s, err := l.dev.StartDevServer(id)
	if err != nil {
		return state(s), err
	}
	current, err := l.manager.GetPlugin(id)
	if err != nil {
		return state(s), err
	}
	if !s.Ready || current.Phase != "Running" {
		_, err = l.manager.ReloadPlugin(id)
		if err != nil {
			return state(l.dev.GetDevServerState(id)), err
		}
	}
	return l.WaitReady(ctx, id, s.Generation)
}
func (l *lifecycle) Stop(ctx context.Context, id string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if _, err := l.Status(id); err != nil {
		return err
	}
	// The canonical manager stops processes/controllers and retains inventory.
	return l.manager.StopDevPlugin(id)
}
func (l *lifecycle) Restart(ctx context.Context, id string) (devcontrol.DevState, error) {
	if err := l.Stop(ctx, id); err != nil {
		return devcontrol.DevState{}, err
	}
	return l.Start(ctx, id)
}
func (l *lifecycle) Rebuild(ctx context.Context, id, generation string) (devcontrol.DevState, error) {
	if err := l.dev.RebuildPluginGeneration(ctx, id, generation); err != nil {
		return devcontrol.DevState{}, err
	}
	return l.WaitReady(ctx, id, generation)
}
func (l *lifecycle) WaitReady(ctx context.Context, id, generation string) (devcontrol.DevState, error) {
	s, err := l.dev.WaitReady(ctx, id, generation)
	return state(s), err
}
func (l *lifecycle) SetDependencyWatching(ctx context.Context, id, generation string, enabled bool) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	current, err := l.Status(id)
	if err != nil {
		return err
	}
	if generation == "" || current.Generation != generation {
		return devcontract.Fail(4, "stale_target", "managed plugin generation does not match")
	}
	return l.dev.SetDependencyWatching(id, generation, enabled)
}
func (l *lifecycle) Logs(id string, cursor, limit int, includeOutput bool) (devcontrol.LogPage, error) {
	if _, err := l.Status(id); err != nil {
		return devcontrol.LogPage{}, err
	}
	if cursor < 0 || limit < 1 || limit > 500 {
		return devcontrol.LogPage{}, fmt.Errorf("invalid bounded log request")
	}
	// Snapshot offsets intentionally do not pretend to be stable streaming IDs:
	// the producer owns a bounded ring and does not publish sequence numbers.
	entries := l.dev.GetDevServerLogs(id, devserver.DefaultLogBufferSize)
	if cursor > len(entries) {
		cursor = len(entries)
	}
	end := cursor + limit
	if end > len(entries) {
		end = len(entries)
	}
	result := devcontrol.LogPage{Entries: make([]devcontrol.LogEntry, 0, end-cursor), NextCursor: end, Truncated: end < len(entries)}
	for _, entry := range entries[cursor:end] {
		message := "[REDACTED: unstructured plugin output]"
		if includeOutput {
			message = entry.Message
			if len(message) > 2048 {
				message = message[:2048]
				result.Truncated = true
			}
		}
		result.Entries = append(result.Entries, devcontrol.LogEntry{Timestamp: entry.Timestamp, Source: entry.Source, Level: entry.Level, Message: message})
	}
	return result, nil
}
