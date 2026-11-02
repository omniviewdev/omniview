package plugin

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"sync"
	"time"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/connshare"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/tools"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	v2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	sdklifecycle "github.com/omniviewdev/plugin-sdk/pkg/v1/lifecycle"
	sdktools "github.com/omniviewdev/plugin-sdk/pkg/v1/tools"
)

type sharingProcess struct {
	service *connshare.Service
	stop    func()
}
type sharingState struct {
	mu        sync.Mutex
	processes map[string]*sharingProcess
	resources resource.Controller
	boundary  *invocation.Boundary
}

type sharingTools interface {
	SetDelegator(func(context.Context, string, sdktools.Descriptor, string) ([]byte, func(), error))
	InvocationBoundary() *invocation.Boundary
}

func (pm *pluginManager) configureConnectionSharing(resources resource.Controller, controller tools.Controller) {
	setter, ok := controller.(sharingTools)
	if !ok || resources == nil {
		return
	}
	pm.sharing = &sharingState{resources: resources, boundary: setter.InvocationBoundary(), processes: make(map[string]*sharingProcess)}
	setter.SetDelegator(pm.beginDelegation)
	if source, ok := resources.(interface{ AddConnectionChangeHook(func(string, string)) }); ok {
		source.AddConnectionChangeHook(pm.retireConnectionRoute)
	}
}

func ownerUnavailable() error {
	return v2.NewError("OWNER_UNAVAILABLE", "The connection owner is unavailable.")
}
func grantDenied() error {
	return v2.NewError("GRANT_DENIED", "Cross-plugin connection access is not permitted.")
}
func connectionNotStarted() error {
	return v2.NewError("CONNECTION_NOT_STARTED", "The owner connection is not started.")
}

// validateDependencies detects cycles before starting any owner. It never starts a connection.
func (pm *pluginManager) validateDependencies(root config.PluginMeta) error {
	visiting := map[string]bool{}
	done := map[string]bool{}
	var visit func(config.PluginMeta) error
	visit = func(meta config.PluginMeta) error {
		if visiting[meta.ID] {
			return grantDenied()
		}
		if done[meta.ID] {
			return nil
		}
		if err := meta.Validate(); err != nil {
			return grantDenied()
		}
		visiting[meta.ID] = true
		if meta.Requires != nil {
			for _, requirement := range meta.Requires.Connections {
				owner, err := types.LoadPluginMetadata(pm.pluginsRoot.ResolvePath(requirement.Plugin))
				if err != nil || owner.ID != requirement.Plugin || !slices.Contains(owner.Capabilities, "resource") {
					return ownerUnavailable()
				}
				if _, err := config.GrantConnections(meta, owner); err != nil {
					return grantDenied()
				}
				if err := visit(owner); err != nil {
					return err
				}
			}
		}
		delete(visiting, meta.ID)
		done[meta.ID] = true
		return nil
	}
	return visit(root)
}

func (pm *pluginManager) startRequiredOwners(meta config.PluginMeta) error {
	if meta.Requires == nil || len(meta.Requires.Connections) == 0 {
		return nil
	}
	if pm.sharing == nil {
		return ownerUnavailable()
	}
	if err := pm.validateDependencies(meta); err != nil {
		return err
	}
	states, err := pm.readPluginStateJSON()
	if err != nil {
		return ownerUnavailable()
	}
	for _, req := range meta.Requires.Connections {
		opts := &LoadPluginOptions{dependencyOwner: true}
		for i := range states {
			if states[i].ID == req.Plugin {
				opts.ExistingState = &states[i]
				break
			}
		}
		if _, err := pm.LoadPlugin(req.Plugin, opts); err != nil {
			return ownerUnavailable()
		}
		pm.recordsMu.RLock()
		owner := pm.records[req.Plugin]
		ready := owner != nil && owner.Phase == lifecycle.PhaseRunning && slices.Contains(owner.Capabilities, types.CapabilityResource)
		var grantErr error
		if ready {
			_, grantErr = config.GrantConnections(meta, owner.Metadata)
		}
		pm.recordsMu.RUnlock()
		if !ready {
			return ownerUnavailable()
		}
		if grantErr != nil {
			return grantDenied()
		}
	}
	return nil
}

func (pm *pluginManager) bindConnectionSharing(meta config.PluginMeta, backend plugintypes.PluginBackend) error {
	if meta.Requires == nil || len(meta.Requires.Connections) == 0 {
		return nil
	}
	if pm.sharing == nil {
		return ownerUnavailable()
	}
	resources, ok := pm.sharing.resources.(connshare.Resources)
	if !ok {
		return ownerUnavailable()
	}
	raw, err := backend.Dispense("lifecycle")
	if err != nil {
		return ownerUnavailable()
	}
	client, ok := raw.(*sdklifecycle.Client)
	if !ok {
		return ownerUnavailable()
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	info, err := client.GetInfo(ctx)
	if err != nil || info.GetPluginId() != meta.ID || info.GetHostConnectionsVersion() != 1 {
		return ownerUnavailable()
	}
	service := connshare.New(meta.ID, resources, pm.sharing.boundary)
	stop, err := client.ServeHostConnections(ctx, service)
	if err != nil {
		service.Close()
		return err
	}
	pm.sharing.mu.Lock()
	old := pm.sharing.processes[meta.ID]
	pm.sharing.processes[meta.ID] = &sharingProcess{service: service, stop: stop}
	pm.sharing.mu.Unlock()
	if old != nil {
		old.service.Close()
		old.stop()
	}
	return nil
}

func (pm *pluginManager) retireConnectionSharing(id string) {
	if pm.sharing == nil {
		return
	}
	pm.sharing.mu.Lock()
	own := pm.sharing.processes[id]
	delete(pm.sharing.processes, id)
	others := make([]*sharingProcess, 0, len(pm.sharing.processes))
	for _, process := range pm.sharing.processes {
		others = append(others, process)
	}
	pm.sharing.mu.Unlock()
	if own != nil {
		own.service.Close()
		own.stop()
	}
	for _, process := range others {
		process.service.RetireOwner(id)
	}
}

func (pm *pluginManager) retireConnectionRoute(owner, connection string) {
	if pm.sharing == nil {
		return
	}
	pm.sharing.mu.Lock()
	processes := make([]*sharingProcess, 0, len(pm.sharing.processes))
	for _, process := range pm.sharing.processes {
		processes = append(processes, process)
	}
	pm.sharing.mu.Unlock()
	for _, process := range processes {
		process.service.RetireConnection(owner, connection)
	}
}

func (pm *pluginManager) ownerStates(ctx context.Context, owner string) ([]resource.BorrowableConnection, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	reader, ok := pm.sharing.resources.(interface {
		BorrowableConnections(string) []resource.BorrowableConnection
	})
	if !ok {
		return nil, ownerUnavailable()
	}
	return reader.BorrowableConnections(owner), nil
}

func (pm *pluginManager) beginDelegation(ctx context.Context, consumer string, desc sdktools.Descriptor, connection string) ([]byte, func(), error) {
	if pm.sharing == nil {
		return nil, nil, ownerUnavailable()
	}
	pm.sharing.mu.Lock()
	process := pm.sharing.processes[consumer]
	pm.sharing.mu.Unlock()
	if process == nil {
		return nil, nil, ownerUnavailable()
	}
	pm.recordsMu.RLock()
	source := pm.records[consumer]
	owner := pm.records[desc.ConnectionOwner]
	if source == nil || owner == nil || source.Phase != lifecycle.PhaseRunning || owner.Phase != lifecycle.PhaseRunning {
		pm.recordsMu.RUnlock()
		return nil, nil, ownerUnavailable()
	}
	consumerMeta, ownerMeta := source.Metadata, owner.Metadata
	consumerDeclaration, consumerErr := json.Marshal(consumerMeta.Requires)
	ownerDeclaration, ownerErr := json.Marshal(ownerMeta.Exports)
	pm.recordsMu.RUnlock()
	if consumerErr != nil || ownerErr != nil {
		return nil, nil, grantDenied()
	}
	grant, err := config.GrantConnections(consumerMeta, ownerMeta)
	if err != nil {
		return nil, nil, grantDenied()
	}
	validate := func() error {
		pm.sharing.mu.Lock()
		current := pm.sharing.processes[consumer] == process
		pm.sharing.mu.Unlock()
		pm.recordsMu.RLock()
		current = current && pm.records[consumer] == source && pm.records[desc.ConnectionOwner] == owner && source.Phase == lifecycle.PhaseRunning && owner.Phase == lifecycle.PhaseRunning
		currentConsumer, consumerErr := json.Marshal(source.Metadata.Requires)
		currentOwner, ownerErr := json.Marshal(owner.Metadata.Exports)
		pm.recordsMu.RUnlock()
		current = current && consumerErr == nil && ownerErr == nil && bytes.Equal(currentConsumer, consumerDeclaration) && bytes.Equal(currentOwner, ownerDeclaration)
		if !current {
			return ownerUnavailable()
		}
		states, err := pm.ownerStates(ctx, desc.ConnectionOwner)
		if err != nil {
			return ownerUnavailable()
		}
		for _, state := range states {
			if state.ID == connection {
				if state.Started {
					return nil
				}
				return connectionNotStarted()
			}
		}
		return connectionNotStarted()
	}
	return process.service.Begin(ctx, desc.ConnectionOwner, v2.AccessRoute{Connection: connection}, grant, desc.Annotations.Resolve().ReadOnly, validate)
}

// BorrowedConnections is a sanitized, grant-aware owner inventory for relay presentation.
func (pm *pluginManager) BorrowedConnections(ctx context.Context, consumer, owner string, startedOnly bool) ([]types.Connection, error) {
	if pm.sharing == nil {
		return nil, ownerUnavailable()
	}
	pm.recordsMu.RLock()
	source, provider := pm.records[consumer], pm.records[owner]
	if source == nil || provider == nil || source.Phase != lifecycle.PhaseRunning || provider.Phase != lifecycle.PhaseRunning {
		pm.recordsMu.RUnlock()
		return nil, ownerUnavailable()
	}
	_, err := config.GrantConnections(source.Metadata, provider.Metadata)
	consumerDecl, consumerErr := json.Marshal(source.Metadata.Requires)
	ownerDecl, ownerErr := json.Marshal(provider.Metadata.Exports)
	pm.recordsMu.RUnlock()
	if consumerErr != nil || ownerErr != nil {
		return nil, grantDenied()
	}
	if err != nil {
		return nil, grantDenied()
	}
	states, err := pm.ownerStates(ctx, owner)
	if err != nil {
		return nil, fmt.Errorf("owner inventory unavailable: %w", err)
	}
	pm.recordsMu.RLock()
	current := pm.records[consumer] == source && pm.records[owner] == provider && source.Phase == lifecycle.PhaseRunning && provider.Phase == lifecycle.PhaseRunning
	currentConsumer, consumerErr := json.Marshal(source.Metadata.Requires)
	currentOwner, ownerErr := json.Marshal(provider.Metadata.Exports)
	pm.recordsMu.RUnlock()
	if !current || consumerErr != nil || ownerErr != nil || !bytes.Equal(consumerDecl, currentConsumer) || !bytes.Equal(ownerDecl, currentOwner) {
		return nil, ownerUnavailable()
	}
	out := make([]types.Connection, 0, len(states))
	for _, state := range states {
		if !startedOnly || state.Started {
			out = append(out, types.Connection{ID: state.ID, Name: state.Name})
		}
	}
	return out, nil
}
