package metric

import (
	"fmt"
	"sync"
	"time"

	"github.com/omniview/kubernetes/pkg/utils/kubeauth"
	"github.com/omniviewdev/plugin-sdk/pkg/types"

	"github.com/omniview/kubernetes/pkg/utils"
)

const (
	// DefaultClientTTL is how long a cached kube client stays alive after last use.
	DefaultClientTTL = 10 * time.Minute
	// DefaultReapInterval is how often the background reaper checks for stale entries.
	DefaultReapInterval = 1 * time.Minute
)

// clientEntry holds a cached kube client bundle with access tracking.
type clientEntry struct {
	clients    *kubeauth.KubeClientBundle
	lastAccess time.Time
}

// ClientFactory builds kube clients from a connection. Factored out for testability.
type ClientFactory func(conn *types.Connection) (*kubeauth.KubeClientBundle, error)

// DefaultClientFactory uses the standard KubeClientsFromContext path.
func DefaultClientFactory(conn *types.Connection) (*kubeauth.KubeClientBundle, error) {
	if conn == nil {
		return nil, fmt.Errorf("connection is nil")
	}

	ctx := &types.PluginContext{
		Connection: conn,
	}

	return utils.KubeClientsFromContext(ctx)
}

// ClientCache provides per-connection kube client caching with TTL-based eviction.
type ClientCache struct {
	mu      sync.RWMutex
	entries map[string]*clientEntry
	ttl     time.Duration
	factory ClientFactory
	stopCh  chan struct{}
	nowFunc func() time.Time // for testing
}

// ClientCacheOpts configures a ClientCache.
type ClientCacheOpts struct {
	TTL     time.Duration
	Factory ClientFactory
	NowFunc func() time.Time // nil = time.Now
}

// NewClientCache creates a client cache and starts the background reaper.
func NewClientCache(opts ClientCacheOpts) *ClientCache {
	ttl := opts.TTL
	if ttl == 0 {
		ttl = DefaultClientTTL
	}
	factory := opts.Factory
	if factory == nil {
		factory = DefaultClientFactory
	}
	nowFunc := opts.NowFunc
	if nowFunc == nil {
		nowFunc = time.Now
	}

	c := &ClientCache{
		entries: make(map[string]*clientEntry),
		ttl:     ttl,
		factory: factory,
		stopCh:  make(chan struct{}),
		nowFunc: nowFunc,
	}

	go c.reapLoop()
	return c
}

// Get returns cached kube clients for the connection, creating them if absent.
// Each successful Get refreshes the TTL.
func (c *ClientCache) Get(connectionID string, conn *types.Connection) (*kubeauth.KubeClientBundle, error) {
	c.mu.RLock()
	entry, ok := c.entries[connectionID]
	c.mu.RUnlock()

	if ok {
		c.mu.Lock()
		entry.lastAccess = c.nowFunc()
		c.mu.Unlock()
		return entry.clients, nil
	}

	// Cache miss — build new clients.
	clients, err := c.factory(conn)
	if err != nil {
		return nil, err
	}

	c.mu.Lock()
	// Double-check after acquiring write lock.
	if existing, ok := c.entries[connectionID]; ok {
		existing.lastAccess = c.nowFunc()
		c.mu.Unlock()
		return existing.clients, nil
	}
	c.entries[connectionID] = &clientEntry{
		clients:    clients,
		lastAccess: c.nowFunc(),
	}
	c.mu.Unlock()

	return clients, nil
}

// Evict removes a specific connection from the cache.
func (c *ClientCache) Evict(connectionID string) {
	c.mu.Lock()
	delete(c.entries, connectionID)
	c.mu.Unlock()
}

// Len returns the number of cached entries.
func (c *ClientCache) Len() int {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return len(c.entries)
}

// Stop shuts down the background reaper and clears the cache.
func (c *ClientCache) Stop() {
	close(c.stopCh)
	c.mu.Lock()
	c.entries = make(map[string]*clientEntry)
	c.mu.Unlock()
}

// reapLoop periodically removes entries that haven't been accessed within the TTL.
func (c *ClientCache) reapLoop() {
	ticker := time.NewTicker(DefaultReapInterval)
	defer ticker.Stop()

	for {
		select {
		case <-c.stopCh:
			return
		case <-ticker.C:
			c.reap()
		}
	}
}

// reap removes stale entries.
func (c *ClientCache) reap() {
	now := c.nowFunc()
	c.mu.Lock()
	defer c.mu.Unlock()

	for id, entry := range c.entries {
		if now.Sub(entry.lastAccess) > c.ttl {
			delete(c.entries, id)
		}
	}
}
