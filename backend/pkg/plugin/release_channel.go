package plugin

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/registry"
	"github.com/omniviewdev/omniview/internal/releasechannel"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	regclient "github.com/omniviewdev/registry"
)

type PluginReleaseState struct {
	EffectiveChannel string                    `json:"effectiveChannel"`
	Explicit         bool                      `json:"explicit"`
	Channels         []regclient.PluginChannel `json:"channels"`
}

func (pm *pluginManager) effectiveReleaseChannel(id string) string {
	pm.recordsMu.RLock()
	record := pm.records[id]
	channel := ""
	if record != nil {
		channel = record.ReleaseChannel
	}
	pm.recordsMu.RUnlock()
	if channel != "" {
		return channel
	}
	if pm.registryClient != nil && releasechannel.IsFeature(pm.registryClient.HostReleaseChannel()) {
		return pm.registryClient.HostReleaseChannel()
	}
	return releasechannel.Stable
}

func (pm *pluginManager) GetPluginReleaseState(pluginID string) (PluginReleaseState, error) {
	pm.syncRegistryURL()
	channels, err := pm.registryClient.ListChannels(context.Background(), pluginID)
	if err != nil {
		return PluginReleaseState{}, err
	}
	pm.recordsMu.RLock()
	record := pm.records[pluginID]
	explicit := record != nil && record.ReleaseChannel != ""
	pm.recordsMu.RUnlock()
	return PluginReleaseState{EffectiveChannel: pm.effectiveReleaseChannel(pluginID), Explicit: explicit, Channels: channels}, nil
}

func (pm *pluginManager) GetPluginChannelVersions(pluginID, channel string) ([]registry.VersionInfo, error) {
	if channel != releasechannel.Stable && !releasechannel.IsFeature(channel) {
		return nil, errors.New("invalid channel")
	}
	pm.syncRegistryURL()
	return pm.registryClient.GetPluginVersions(context.Background(), pluginID, channel)
}

func (pm *pluginManager) InstallPluginChannelVersion(pluginID, channel, version string) (*config.PluginMeta, error) {
	valid := releasechannel.IsFeature(channel) && releasechannel.ValidVersion(channel, version)
	if channel == releasechannel.Stable {
		_, prerelease, hasPrerelease := strings.Cut(version, "-")
		valid = !hasPrerelease || !strings.HasPrefix(prerelease, "feature-")
	}
	if !valid {
		return nil, errors.New("invalid channel or version")
	}
	installMu := pm.installOpsLock(pluginID)
	installMu.Lock()
	defer installMu.Unlock()
	return pm.installPluginVersionLocked(pluginID, version, channel)
}

func (pm *pluginManager) syncHostChannelPlugins(ctx context.Context) {
	if pm.registryClient == nil {
		return
	}
	host := pm.registryClient.HostReleaseChannel()
	if !releasechannel.IsFeature(host) {
		return
	}
	path := pm.stateRoot.ResolvePath("plugin-channel-sync.json")
	var marker struct {
		HostChannel string `json:"hostChannel"`
	}
	if data, err := os.ReadFile(path); err == nil && json.Unmarshal(data, &marker) == nil && marker.HostChannel == host {
		return
	}
	type candidate struct{ id, version string }
	pm.recordsMu.RLock()
	var candidates []candidate
	for id, record := range pm.records {
		if record != nil && record.Origin != "builtin" && !record.DevMode && record.ReleaseChannel == "" {
			candidates = append(candidates, candidate{id, record.Metadata.Version})
		}
	}
	pm.recordsMu.RUnlock()
	pm.syncRegistryURL()
	failed := false
	for _, plugin := range candidates {
		if ctx.Err() != nil {
			return
		}
		channels, err := pm.registryClient.ListChannels(ctx, plugin.id)
		if err == nil {
			found := false
			for _, channel := range channels {
				if channel.Channel == host && channel.Status == "active" {
					found = true
					break
				}
			}
			if !found {
				continue
			}
			var versions []registry.VersionInfo
			versions, err = pm.registryClient.GetPluginVersions(ctx, plugin.id, host)
			if err == nil {
				for _, version := range versions {
					if version.Channel == host && version.Compatible {
						if version.Version != plugin.version {
							installMu := pm.installOpsLock(plugin.id)
							installMu.Lock()
							pm.recordsMu.RLock()
							current := pm.records[plugin.id]
							eligible := current != nil && current.Origin != "builtin" && !current.DevMode &&
								current.ReleaseChannel == "" && current.Metadata.Version == plugin.version
							pm.recordsMu.RUnlock()
							if eligible {
								_, err = pm.installPluginVersionLocked(plugin.id, version.Version, "")
							}
							installMu.Unlock()
						}
						break
					}
				}
			}
		}
		if err != nil {
			failed = true
			pm.logger.Warnw(ctx, "failed to sync plugin release channel", "pluginID", plugin.id, "error", err)
		}
	}
	if failed || ctx.Err() != nil {
		return
	}
	marker.HostChannel = host
	data, err := json.Marshal(marker)
	if err == nil {
		tmp := filepath.Join(filepath.Dir(path), ".plugin-channel-sync.json.tmp")
		err = os.WriteFile(tmp, data, 0o600)
		if err == nil {
			err = os.Rename(tmp, path)
		}
		if err != nil {
			_ = os.Remove(tmp)
		}
	}
	if err != nil {
		pm.logger.Warnw(ctx, "failed to save plugin channel sync", "error", err)
	}
}
