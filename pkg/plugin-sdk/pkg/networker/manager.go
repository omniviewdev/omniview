package networker

import (
	"context"
	"errors"
	"fmt"
	"log"
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
		sessions:               make(map[string]sessionStoreEntry),
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
	log.Printf(
		"finding port forward requests for resource %s and connection %s\n",
		req.ResourceID,
		req.ConnectionID,
	)

	m.RLock()
	defer m.RUnlock()

	sessions := make([]*PortForwardSession, 0)
	for _, entry := range m.sessions {
		passesResourceCheck := req.ResourceID == ""
		passesConnectionCheck := req.ConnectionID == ""

		// need to type assert connection since it could be a static session
		if entry.session == nil {
			continue
		}

		resource, ok := entry.session.Connection.(PortForwardResourceConnection)
		if ok {
			passesResourceCheck = resource.ResourceID == req.ResourceID
			passesConnectionCheck = resource.ConnectionID == req.ConnectionID
		}

		if passesResourceCheck && passesConnectionCheck {
			sessions = append(sessions, entry.session)
		}
	}

	log.Printf(
		"found %d port forward requests for resource %s and connection %s\n",
		len(sessions),
		req.ResourceID,
		req.ConnectionID,
	)

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

	log.Printf("looking for resource port forwarder for key: %s\n", resource.ResourceKey)

	handler, ok := m.resourcePortForwarders[resource.ResourceKey]
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

	log.Printf("starting session with opts: %v\n", opts)
	log.Printf("connection type: %s", string(opts.ConnectionType))

	var target targetType
	var resultID string
	var err error

	// handler will rely on context cancellation for cleanup
	cancellable, cancel := context.WithCancel(ctx.Context)
	ctx.Context = cancellable

	// make sure our port is available to listen on, assigning a random one if not specified
	if opts.LocalPort == 0 {
		opts.LocalPort, err = FindFreeTCPPort()
		if err != nil {
			cancel()
			return nil, err
		}
	} else if IsPortUnavailable(opts.LocalPort) {
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
	default:
		cancel()
		return nil, fmt.Errorf("unsupported connection type %s", string(opts.ConnectionType))
	}

	if err != nil {
		cancel()
		return nil, err
	}

	log.Printf("created port forward session")
	log.Printf("connection type for port forward session: %T", opts.Connection)

	newSession := &PortForwardSession{
		CreatedAt:      time.Now(),
		UpdatedAt:      time.Now(),
		Labels:         opts.Labels,
		Connection:     opts.Connection,
		ID:             resultID,
		Protocol:       opts.Protocol,
		State:          SessionStateActive,
		ConnectionType: string(opts.ConnectionType),
		Encryption:     opts.Encryption,
		LocalPort:      opts.LocalPort,
		RemotePort:     opts.RemotePort,
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
