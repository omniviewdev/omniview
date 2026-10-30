package resource

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"sort"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/utils"
	"github.com/omniviewdev/omniview/internal/appstate"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

const connectionProfileStoreName = "connection-profiles-v1"
const maxConnectionProfiles = 4096
const maxConnectionProfileStoreBytes = 32 << 20

// ConnectionProfile separates source facts, explicit desired state, and passive
// legacy review candidates. Active means effective source inventory membership,
// not connected/readiness. Disabled native configurations never mutate source files.
type ConnectionProfile struct {
	ID         string            `json:"id"`
	Source     string            `json:"source"`
	Connection *types.Connection `json:"connection,omitempty"`
	Active     bool              `json:"active"`
}

type ConnectionProfileResult struct {
	Applied bool              `json:"applied"`
	Profile ConnectionProfile `json:"profile"`
}

// The disk DTO deliberately excludes clients, auth freshness and sensitive data.
// Only explicit user configuration is durable; native discovery is never saved.
type profileConfiguration struct {
	ID          string                    `json:"id"`
	UID         string                    `json:"uid"`
	Name        string                    `json:"name"`
	Description string                    `json:"description"`
	Avatar      string                    `json:"avatar"`
	Data        map[string]any            `json:"data"`
	Labels      map[string]any            `json:"labels"`
	Lifecycle   types.ConnectionLifecycle `json:"lifecycle"`
}
type desiredConnectionProfile struct {
	Source        string               `json:"source"`
	Configuration profileConfiguration `json:"configuration"`
}
type desiredConnectionState struct {
	Version     uint32                     `json:"version"`
	Profiles    []desiredConnectionProfile `json:"profiles"`
	DisabledIDs []string                   `json:"disabledIDs"`
}

type connectionProfileSource interface {
	resourcev2.ConnectionOverlayProvider
	ListConnections(context.Context) ([]types.Connection, error)
}

func profileConfig(connection types.Connection) profileConfiguration {
	return profileConfiguration{ID: connection.ID, UID: connection.UID, Name: connection.Name, Description: connection.Description, Avatar: connection.Avatar, Data: connection.Data, Labels: connection.Labels, Lifecycle: connection.Lifecycle}
}
func (config profileConfiguration) connection() types.Connection {
	return types.Connection{ID: config.ID, UID: config.UID, Name: config.Name, Description: config.Description, Avatar: config.Avatar, Data: config.Data, Labels: config.Labels, Lifecycle: config.Lifecycle}
}
func emptyDesiredConnections() desiredConnectionState {
	return desiredConnectionState{Version: 1, Profiles: []desiredConnectionProfile{}, DisabledIDs: []string{}}
}
func (state desiredConnectionState) overlay() resourcev2.ConnectionOverlay {
	overlay := resourcev2.ConnectionOverlay{Upserts: make([]types.Connection, 0, len(state.Profiles)), DisabledIDs: state.DisabledIDs}
	for _, profile := range state.Profiles {
		overlay.Upserts = append(overlay.Upserts, profile.Configuration.connection())
	}
	return overlay
}

func validateDesiredConnections(state desiredConnectionState) error {
	if state.Version != 1 {
		return errors.New("connection profiles: unsupported store version")
	}
	if len(state.Profiles)+len(state.DisabledIDs) > maxConnectionProfiles {
		return errors.New("connection profiles: entry limit exceeded")
	}
	for _, profile := range state.Profiles {
		if profile.Source != "manual" && profile.Source != "override" {
			return errors.New("connection profiles: invalid profile origin")
		}
		if profile.Configuration.ID == "" || !utf8.ValidString(profile.Configuration.ID) {
			return errors.New("connection profiles: invalid profile ID")
		}
	}
	return resourcev2.ValidateConnectionOverlay(state.overlay())
}

func readDesiredConnections(root *appstate.ScopedRoot) (desiredConnectionState, error) {
	file, err := root.OpenFile(connectionProfileStoreName, os.O_RDONLY, 0)
	if os.IsNotExist(err) {
		return emptyDesiredConnections(), nil
	}
	if err != nil {
		return desiredConnectionState{}, err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxConnectionProfileStoreBytes+1))
	if err != nil {
		return desiredConnectionState{}, err
	}
	if len(data) > maxConnectionProfileStoreBytes {
		return desiredConnectionState{}, errors.New("connection profiles: store byte limit exceeded")
	}
	if err := resourcev2.ValidateJSON(data); err != nil {
		return desiredConnectionState{}, err
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	decoder.UseNumber()
	var state desiredConnectionState
	if err := decoder.Decode(&state); err != nil {
		return desiredConnectionState{}, err
	}
	if err := validateDesiredConnections(state); err != nil {
		return desiredConnectionState{}, err
	}
	return state, nil
}

func encodeDesiredConnections(state desiredConnectionState) ([]byte, error) {
	if err := validateDesiredConnections(state); err != nil {
		return nil, err
	}
	data, err := json.Marshal(state)
	if err != nil {
		return nil, err
	}
	if len(data) > maxConnectionProfileStoreBytes {
		return nil, errors.New("connection profiles: store byte limit exceeded")
	}
	if err := resourcev2.ValidateJSON(data); err != nil {
		return nil, err
	}
	return data, nil
}

func writeDesiredConnections(root *appstate.ScopedRoot, data []byte) error {
	if err := utils.InitializePluginStore(root); err != nil {
		return err
	}
	temp := connectionProfileStoreName + "." + uuid.NewString() + ".tmp"
	file, err := root.OpenFile(temp, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer root.Remove(temp)
	if _, err := file.Write(data); err != nil {
		file.Close()
		return err
	}
	if err := file.Sync(); err != nil {
		file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	return root.Rename(temp, connectionProfileStoreName)
}

func (c *controller) connectionProfileSource(ctx context.Context, pluginID string) (connectionProfileSource, error) {
	provider, err := c.getProvider(pluginID)
	if err != nil {
		return nil, err
	}
	features, err := c.providerFeatures(ctx, pluginID, provider)
	if err != nil {
		return nil, err
	}
	if !features.Has(resourcev2.FeatureConnectionOverlay) {
		return nil, resourcev2.NewError("UNSUPPORTED", "Explicit connection profiles are not supported by this provider.")
	}
	source, ok := provider.(connectionProfileSource)
	if !ok {
		return nil, resourcev2.NewError("UNSUPPORTED", "Explicit connection profiles are not supported by this provider.")
	}
	return source, nil
}

// replayConnectionProfiles is called after native discovery and before host
// auto-connect. NativeConnections is authoritative; the supplied Load result may
// already contain the SDK overlay and must never be persisted as desired state.
func (c *controller) replayConnectionProfiles(ctx context.Context, pluginID string, loaded []types.Connection) ([]types.Connection, error) {
	c.profilesMu.Lock()
	defer c.profilesMu.Unlock()
	return c.replayConnectionProfilesLocked(ctx, pluginID, loaded)
}

// Caller holds profilesMu across native discovery and overlay replay.
func (c *controller) replayConnectionProfilesLocked(ctx context.Context, pluginID string, loaded []types.Connection) ([]types.Connection, error) {
	_, generation, ctx, cleanup, err := c.operationGeneration(ctx, pluginID, resourcev2.AccessRoute{})
	if err != nil {
		return nil, err
	}
	defer cleanup()
	root, err := c.pluginStoreFn(pluginID)
	if err != nil {
		return nil, err
	}
	state, err := readDesiredConnections(root)
	if err != nil {
		return nil, err
	}
	source, err := c.connectionProfileSource(ctx, pluginID)
	if err != nil {
		if resourcev2.ErrorCode(err) == "UNSUPPORTED" && len(state.Profiles) == 0 && len(state.DisabledIDs) == 0 {
			return loaded, nil
		}
		return nil, err
	}
	native, err := source.NativeConnections(ctx)
	if err != nil {
		return nil, err
	}
	current, err := source.ListConnections(ctx)
	if err != nil {
		return nil, err
	}
	routes, retire := profileConnectionChanges(current, native, state)
	release, err := c.beginConfigurationChanges(ctx, pluginID, generation, routes, retire)
	if err != nil {
		return nil, err
	}
	if release != nil {
		defer release()
	}
	if err := source.ApplyConnectionOverlay(ctx, state.overlay()); err != nil {
		return nil, err
	}
	return c.refreshProfileConnections(ctx, pluginID, source, generation)
}

func (c *controller) refreshProfileConnections(ctx context.Context, pluginID string, source connectionProfileSource, generation *pluginState) ([]types.Connection, error) {
	native, err := source.NativeConnections(ctx)
	if err != nil {
		return nil, err
	}
	effective, err := source.ListConnections(ctx)
	if err != nil {
		return nil, err
	}
	if err := c.publishProfileConnections(ctx, pluginID, generation, native, effective); err != nil {
		return nil, err
	}
	return effective, nil
}

// legacyConnectionCandidates reads the existing mixed cache only for explicit
// review/import. Fresh matching native discoveries always suppress cached facts.
// The old cache remains byte-for-byte untouched; it is never replayed as desired.
func legacyConnectionCandidates(root *appstate.ScopedRoot, pluginID string) ([]types.Connection, error) {
	info, err := root.Stat(storeName)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if info.Size() > maxConnectionProfileStoreBytes {
		return nil, errors.New("connection profiles: legacy review cache exceeds byte limit")
	}
	state, err := loadFromLocalStore(root)
	if err != nil {
		return nil, err
	}
	return state[pluginID], nil
}

func listConnectionProfiles(state desiredConnectionState, native, effective, candidates []types.Connection) []ConnectionProfile {
	profiles := make(map[string]ConnectionProfile)
	active := make(map[string]types.Connection, len(effective))
	for _, connection := range effective {
		active[connection.ID] = connection
	}
	for _, connection := range candidates {
		copy := profileConfig(connection).connection()
		profiles[connection.ID] = ConnectionProfile{ID: connection.ID, Source: "review", Connection: &copy}
	}
	for _, connection := range native {
		copy := connection
		_, exists := active[connection.ID]
		profiles[connection.ID] = ConnectionProfile{ID: connection.ID, Source: "native", Connection: &copy, Active: exists}
	}
	for _, desired := range state.Profiles {
		connection := desired.Configuration.connection()
		_, exists := active[connection.ID]
		if current, ok := active[connection.ID]; ok {
			connection = current
		}
		profiles[connection.ID] = ConnectionProfile{ID: connection.ID, Source: desired.Source, Connection: &connection, Active: exists}
	}
	for _, id := range state.DisabledIDs {
		profile := profiles[id]
		profile.ID = id
		profile.Source = "disabled"
		profile.Active = false
		profiles[id] = profile
	}
	result := make([]ConnectionProfile, 0, len(profiles))
	for _, profile := range profiles {
		result = append(result, profile)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].ID < result[j].ID })
	return result
}

func (c *controller) ListConnectionProfiles(ctx context.Context, pluginID string) (_result []ConnectionProfile, retErr error) {
	ctx, err := c.admit(ctx, "resource.ListConnectionProfiles", invocation.Target{Provider: pluginID})
	if err != nil {
		return nil, err
	}
	defer finishResource(ctx, &retErr)
	c.profilesMu.Lock()
	defer c.profilesMu.Unlock()
	// Listing review data must work even when initial source discovery fails.
	// It must not publish a source snapshot as effective configuration.
	root, err := c.pluginStoreFn(pluginID)
	if err != nil {
		return nil, err
	}
	state, err := readDesiredConnections(root)
	if err != nil {
		return nil, err
	}
	var native []types.Connection
	if source, sourceErr := c.connectionProfileSource(ctx, pluginID); sourceErr == nil {
		native, _ = source.NativeConnections(ctx)
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	c.connsMu.RLock()
	effective := append([]types.Connection(nil), c.connections[pluginID]...)
	c.connsMu.RUnlock()
	candidates, err := legacyConnectionCandidates(root, pluginID)
	if err != nil {
		return nil, err
	}
	return listConnectionProfiles(state, native, effective, candidates), nil
}

// applyDesiredConnections reports success only after both source application and
// durable host save. A failed second phase reapplies the previous desired state.
// Rollback failure is explicit unknown source state, never endpoint success.
func applyDesiredConnections(ctx context.Context, source connectionProfileSource, root *appstate.ScopedRoot, previous, next desiredConnectionState) ([]types.Connection, error) {
	data, err := encodeDesiredConnections(next)
	if err != nil {
		return nil, err
	}
	if err := source.ApplyConnectionOverlay(ctx, next.overlay()); err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return nil, err
		}
		return nil, resourcev2.NewError("CONFLICT", "Connection profile was not applied; the source rejected the configuration.")
	}
	effective, err := source.ListConnections(ctx)
	if err == nil {
		err = writeDesiredConnections(root, data)
	}
	if err == nil {
		return effective, nil
	}
	// An owning cancellation must not prevent compensating an already-applied
	// source change. The source still owns its normal per-call operation limits.
	if rollback := source.ApplyConnectionOverlay(context.WithoutCancel(ctx), previous.overlay()); rollback != nil {
		return nil, resourcev2.NewError("RESET_REQUIRED", "Connection profile was not applied durably and source rollback failed; actual source state is unknown. Reload before using this connection.")
	}
	return nil, resourcev2.NewError("CONFLICT", "Connection profile was not applied; the previous source configuration was restored after a host commit failure.")
}

func withoutDesiredConnection(state desiredConnectionState, id string) desiredConnectionState {
	result := emptyDesiredConnections()
	for _, profile := range state.Profiles {
		if profile.Configuration.ID != id {
			result.Profiles = append(result.Profiles, profile)
		}
	}
	for _, disabled := range state.DisabledIDs {
		if disabled != id {
			result.DisabledIDs = append(result.DisabledIDs, disabled)
		}
	}
	return result
}

func (c *controller) changeConnectionProfile(ctx context.Context, pluginID, id, operation string, connection *types.Connection) (_result ConnectionProfileResult, retErr error) {
	defer c.notifyInventory()
	if id == "" || !utf8.ValidString(id) {
		return ConnectionProfileResult{}, resourcev2.NewError("INVALID_REQUEST", "An explicit UTF-8 connection ID is required.")
	}
	c.profilesMu.Lock()
	defer c.profilesMu.Unlock()
	_, generation, ctx, cleanup, err := c.operationGeneration(ctx, pluginID, resourcev2.AccessRoute{Connection: id})
	if err != nil {
		return ConnectionProfileResult{}, err
	}
	defer cleanup()
	source, err := c.connectionProfileSource(ctx, pluginID)
	if err != nil {
		return ConnectionProfileResult{}, err
	}
	root, err := c.pluginStoreFn(pluginID)
	if err != nil {
		return ConnectionProfileResult{}, err
	}
	previous, err := readDesiredConnections(root)
	if err != nil {
		return ConnectionProfileResult{}, err
	}
	native, err := source.NativeConnections(ctx)
	if err != nil {
		return ConnectionProfileResult{}, err
	}
	next := withoutDesiredConnection(previous, id)
	origin := "manual"
	known := false
	for _, item := range native {
		if item.ID == id {
			origin = "override"
			known = true
			break
		}
	}
	for _, profile := range previous.Profiles {
		if profile.Configuration.ID == id {
			origin = profile.Source
			known = true
			break
		}
	}
	for _, disabled := range previous.DisabledIDs {
		if disabled == id {
			origin = "override"
			known = true
			break
		}
	}
	if operation == "import" {
		for _, profile := range previous.Profiles {
			if profile.Configuration.ID == id {
				return ConnectionProfileResult{}, resourcev2.NewError("INVALID_REQUEST", "This connection already has explicit desired configuration.")
			}
		}
		for _, disabled := range previous.DisabledIDs {
			if disabled == id {
				return ConnectionProfileResult{}, resourcev2.NewError("INVALID_REQUEST", "Restore this disabled connection instead of importing cached configuration.")
			}
		}
		candidates, err := legacyConnectionCandidates(root, pluginID)
		if err != nil {
			return ConnectionProfileResult{}, err
		}
		for _, candidate := range candidates {
			if candidate.ID == id {
				copy := candidate
				connection = &copy
				break
			}
		}
		if connection == nil {
			return ConnectionProfileResult{}, resourcev2.NewError("NOT_FOUND", "No inactive connection review candidate has this ID.")
		}
		for _, current := range native {
			if current.ID == id {
				return ConnectionProfileResult{}, resourcev2.NewError("INVALID_REQUEST", "Fresh native discovery already owns this connection ID; review the native configuration instead.")
			}
		}
	}
	switch operation {
	case "save", "import":
		if connection == nil {
			return ConnectionProfileResult{}, resourcev2.NewError("INVALID_REQUEST", "Connection configuration is required.")
		}
		next.Profiles = append(next.Profiles, desiredConnectionProfile{Source: origin, Configuration: profileConfig(*connection)})
	case "remove":
		if origin == "override" {
			next.DisabledIDs = append(next.DisabledIDs, id)
		} else {
			found := false
			for _, profile := range previous.Profiles {
				if profile.Configuration.ID == id {
					found = true
					break
				}
			}
			if !found {
				return ConnectionProfileResult{}, resourcev2.NewError("NOT_FOUND", "No native or owned connection profile has this ID.")
			}
		}
	case "reset":
		if !known {
			return ConnectionProfileResult{}, resourcev2.NewError("NOT_FOUND", "No native or desired connection profile has this ID.")
		}
	default:
		return ConnectionProfileResult{}, resourcev2.NewError("INVALID_REQUEST", "Unknown connection profile operation.")
	}
	current, err := source.ListConnections(ctx)
	if err != nil {
		return ConnectionProfileResult{}, err
	}
	routes, retire := profileConnectionChanges(current, native, next)
	release, err := c.beginConfigurationChanges(ctx, pluginID, generation, routes, retire)
	if err != nil {
		return ConnectionProfileResult{}, err
	}
	if release != nil {
		defer release()
	}
	effective, err := applyDesiredConnections(ctx, source, root, previous, next)
	if err != nil {
		return ConnectionProfileResult{}, err
	}
	if err := c.publishProfileConnections(ctx, pluginID, generation, native, effective); err != nil {
		return ConnectionProfileResult{}, err
	}
	result := ConnectionProfile{ID: id, Source: "absent", Active: false}
	for _, profile := range listConnectionProfiles(next, native, effective, nil) {
		if profile.ID == id {
			result = profile
			break
		}
	}
	return ConnectionProfileResult{Applied: true, Profile: result}, nil
}

func (c *controller) SaveConnectionProfile(ctx context.Context, pluginID string, connection types.Connection) (_result ConnectionProfileResult, retErr error) {
	ctx, err := c.admit(ctx, "resource.SaveConnectionProfile", invocation.Target{Provider: pluginID, Connection: connection.ID})
	if err != nil {
		return _result, err
	}
	defer finishResource(ctx, &retErr)
	return c.changeConnectionProfile(ctx, pluginID, connection.ID, "save", &connection)
}
func (c *controller) ImportConnectionProfile(ctx context.Context, pluginID, connectionID string) (_result ConnectionProfileResult, retErr error) {
	ctx, err := c.admit(ctx, "resource.ImportConnectionProfile", invocation.Target{Provider: pluginID, Connection: connectionID})
	if err != nil {
		return _result, err
	}
	defer finishResource(ctx, &retErr)
	return c.changeConnectionProfile(ctx, pluginID, connectionID, "import", nil)
}
func (c *controller) ResetConnectionProfile(ctx context.Context, pluginID, connectionID string) (_result ConnectionProfileResult, retErr error) {
	ctx, err := c.admit(ctx, "resource.ResetConnectionProfile", invocation.Target{Provider: pluginID, Connection: connectionID})
	if err != nil {
		return _result, err
	}
	defer finishResource(ctx, &retErr)
	return c.changeConnectionProfile(ctx, pluginID, connectionID, "reset", nil)
}
func (c *controller) RemoveConnection(ctx context.Context, pluginID, connectionID string) (retErr error) {
	ctx, err := c.admit(ctx, "resource.RemoveConnection", invocation.Target{Provider: pluginID, Connection: connectionID})
	if err != nil {
		return err
	}
	defer finishResource(ctx, &retErr)
	_, err = c.changeConnectionProfile(ctx, pluginID, connectionID, "remove", nil)
	return err
}
