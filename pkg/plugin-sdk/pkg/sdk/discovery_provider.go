package sdk

import (
	"fmt"
	"sync"

	"github.com/omniviewdev/plugin-sdk/pkg/resource/types"
	pkgtypes "github.com/omniviewdev/plugin-sdk/pkg/types"
)

// clientDiscoveryProvider is a generic adapter that wraps client lifecycle functions
// and a syncer function into the non-generic DiscoveryProvider interface.
type clientDiscoveryProvider[DiscoveryClientT any] struct {
	createClient func(*pkgtypes.PluginContext) (*DiscoveryClientT, error)
	stopClient   func(*pkgtypes.PluginContext, *DiscoveryClientT) error
	syncer       func(*pkgtypes.PluginContext, *DiscoveryClientT) ([]types.ResourceMeta, error)
	clients      map[string]*DiscoveryClientT
	mu           sync.Mutex
}

// NewClientDiscoveryProvider creates a DiscoveryProvider from client lifecycle functions and a syncer.
// createClient is required. stopClient is optional (nil = no-op).
func NewClientDiscoveryProvider[DiscoveryClientT any](
	createClient func(*pkgtypes.PluginContext) (*DiscoveryClientT, error),
	stopClient func(*pkgtypes.PluginContext, *DiscoveryClientT) error,
	syncer func(*pkgtypes.PluginContext, *DiscoveryClientT) ([]types.ResourceMeta, error),
) types.DiscoveryProvider {
	return &clientDiscoveryProvider[DiscoveryClientT]{
		createClient: createClient,
		stopClient:   stopClient,
		syncer:       syncer,
		clients:      make(map[string]*DiscoveryClientT),
	}
}

func (p *clientDiscoveryProvider[DiscoveryClientT]) Discover(
	ctx *pkgtypes.PluginContext,
	connection *pkgtypes.Connection,
) ([]types.ResourceMeta, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	// ensure the connection is on the context
	ctx.Connection = connection

	// if a client already exists, stop and remove it
	if oldClient, ok := p.clients[connection.ID]; ok {
		if p.stopClient != nil {
			p.stopClient(ctx, oldClient)
		}
		delete(p.clients, connection.ID)
	}

	client, err := p.createClient(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to create discovery client for connection %s: %w", connection.ID, err)
	}

	p.clients[connection.ID] = client

	return p.syncer(ctx, client)
}

func (p *clientDiscoveryProvider[DiscoveryClientT]) RemoveConnection(
	ctx *pkgtypes.PluginContext,
	connection *pkgtypes.Connection,
) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if client, ok := p.clients[connection.ID]; ok {
		if p.stopClient != nil {
			if err := p.stopClient(ctx, client); err != nil {
				return err
			}
		}
		delete(p.clients, connection.ID)
	}
	return nil
}
