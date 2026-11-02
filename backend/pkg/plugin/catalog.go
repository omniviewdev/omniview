package plugin

import (
	"context"
	"errors"
	"fmt"
	"os"
	"slices"
	"strings"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	sdkstate "github.com/omniviewdev/plugin-sdk/pkg/state"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	"golang.org/x/mod/semver"
)

// CatalogEntry is trusted application composition, never installed metadata.
// NewBackend must return fresh providers and aggregate lifetime on every call.
type CatalogEntry struct {
	Metadata       config.PluginMeta
	FrontendModule string
	NewBackend     func(context.Context) (plugintypes.PluginBackend, error)
}

// Catalog owns immutable snapshots of product descriptors and factories.
type Catalog struct {
	entries map[string]CatalogEntry
}

func NewCatalog(entries []CatalogEntry) (*Catalog, error) {
	catalog := &Catalog{entries: make(map[string]CatalogEntry, len(entries))}
	for _, entry := range entries {
		id := entry.Metadata.ID
		if err := sdkstate.ValidateComponent(id); err != nil {
			return nil, fmt.Errorf("invalid built-in ID %q: %w", id, err)
		}
		if _, exists := catalog.entries[id]; exists {
			return nil, fmt.Errorf("duplicate built-in ID %q", id)
		}
		if !semver.IsValid("v"+entry.Metadata.Version) || strings.HasPrefix(entry.Metadata.Version, "v") {
			return nil, fmt.Errorf("built-in %q requires a semantic version", id)
		}
		if err := entry.Metadata.Validate(); err != nil {
			return nil, fmt.Errorf("invalid built-in %q metadata: %w", id, err)
		}
		seen := make(map[string]bool, len(entry.Metadata.Capabilities))
		for _, capability := range entry.Metadata.Capabilities {
			switch capability {
			case "ui", "resource", "exec", "networker", "settings", "log", "metric", "tools":
			default:
				return nil, fmt.Errorf("built-in %q declares unknown capability %q", id, capability)
			}
			if seen[capability] {
				return nil, fmt.Errorf("built-in %q repeats capability %q", id, capability)
			}
			seen[capability] = true
		}
		if entry.Metadata.HasBackendCapabilities() && entry.NewBackend == nil {
			return nil, fmt.Errorf("built-in %q requires a backend factory", id)
		}
		if entry.Metadata.HasUICapabilities() && strings.TrimSpace(entry.FrontendModule) == "" {
			return nil, fmt.Errorf("built-in %q requires a frontend module", id)
		}
		entry.Metadata = cloneMetadata(entry.Metadata)
		catalog.entries[id] = entry
	}
	return catalog, nil
}

func cloneMetadata(meta config.PluginMeta) config.PluginMeta {
	meta.Maintainers = slices.Clone(meta.Maintainers)
	meta.Tags = slices.Clone(meta.Tags)
	meta.Dependencies = slices.Clone(meta.Dependencies)
	meta.Capabilities = slices.Clone(meta.Capabilities)
	meta.Components.Resource = slices.Clone(meta.Components.Resource)
	for index := range meta.Components.Resource {
		meta.Components.Resource[index].Resources = slices.Clone(meta.Components.Resource[index].Resources)
	}
	if meta.Author != nil {
		author := *meta.Author
		meta.Author = &author
	}
	if meta.StateIsolation != nil {
		isolation := *meta.StateIsolation
		meta.StateIsolation = &isolation
	}
	if meta.Exports != nil {
		exports := *meta.Exports
		if exports.Connections != nil {
			connections := *exports.Connections
			connections.Operations = slices.Clone(connections.Operations)
			connections.ResourceTypes = slices.Clone(connections.ResourceTypes)
			exports.Connections = &connections
		}
		meta.Exports = &exports
	}
	if meta.Requires != nil {
		requires := *meta.Requires
		requires.Connections = slices.Clone(requires.Connections)
		for index := range requires.Connections {
			requires.Connections[index].Operations = slices.Clone(requires.Connections[index].Operations)
			requires.Connections[index].ResourceTypes = slices.Clone(requires.Connections[index].ResourceTypes)
		}
		meta.Requires = &requires
	}
	return meta
}

func (pm *pluginManager) builtin(id string) (CatalogEntry, bool) {
	if pm.catalog == nil {
		return CatalogEntry{}, false
	}
	entry, ok := pm.catalog.entries[id]
	return entry, ok
}

func (pm *pluginManager) guardProductOwned(id string) error {
	if _, ok := pm.builtin(id); ok {
		return fmt.Errorf("plugin %q is built into this product and cannot be installed, replaced, dev-linked, or uninstalled", id)
	}
	return nil
}

func (pm *pluginManager) builtinCollision(id string) error {
	_, err := os.Lstat(pm.pluginsRoot.ResolvePath(id))
	if err == nil {
		return fmt.Errorf("installed plugin %q collides with product-owned built-in; remove or relocate external installation explicitly", id)
	}
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

func (pm *pluginManager) discoverBuiltins(states []plugintypes.PluginStateRecord) error {
	if pm.catalog == nil {
		return nil
	}
	var collisions []error
	for id, entry := range pm.catalog.entries {
		record := plugintypes.NewPluginRecord(id, cloneMetadata(entry.Metadata), lifecycle.PhaseInstalled)
		record.Origin = "builtin"
		record.FrontendModule = entry.FrontendModule
		for _, state := range states {
			if state.ID == id {
				record.Enabled = state.Enabled
				break
			}
		}
		if err := pm.builtinCollision(id); err != nil {
			record.Phase = lifecycle.PhaseFailed
			record.LastError = err.Error()
			record.StateMachine.ForcePhase(record.Phase, record.LastError)
			collisions = append(collisions, err)
		}
		pm.recordsMu.Lock()
		pm.records[id] = record
		pm.recordsMu.Unlock()
	}
	return errors.Join(collisions...)
}

func (pm *pluginManager) loadBuiltinLocked(id string, entry CatalogEntry, opts *LoadPluginOptions) (plugintypes.PluginInfo, error) {
	if opts != nil && (opts.DevMode || (opts.ExistingState != nil && opts.ExistingState.DevMode)) {
		return plugintypes.PluginInfo{}, pm.guardProductOwned(id)
	}
	if err := pm.guardUninstallRecovery(id); err != nil {
		return plugintypes.PluginInfo{}, err
	}
	if err := pm.guardArchiveRecovery(id); err != nil {
		return plugintypes.PluginInfo{}, err
	}
	pm.recordsMu.RLock()
	existing := pm.records[id]
	pm.recordsMu.RUnlock()
	if existing != nil {
		if !existing.Enabled {
			return existing.ToInfo(), fmt.Errorf("built-in plugin %q is disabled", id)
		}
		if existing.Phase == lifecycle.PhaseRunning {
			if opts == nil || !opts.dependencyOwner {
				if ctrl, ok := pm.connfullControllers[sdktypes.CapabilityResource].(interface{ PromoteDependencyStart(string) }); ok {
					ctrl.PromoteDependencyStart(id)
				}
			}
			return existing.ToInfo(), nil
		}
	}
	if err := pm.builtinCollision(id); err != nil {
		return plugintypes.PluginInfo{}, err
	}
	record := newLoadRecord(id, cloneMetadata(entry.Metadata), nil)
	record.Origin = "builtin"
	record.FrontendModule = entry.FrontendModule
	if err := pm.startRequiredOwners(record.Metadata); err != nil {
		return record.ToInfo(), err
	}
	if record.Metadata.HasBackendCapabilities() {
		backend, err := pm.startBackend(id, record, record.Metadata, "", opts != nil && opts.dependencyOwner)
		if err != nil {
			return record.ToInfo(), err
		}
		record.Backend = backend
	} else {
		if err := pm.initPlugin(record); err != nil {
			cleanupErr := pm.shutdownPlugin(id, record)
			err = errors.Join(err, cleanupErr)
			pm.storeFailedRecord(id, record, err)
			return record.ToInfo(), err
		}
		for name, manager := range pm.managers {
			if err := manager.OnPluginStart(context.Background(), id, record.Metadata); err != nil {
				cleanupErr := errors.Join(pm.stopPlugin(record), pm.shutdownPlugin(id, record))
				err = errors.Join(fmt.Errorf("start plugin manager %s: %w", name, err), cleanupErr)
				pm.storeFailedRecord(id, record, err)
				return record.ToInfo(), err
			}
		}
	}
	record.Phase = lifecycle.PhaseRunning
	record.StateMachine.ForcePhase(record.Phase, "built-in activated")
	pm.registerStateObserver(record.StateMachine)
	pm.recordsMu.Lock()
	pm.records[id] = record
	pm.recordsMu.Unlock()
	return record.ToInfo(), nil
}

// SetPluginEnabled persists user preference independently from activation.
// Failed writes are reconciled against the persisted preference before cleanup.
func (pm *pluginManager) SetPluginEnabled(id string, enabled bool) (plugintypes.PluginInfo, error) {
	lock := pm.pluginOpsLock(id)
	lock.Lock()
	defer lock.Unlock()
	if err := pm.guardUninstallRecovery(id); err != nil {
		return plugintypes.PluginInfo{}, err
	}
	if err := pm.guardArchiveRecovery(id); err != nil {
		return plugintypes.PluginInfo{}, err
	}
	pm.recordsMu.RLock()
	record := pm.records[id]
	if record != nil {
		snapshot := *record
		record = &snapshot
	}
	pm.recordsMu.RUnlock()
	if record == nil {
		return plugintypes.PluginInfo{}, fmt.Errorf("plugin %q not found", id)
	}
	stateMu.Lock()
	states := pm.pluginStateSnapshot("")
	previous := slices.Clone(states)
	for index := range states {
		if states[index].ID == id {
			states[index].Enabled = enabled
		}
	}
	persistErr := pm.writePluginStateRecords(states)
	if persistErr != nil {
		// Rename may have succeeded before directory sync failed. Restore the
		// prior preference without changing or stopping the running lifetime.
		persistErr = errors.Join(persistErr, pm.writePluginStateRecords(previous))
	}
	if persistErr != nil {
		persisted, readErr := pm.readPluginStateJSONLocked()
		if readErr != nil {
			stateMu.Unlock()
			return record.ToInfo(), errors.Join(persistErr, fmt.Errorf("cannot determine persisted enablement: %w", readErr))
		}
		found := false
		for _, state := range persisted {
			if state.ID == id {
				enabled, found = state.Enabled, true
				break
			}
		}
		if !found {
			stateMu.Unlock()
			return record.ToInfo(), errors.Join(persistErr, fmt.Errorf("persisted enablement missing for plugin %q", id))
		}
	}
	record.Enabled = enabled
	visible := *record
	pm.recordsMu.Lock()
	pm.records[id] = &visible
	pm.recordsMu.Unlock()
	stateMu.Unlock()
	if !enabled {
		// Fence pending frontend activation before waiting for provider teardown.
		pm.emitter.Emit("plugin/enablement_changed", map[string]interface{}{"pluginID": id, "enabled": false})
	}
	var cleanupErr error
	if !enabled && (record.Phase == lifecycle.PhaseRunning || record.Backend != nil) {
		cleanupErr = errors.Join(pm.stopPlugin(record), pm.shutdownPlugin(id, record))
	}
	if cleanupErr != nil {
		record.Phase = lifecycle.PhaseFailed
		record.LastError = cleanupErr.Error()
	} else if record.Backend == nil && (!enabled || record.Phase != lifecycle.PhaseRunning) {
		record.Phase = lifecycle.PhaseInstalled
		record.LastError = ""
	}
	if _, builtin := pm.builtin(id); builtin {
		if collisionErr := pm.builtinCollision(id); collisionErr != nil {
			record.Phase = lifecycle.PhaseFailed
			record.LastError = collisionErr.Error()
		}
	}
	if record.StateMachine != nil {
		record.StateMachine.ForcePhase(record.Phase, "enablement changed")
	}
	info := record.ToInfo()
	pm.recordsMu.Lock()
	pm.records[id] = record
	pm.recordsMu.Unlock()
	if enabled {
		pm.emitter.Emit("plugin/enablement_changed", map[string]interface{}{"pluginID": id, "enabled": true})
	}
	return info, errors.Join(persistErr, cleanupErr)
}
