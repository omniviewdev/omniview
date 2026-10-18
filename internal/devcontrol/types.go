// Package devcontrol defines the native-independent development control client
// and typed adapter contract. The listener and dispatcher require devcontrol.
package devcontrol

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
)

var ErrDisabled = errors.New("development control is not compiled into this binary")

// Plugins is the canonical noninteractive manager subset. No dialog APIs.
type Plugins interface {
	ListPlugins() []sdktypes.PluginInfo
	GetPlugin(string) (sdktypes.PluginInfo, error)
	InstallPluginFromPath(string) (*config.PluginMeta, error)
	InstallPluginVersion(string, string) (*config.PluginMeta, error)
	UninstallPlugin(string) (sdktypes.PluginInfo, error)
	InstallDevPluginFromPath(string) (sdktypes.PluginInfo, error)
	UnlinkDevPlugin(string) (sdktypes.PluginInfo, error)
}

type DevState struct {
	devcontract.PluginState
	Ready   bool   `json:"ready"`
	ViteURL string `json:"viteURL,omitempty"`
	HMRURL  string `json:"hmrURL,omitempty"`
}
type LogEntry struct {
	Timestamp string `json:"timestamp"`
	Source    string `json:"source"`
	Level     string `json:"level"`
	Message   string `json:"message"`
}
type LogPage struct {
	Entries    []LogEntry `json:"entries"`
	NextCursor int        `json:"nextCursor"`
	Truncated  bool       `json:"truncated"`
}

// Dev owns actual lifecycle transitions; a successful Start/Rebuild waits for
// the generation's capability-aware readiness, not merely a spawned process.
type Dev interface {
	Start(context.Context, string) (DevState, error)
	Stop(context.Context, string) error
	Restart(context.Context, string) (DevState, error)
	Rebuild(context.Context, string, string) (DevState, error)
	SetDependencyWatching(context.Context, string, string, bool) error
	Status(string) (DevState, error)
	Logs(string, int, int, bool) (LogPage, error)
	WaitReady(context.Context, string, string) (DevState, error)
}
type Settings interface {
	Schema(SettingsParams) (map[string]pkgsettings.Setting, error)
	Get(SettingsParams) (any, error)
	Set(SettingsParams) error
	Bulk(SettingsParams) error
}
type Adapters struct {
	Inspect  func(context.Context) (devcontract.InstanceDescriptor, error)
	Plugins  Plugins
	Dev      Dev
	Settings Settings
}
type Config struct {
	Descriptor devcontract.InstanceDescriptor
	Discovery  *devsession.DiscoveryStore
	Adapters   Adapters
}

type EmptyParams struct{}
type PluginParams struct {
	ID string `json:"id"`
}
type PathParams struct {
	Path string `json:"path"`
}
type VersionParams struct {
	ID      string `json:"id"`
	Version string `json:"version"`
}
type RebuildParams struct {
	ID         string `json:"id"`
	Generation string `json:"generation"`
}
type DependenciesParams struct {
	ID         string `json:"id"`
	Generation string `json:"generation"`
	Enabled    bool   `json:"enabled"`
}
type LogsParams struct {
	ID            string `json:"id"`
	Cursor        int    `json:"cursor"`
	Limit         int    `json:"limit"`
	IncludeOutput bool   `json:"includeOutput,omitempty"`
}
type SettingsParams struct {
	Scope    string                     `json:"scope"`
	PluginID string                     `json:"pluginID,omitempty"`
	ID       string                     `json:"id,omitempty"`
	Value    json.RawMessage            `json:"value,omitempty"`
	Values   map[string]json.RawMessage `json:"values,omitempty"`
}
type OperationParams struct {
	OperationID string `json:"operationID"`
	TimeoutMS   int    `json:"timeoutMS,omitempty"`
}
