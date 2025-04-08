package networker

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/hashicorp/go-hclog"
	"github.com/omniviewdev/settings"

	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

type targetType int

const (
	targetTypeResource targetType = iota
	targetTypeStatic
)

type sessionStoreEntry struct {
	session    *PortForwardSession
	cancel     func()
	targetType targetType
}

// Manager manages the lifecycle of networker actions, such as port forwarding
// sessions.
type Manager struct {
	log                    hclog.Logger
	settingsProvider       settings.Provider
	resourcePortForwarders map[string]ResourcePortForwarder
	staticPortForwarders   map[string]StaticPortForwarder
	sessions               map[string]sessionStoreEntry
	sync.RWMutex
}

func NewManager(
	settingsProvider settings.Provider,
	opts PluginOpts,
) *Manager {
	m := &Manager{
		log:                    hclog.Default().With("service", "NetworkerManager"),
		settingsProvider:       settingsProvider,
		resourcePortForwarders: make(map[string]ResourcePortForwarder),
		staticPortForwarders:   make(map[string]StaticPortForwarder),
	}

	if opts.ResourcePortForwarders != nil {
		m.resourcePortForwarders = opts.ResourcePortForwarders
	}
	if opts.StaticPortForwarders != nil {
		m.staticPortForwarders = opts.StaticPortForwarders
	}

	return m
}

var _ Provider = (*Manager)(nil)

func (m *Manager) GetSupportedPortForwardTargets(_ *types.PluginContext) []string {
	resources := make([]string, 0, len(m.resourcePortForwarders))
	for rt := range m.resourcePortForwarders {
		resources = append(resources, rt)
	}

	return resources
}

func (m *Manager) GetPortForwardSession(
	_ *types.PluginContext,
	sessionID string,
) (*PortForwardSession, error) {
	m.RLock()
	defer m.RUnlock()

	session, ok := m.sessions[sessionID]
	if !ok {
		return nil, errors.New("session not found")
	}

	return session.session, nil
}

func (m *Manager) ListPortForwardSessions(_ *types.PluginContext) ([]*PortForwardSession, error) {
	m.RLock()
	defer m.RUnlock()

	sessions := make([]*PortForwardSession, 0, len(m.sessions))
	for _, entry := range m.sessions {
		sessions = append(sessions, entry.session)
	}
	return sessions, nil
}

func (m *Manager) FindPortForwardSessions(
	_ *types.PluginContext,
	req FindPortForwardSessionRequest,
) ([]*PortForwardSession, error) {
	m.RLock()
	defer m.RUnlock()

	sessions := make([]*PortForwardSession, 0)
	for connID, entry := range m.sessions {
		passesResourceCheck := req.ResourceID == ""
		passesConnectionCheck := req.ConnectionID == "" || req.ConnectionID == connID

		// need to type assert connection since it could be a static session
		if entry.session == nil {
			continue
		}

		resource, ok := entry.session.Connection.(PortForwardResourceConnection)
		if ok {
			passesResourceCheck = resource.ResourceID == req.ResourceID
		}

		if passesResourceCheck && passesConnectionCheck {
			sessions = append(sessions, entry.session)
		}
	}

	return sessions, nil
}

func (m *Manager) handleResourcePortForward(
	ctx *types.PluginContext,
	opts PortForwardSessionOptions,
) (string, error) {
	resource, ok := opts.Connection.(PortForwardResourceConnection)
	if !ok {
		return "", errors.New("connection is not a resource port forward connection")
	}

	specificOpts := ResourcePortForwardHandlerOpts{
		Options:  opts,
		Resource: resource,
	}

	handler, ok := m.resourcePortForwarders[resource.PluginID+"/"+resource.ResourceKey]
	if !ok {
		return "", errors.New("no handler found for resource port forward")
	}

	return handler(ctx, specificOpts)
}

func (m *Manager) handleStaticPortForward(
	_ *types.PluginContext,
	_ PortForwardSessionOptions,
) (string, error) {
	// TODO: implement static port forwarding once we determine best approach and use cases.
	return "", errors.New("static port forwarding is not yet supported")
}

func (m *Manager) StartPortForwardSession(
	ctx *types.PluginContext,
	opts PortForwardSessionOptions,
) (*PortForwardSession, error) {
	m.Lock()
	defer m.Unlock()

	var target targetType
	var resultID string
	var err error

	// handler will rely on context cancellation for cleanup
	cancellable, cancel := context.WithCancel(ctx.Context)
	ctx.Context = cancellable

	// make sure our port is available to listen on, assigning a random one if not specified
	if opts.SourcePort == 0 {
		opts.SourcePort, err = FindFreeTCPPort()
		if err != nil {
			cancel()
			return nil, err
		}
	} else if IsPortUnavailable(opts.SourcePort) {
		cancel()
		return nil, errors.New("source port is unavailable to listen on")
	}

	switch opts.ConnectionType {
	case PortForwardConnectionTypeResource:
		target = targetTypeResource
		resultID, err = m.handleResourcePortForward(ctx, opts)
	case PortForwardConnectionTypeStatic:
		target = targetTypeStatic
		resultID, err = m.handleStaticPortForward(ctx, opts)
	}

	if err != nil {
		cancel()
		return nil, err
	}

	newSession := &PortForwardSession{
		CreatedAt:       time.Now(),
		UpdatedAt:       time.Now(),
		Labels:          opts.Labels,
		Connection:      opts.Connection,
		ID:              resultID,
		Protocol:        opts.Protocol,
		State:           SessionStateActive,
		ConnectionType:  string(opts.ConnectionType),
		Encryption:      opts.Encryption,
		SourcePort:      opts.SourcePort,
		DestinationPort: opts.DestinationPort,
	}

	m.sessions[resultID] = sessionStoreEntry{
		targetType: target,
		session:    newSession,
		cancel:     cancel,
	}

	return newSession, nil
}

func (m *Manager) ClosePortForwardSession(
	_ *types.PluginContext,
	sessionID string,
) (*PortForwardSession, error) {
	m.Lock()
	defer m.Unlock()

	entry, ok := m.sessions[sessionID]
	if !ok {
		return nil, errors.New("session not found")
	}

	entry.cancel()
	delete(m.sessions, sessionID)
	return entry.session, nil
}
