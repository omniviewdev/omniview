package resource

import (
	"context"
	"sync"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

type catalogSnapshotKey struct{}

type catalogSnapshotIdentity struct {
	generation *pluginState
	pluginID   string
	owner      string
	route      resourcev2.AccessRoute
	epoch      sourceEpochSnapshot
}

type catalogSnapshotEntry struct {
	ready   chan struct{}
	catalog resourcev2.Catalog
	err     error
}

type catalogSnapshotCache struct {
	mu      sync.Mutex
	entries map[catalogSnapshotIdentity]*catalogSnapshotEntry
}

// WithCatalogSnapshotCache shares immutable route catalogs only within one
// operation/delivery lifetime. Install it before per-reference admission and
// inherit it into shared work; start a fresh scope for a later delivery request.
// It is idempotent and never caches authorization grants or resource bodies.
func WithCatalogSnapshotCache(ctx context.Context) context.Context {
	if _, ok := ctx.Value(catalogSnapshotKey{}).(*catalogSnapshotCache); ok {
		return ctx
	}
	return context.WithValue(ctx, catalogSnapshotKey{}, &catalogSnapshotCache{entries: make(map[catalogSnapshotIdentity]*catalogSnapshotEntry)})
}

// catalogSnapshot returns a read-only catalog. Every caller must still perform
// its operation-specific admission and authority checks, including on hits.
func (c *controller) catalogSnapshot(ctx context.Context, pluginID string, provider ResourceProvider, generation *pluginState, route resourcev2.AccessRoute) (resourcev2.Catalog, error) {
	if err := c.currentGeneration(ctx, pluginID, generation); err != nil {
		return resourcev2.Catalog{}, err
	}
	cache, scoped := ctx.Value(catalogSnapshotKey{}).(*catalogSnapshotCache)
	request, admitted := invocation.FromContext(ctx)
	epoch, captured := ctx.Value(sourceEpochKey{}).(sourceEpochSnapshot)
	if !scoped || !admitted || !captured || epoch.Connection != route.Connection {
		return provider.Catalog(ctx, resourcev2.CatalogRequest{Route: route})
	}
	key := catalogSnapshotIdentity{generation: generation, pluginID: pluginID, owner: request.Principal().Owner(), route: route, epoch: epoch}
	cache.mu.Lock()
	entry, exists := cache.entries[key]
	if !exists {
		entry = &catalogSnapshotEntry{ready: make(chan struct{})}
		cache.entries[key] = entry
	}
	cache.mu.Unlock()
	if exists {
		select {
		case <-entry.ready:
		case <-ctx.Done():
			return resourcev2.Catalog{}, ctx.Err()
		}
	} else {
		entry.catalog, entry.err = provider.Catalog(ctx, resourcev2.CatalogRequest{Route: route})
		if entry.err == nil {
			entry.err = resourcev2.ValidateCatalog(entry.catalog)
		}
		close(entry.ready)
	}
	if err := c.currentGeneration(ctx, pluginID, generation); err != nil {
		return resourcev2.Catalog{}, err
	}
	return entry.catalog, entry.err
}
