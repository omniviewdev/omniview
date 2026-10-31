package resource

import (
	"context"
	"strconv"
	"time"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/wailsapp/wails/v3/pkg/application"
)

const EventConnectionMetadata = "resource/connection/metadata"

// HostConnectionMetadata adds transport identity without changing SDK-owned facts.
// A provider-wide event omits ConnectionID and Snapshot.
type HostConnectionMetadata struct {
	PluginID           string                                 `json:"pluginID"`
	RegistrationID     string                                 `json:"registrationID"`
	Supported          bool                                   `json:"supported"`
	TransportAvailable bool                                   `json:"transportAvailable"`
	ConnectionID       string                                 `json:"connectionID,omitempty"`
	Revision           string                                 `json:"revision,omitempty"`
	Snapshot           *resourcev2.ConnectionMetadataSnapshot `json:"snapshot,omitempty"`
	Removed            bool                                   `json:"removed,omitempty"`
}

func init() {
	application.RegisterEvent[HostConnectionMetadata](EventConnectionMetadata)
}

func metadataEnvelope(pluginID string, state *pluginState) HostConnectionMetadata {
	return HostConnectionMetadata{PluginID: pluginID, RegistrationID: state.generationID,
		Supported: state.features.Has(resourcev2.FeatureConnectionMetadata), TransportAvailable: state.metadataAvailable}
}

// Emission stays inside pluginsMu so retirement cannot overtake an admitted event.
func (c *controller) emitMetadata(event HostConnectionMetadata) {
	if c.emitter != nil {
		c.emitter.Emit(EventConnectionMetadata, event)
	}
}

func (c *controller) retireMetadata(pluginID string, state *pluginState) {
	c.retireMetadataAt(pluginID, state, nil)
}

func (c *controller) retireMetadataAt(pluginID string, state *pluginState, epoch *uint64) {
	c.pluginsMu.Lock()
	defer c.pluginsMu.Unlock()
	if c.plugins[pluginID] != state {
		return
	}
	if epoch != nil && state.metadataEpoch != *epoch {
		return
	}
	state.metadataEpoch++
	state.metadataAvailable = false
	for id, value := range state.metadata {
		value.TransportAvailable = false
		state.metadata[id] = value
	}
	c.emitMetadata(metadataEnvelope(pluginID, state))
}

func (c *controller) startMetadata(pluginID string, state *pluginState, provider ResourceProvider) {
	c.pluginsMu.Lock()
	if c.plugins[pluginID] != state || state.ctx.Err() != nil {
		c.pluginsMu.Unlock()
		return
	}
	supported := state.features.Has(resourcev2.FeatureConnectionMetadata)
	c.pluginsMu.Unlock()
	if !supported {
		return
	}
	metadata, ok := provider.(resourcev2.ConnectionMetadataProvider)
	if !ok {
		c.retireMetadata(pluginID, state)
		return
	}
	go func() {
		for {
			c.pluginsMu.RLock()
			epoch := state.metadataEpoch
			c.pluginsMu.RUnlock()
			_ = metadata.WatchConnectionMetadata(invocation.HostContext(state.ctx), func(event resourcev2.ConnectionMetadataEvent) error {
				_, err := c.admitMetadata(pluginID, state, event, true, epoch)
				return err
			})
			c.retireMetadataAt(pluginID, state, &epoch)
			timer := time.NewTimer(time.Second)
			select {
			case <-state.ctx.Done():
				timer.Stop()
				return
			case <-timer.C:
			}
		}
	}()
}

func cloneMetadata(value HostConnectionMetadata) HostConnectionMetadata {
	if value.Snapshot != nil {
		snapshot := resourcev2.CloneConnectionMetadataSnapshot(*value.Snapshot)
		value.Snapshot = &snapshot
	}
	return value
}

func (c *controller) acceptMetadata(pluginID string, state *pluginState, event resourcev2.ConnectionMetadataEvent) (HostConnectionMetadata, error) {
	c.pluginsMu.RLock()
	epoch := state.metadataEpoch
	c.pluginsMu.RUnlock()
	return c.admitMetadata(pluginID, state, event, false, epoch)
}

func (c *controller) admitMetadata(pluginID string, state *pluginState, event resourcev2.ConnectionMetadataEvent, stream bool, epoch uint64) (HostConnectionMetadata, error) {
	snapshot := event.Snapshot
	revision, err := strconv.ParseUint(snapshot.Revision, 10, 64)
	if err != nil || snapshot.ConnectionID == "" {
		return HostConnectionMetadata{}, resourcev2.NewError("INVALID_RESPONSE", "Connection metadata identity is invalid.")
	}
	if err := resourcev2.ValidateConnectionMetadataSnapshot(snapshot); err != nil {
		return HostConnectionMetadata{}, err
	}
	c.pluginsMu.Lock()
	defer c.pluginsMu.Unlock()
	if c.plugins[pluginID] != state || state.ctx.Err() != nil || state.provider == nil || state.metadataEpoch != epoch {
		return HostConnectionMetadata{}, context.Canceled
	}
	if stream {
		state.metadataAvailable = true
	}
	if old, ok := state.metadata[snapshot.ConnectionID]; ok {
		previous, _ := strconv.ParseUint(old.Revision, 10, 64)
		if revision <= previous {
			resynchronized := !old.TransportAvailable
			old.TransportAvailable = true
			if resynchronized {
				state.metadata[snapshot.ConnectionID] = old
				published := cloneMetadata(old)
				c.emitMetadata(published)
			}
			if stream {
				return HostConnectionMetadata{}, nil
			}
			return cloneMetadata(old), nil
		}
	}
	value := metadataEnvelope(pluginID, state)
	value.ConnectionID, value.Revision, value.Removed = snapshot.ConnectionID, snapshot.Revision, event.Removed
	value.TransportAvailable = true
	if !event.Removed {
		value.Snapshot = &snapshot
	}
	owned := cloneMetadata(value)
	if state.metadata == nil {
		state.metadata = make(map[string]HostConnectionMetadata)
	}
	state.metadata[snapshot.ConnectionID] = owned
	// Event subscribers and native callers must never own the mirror's maps.
	published := cloneMetadata(owned)
	c.emitMetadata(published)
	if stream {
		return HostConnectionMetadata{}, nil
	}
	return cloneMetadata(owned), nil
}

func (c *controller) GetConnectionMetadata(ctx context.Context, pluginID, connectionID string) (result HostConnectionMetadata, retErr error) {
	return c.connectionMetadata(ctx, pluginID, connectionID, false)
}

func (c *controller) RefreshConnectionMetadata(ctx context.Context, pluginID, connectionID string) (result HostConnectionMetadata, retErr error) {
	return c.connectionMetadata(ctx, pluginID, connectionID, true)
}

func (c *controller) connectionMetadata(ctx context.Context, pluginID, connectionID string, refresh bool) (result HostConnectionMetadata, retErr error) {
	operation := "resource.GetConnectionMetadata"
	if refresh {
		operation = "resource.RefreshConnectionMetadata"
	}
	ctx, err := c.admit(ctx, operation, invocation.Target{Provider: pluginID, Connection: connectionID})
	if err != nil {
		return result, err
	}
	defer finishResource(ctx, &retErr)
	c.pluginsMu.RLock()
	state := c.plugins[pluginID]
	if state == nil || state.provider == nil || state.ctx.Err() != nil {
		c.pluginsMu.RUnlock()
		return HostConnectionMetadata{}, apperror.PluginNotFound(pluginID)
	}
	result = metadataEnvelope(pluginID, state)
	result.ConnectionID = connectionID
	provider := state.provider
	epoch := state.metadataEpoch
	c.pluginsMu.RUnlock()
	if !result.Supported {
		found := false
		for _, connection := range c.getConnections(pluginID) {
			if connection.ID == connectionID {
				found = true
				break
			}
		}
		if !found {
			return result, apperror.ConnectionNotFound(pluginID, connectionID)
		}
		return result, nil
	}
	metadata, ok := provider.(resourcev2.ConnectionMetadataProvider)
	if !ok {
		return result, resourcev2.NewError("INVALID_RESPONSE", "Provider advertised an unavailable metadata trait.")
	}
	ctx, cancel := context.WithCancel(ctx)
	stop := context.AfterFunc(state.ctx, cancel)
	defer func() { stop(); cancel() }()
	var snapshot resourcev2.ConnectionMetadataSnapshot
	if refresh {
		snapshot, err = metadata.RefreshConnectionMetadata(ctx, connectionID)
	} else {
		snapshot, err = metadata.GetConnectionMetadata(ctx, connectionID)
	}
	if err != nil {
		return result, err
	}
	if snapshot.ConnectionID != connectionID {
		return result, resourcev2.NewError("INVALID_RESPONSE", "Connection metadata identity does not match the request.")
	}
	return c.admitMetadata(pluginID, state, resourcev2.ConnectionMetadataEvent{Snapshot: snapshot}, false, epoch)
}
