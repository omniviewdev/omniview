package metric

import (
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniview/kubernetes/pkg/utils/kubeauth"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// fakeFactory returns a factory that counts invocations and returns a stub bundle.
func fakeFactory() (ClientFactory, *atomic.Int64) {
	var count atomic.Int64
	factory := func(conn *types.Connection) (*kubeauth.KubeClientBundle, error) {
		count.Add(1)
		return &kubeauth.KubeClientBundle{}, nil
	}
	return factory, &count
}

// failingFactory always returns an error.
func failingFactory() ClientFactory {
	return func(conn *types.Connection) (*kubeauth.KubeClientBundle, error) {
		return nil, fmt.Errorf("connection failed")
	}
}

func testConn(id string) *types.Connection {
	return &types.Connection{
		ID: id,
		Data: map[string]interface{}{
			"kubeconfig": "/path/to/config",
			"context":    "ctx",
		},
	}
}

func TestClientCache_BasicGetAndCache(t *testing.T) {
	factory, count := fakeFactory()
	now := time.Now()
	cache := NewClientCache(ClientCacheOpts{
		TTL:     5 * time.Minute,
		Factory: factory,
		NowFunc: func() time.Time { return now },
	})
	defer cache.Stop()

	conn := testConn("conn-1")

	// First call should invoke the factory.
	c1, err := cache.Get("conn-1", conn)
	require.NoError(t, err)
	require.NotNil(t, c1)
	assert.Equal(t, int64(1), count.Load(), "factory should be called once")

	// Second call should return cached - no factory invocation.
	c2, err := cache.Get("conn-1", conn)
	require.NoError(t, err)
	assert.Same(t, c1, c2, "expected same pointer from cache")
	assert.Equal(t, int64(1), count.Load(), "factory should still be called once")
}

func TestClientCache_DifferentConnections(t *testing.T) {
	factory, count := fakeFactory()
	cache := NewClientCache(ClientCacheOpts{
		TTL:     5 * time.Minute,
		Factory: factory,
	})
	defer cache.Stop()

	_, err1 := cache.Get("conn-1", testConn("conn-1"))
	_, err2 := cache.Get("conn-2", testConn("conn-2"))
	require.NoError(t, err1)
	require.NoError(t, err2)

	assert.Equal(t, int64(2), count.Load())
	assert.Equal(t, 2, cache.Len())
}

func TestClientCache_FactoryError(t *testing.T) {
	cache := NewClientCache(ClientCacheOpts{
		TTL:     5 * time.Minute,
		Factory: failingFactory(),
	})
	defer cache.Stop()

	_, err := cache.Get("conn-1", testConn("conn-1"))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "connection failed")

	// Should not have cached the error.
	assert.Equal(t, 0, cache.Len())
}

func TestClientCache_Evict(t *testing.T) {
	factory, _ := fakeFactory()
	cache := NewClientCache(ClientCacheOpts{
		TTL:     5 * time.Minute,
		Factory: factory,
	})
	defer cache.Stop()

	cache.Get("conn-1", testConn("conn-1"))
	assert.Equal(t, 1, cache.Len())

	cache.Evict("conn-1")
	assert.Equal(t, 0, cache.Len())

	// Evicting non-existent key should not panic.
	cache.Evict("conn-nonexistent")
}

func TestClientCache_TTLExpiration(t *testing.T) {
	factory, count := fakeFactory()
	now := time.Now()
	var mu sync.Mutex

	cache := NewClientCache(ClientCacheOpts{
		TTL:     2 * time.Minute,
		Factory: factory,
		NowFunc: func() time.Time {
			mu.Lock()
			defer mu.Unlock()
			return now
		},
	})
	defer cache.Stop()

	conn := testConn("conn-1")

	// Populate cache.
	cache.Get("conn-1", conn)
	assert.Equal(t, int64(1), count.Load())

	// Advance time past TTL.
	mu.Lock()
	now = now.Add(3 * time.Minute)
	mu.Unlock()

	// Manually trigger reap.
	cache.reap()

	assert.Equal(t, 0, cache.Len(), "entry should be reaped after TTL")

	// Re-fetching should call factory again.
	cache.Get("conn-1", conn)
	assert.Equal(t, int64(2), count.Load(), "factory should be called again after expiration")
}

func TestClientCache_AccessRefreshesTTL(t *testing.T) {
	factory, _ := fakeFactory()
	now := time.Now()
	var mu sync.Mutex

	cache := NewClientCache(ClientCacheOpts{
		TTL:     5 * time.Minute,
		Factory: factory,
		NowFunc: func() time.Time {
			mu.Lock()
			defer mu.Unlock()
			return now
		},
	})
	defer cache.Stop()

	conn := testConn("conn-1")

	// Populate at t=0.
	cache.Get("conn-1", conn)

	// Access at t=3min (within TTL of 5min).
	mu.Lock()
	now = now.Add(3 * time.Minute)
	mu.Unlock()
	cache.Get("conn-1", conn) // refreshes lastAccess to t=3min

	// Reap at t=7min. Since last access was t=3min, age = 4min < 5min TTL.
	mu.Lock()
	now = now.Add(4 * time.Minute) // total t=7min
	mu.Unlock()
	cache.reap()

	assert.Equal(t, 1, cache.Len(), "entry should survive because access refreshed TTL")

	// Reap at t=9min. Since last access was t=3min, age = 6min > 5min TTL.
	mu.Lock()
	now = now.Add(2 * time.Minute) // total t=9min
	mu.Unlock()
	cache.reap()

	assert.Equal(t, 0, cache.Len(), "entry should be reaped after exceeding TTL since last access")
}

func TestClientCache_ConcurrentAccess(t *testing.T) {
	factory, count := fakeFactory()
	cache := NewClientCache(ClientCacheOpts{
		TTL:     5 * time.Minute,
		Factory: factory,
	})
	defer cache.Stop()

	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(connID string) {
			defer wg.Done()
			_, err := cache.Get(connID, testConn(connID))
			assert.NoError(t, err)
		}(fmt.Sprintf("conn-%d", i%5)) // 5 unique connections, 50 goroutines
	}
	wg.Wait()

	assert.Equal(t, 5, cache.Len())
	// The double-check locking in Get() has a TOCTOU window between the RLock
	// read-miss and the Lock write-check, so the factory may be called more than
	// 5 times under high contention. But it should never be called 50 times.
	assert.Less(t, count.Load(), int64(50),
		"factory should not be called for every goroutine under contention")
}

func TestClientCache_StopClearsEntries(t *testing.T) {
	factory, _ := fakeFactory()
	cache := NewClientCache(ClientCacheOpts{
		TTL:     5 * time.Minute,
		Factory: factory,
	})

	cache.Get("conn-1", testConn("conn-1"))

	cache.Stop()

	assert.Equal(t, 0, cache.Len())
}

func TestClientCache_ReapOnlyExpiredEntries(t *testing.T) {
	factory, _ := fakeFactory()
	now := time.Now()
	var mu sync.Mutex

	cache := NewClientCache(ClientCacheOpts{
		TTL:     5 * time.Minute,
		Factory: factory,
		NowFunc: func() time.Time {
			mu.Lock()
			defer mu.Unlock()
			return now
		},
	})
	defer cache.Stop()

	// Add two entries at different times.
	cache.Get("conn-1", testConn("conn-1"))

	mu.Lock()
	now = now.Add(3 * time.Minute)
	mu.Unlock()

	cache.Get("conn-2", testConn("conn-2"))

	// At t=6min: conn-1 age=6min (expired), conn-2 age=3min (alive)
	mu.Lock()
	now = now.Add(3 * time.Minute)
	mu.Unlock()

	cache.reap()

	assert.Equal(t, 1, cache.Len(), "only expired entry should be reaped")
	// Verify conn-2 is still there.
	c, err := cache.Get("conn-2", testConn("conn-2"))
	require.NoError(t, err)
	assert.NotNil(t, c)
}

func TestClientCache_GetAfterEvictRebuilds(t *testing.T) {
	factory, count := fakeFactory()
	cache := NewClientCache(ClientCacheOpts{
		TTL:     5 * time.Minute,
		Factory: factory,
	})
	defer cache.Stop()

	conn := testConn("conn-1")
	cache.Get("conn-1", conn)
	assert.Equal(t, int64(1), count.Load())

	cache.Evict("conn-1")
	assert.Equal(t, 0, cache.Len())

	// Getting after eviction should rebuild.
	_, err := cache.Get("conn-1", conn)
	require.NoError(t, err)
	assert.Equal(t, int64(2), count.Load(), "factory should be called again after eviction")
	assert.Equal(t, 1, cache.Len())
}
