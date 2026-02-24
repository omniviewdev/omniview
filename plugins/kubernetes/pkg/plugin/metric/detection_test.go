package metric

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// fakeServiceChecker is a test double for ServiceChecker.
type fakeServiceChecker struct {
	services map[string]map[string]bool // namespace -> service -> exists
	calls    int
	mu       sync.Mutex
}

func newFakeServiceChecker() *fakeServiceChecker {
	return &fakeServiceChecker{
		services: make(map[string]map[string]bool),
	}
}

func (f *fakeServiceChecker) addService(namespace, name string) {
	if f.services[namespace] == nil {
		f.services[namespace] = make(map[string]bool)
	}
	f.services[namespace][name] = true
}

func (f *fakeServiceChecker) removeService(namespace, name string) {
	if f.services[namespace] != nil {
		delete(f.services[namespace], name)
	}
}

func (f *fakeServiceChecker) ServiceExists(_ context.Context, namespace, name string) (bool, error) {
	f.mu.Lock()
	f.calls++
	f.mu.Unlock()

	if ns, ok := f.services[namespace]; ok {
		return ns[name], nil
	}
	return false, nil
}

func (f *fakeServiceChecker) callCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls
}

// --- Tests ---

func TestDetector_ConfiguredServiceFound(t *testing.T) {
	checker := newFakeServiceChecker()
	checker.addService("monitoring", "prometheus-server")

	d := NewPrometheusDetector(DetectorOpts{})

	result := d.Detect("conn-1", checker, "prometheus-server", "monitoring", 9090)
	require.True(t, result.Found, "expected Prometheus to be detected")
	assert.Equal(t, "prometheus-server", result.Service)
	assert.Equal(t, "monitoring", result.Namespace)
	assert.Equal(t, 9090, result.Port)
}

func TestDetector_FallbackToWellKnownService(t *testing.T) {
	checker := newFakeServiceChecker()
	// A well-known service exists in a well-known namespace.
	checker.addService("observability", "prometheus-operated")

	d := NewPrometheusDetector(DetectorOpts{})

	// Empty configured service/namespace triggers auto-discovery scan.
	result := d.Detect("conn-1", checker, "", "", 9090)
	require.True(t, result.Found, "expected Prometheus to be detected via well-known scan")
	assert.Equal(t, "prometheus-operated", result.Service)
	assert.Equal(t, "observability", result.Namespace)
}

func TestDetector_ExplicitConfigNotFoundNoFallback(t *testing.T) {
	checker := newFakeServiceChecker()
	// A well-known service exists, but user provided explicit config that doesn't exist.
	checker.addService("monitoring", "prometheus-server")

	d := NewPrometheusDetector(DetectorOpts{})

	// When explicit config is given (both service and namespace non-empty),
	// only that exact combination is checked. No fallback to well-known scan.
	result := d.Detect("conn-1", checker, "my-custom-prom", "my-ns", 9090)
	assert.False(t, result.Found, "explicit config miss should NOT fall back to well-known scan")
}

func TestDetector_NoPrometheusFound(t *testing.T) {
	checker := newFakeServiceChecker() // empty cluster

	d := NewPrometheusDetector(DetectorOpts{})

	result := d.Detect("conn-1", checker, "", "", 9090)
	assert.False(t, result.Found, "expected Prometheus NOT to be detected in empty cluster")
}

func TestDetector_CachesPositiveResult(t *testing.T) {
	checker := newFakeServiceChecker()
	checker.addService("monitoring", "prometheus-server")

	d := NewPrometheusDetector(DetectorOpts{
		PositiveTTL: 5 * time.Minute,
	})

	// First call - scans.
	d.Detect("conn-1", checker, "prometheus-server", "monitoring", 9090)
	callsAfterFirst := checker.callCount()

	// Second call - should use cache (no additional API calls).
	d.Detect("conn-1", checker, "prometheus-server", "monitoring", 9090)
	assert.Equal(t, callsAfterFirst, checker.callCount(), "expected cached result, but checker was called again")
}

func TestDetector_CachesNegativeResult(t *testing.T) {
	checker := newFakeServiceChecker() // empty

	d := NewPrometheusDetector(DetectorOpts{
		NegativeTTL: 1 * time.Minute,
	})

	d.Detect("conn-1", checker, "", "", 9090)
	callsAfterFirst := checker.callCount()

	// Should use cached negative.
	d.Detect("conn-1", checker, "", "", 9090)
	assert.Equal(t, callsAfterFirst, checker.callCount(), "expected cached negative result")
}

func TestDetector_NegativeCacheExpires(t *testing.T) {
	checker := newFakeServiceChecker() // empty

	now := time.Now()
	var mu sync.Mutex

	d := NewPrometheusDetector(DetectorOpts{
		NegativeTTL: 1 * time.Minute,
		NowFunc: func() time.Time {
			mu.Lock()
			defer mu.Unlock()
			return now
		},
	})

	// First scan - negative.
	result := d.Detect("conn-1", checker, "", "", 9090)
	assert.False(t, result.Found)
	callsAfterFirst := checker.callCount()

	// Advance time past negative TTL.
	mu.Lock()
	now = now.Add(2 * time.Minute)
	mu.Unlock()

	// Now add Prometheus to the cluster.
	checker.addService("monitoring", "prometheus-server")

	// Re-detect - cache expired, should re-scan and find it.
	result = d.Detect("conn-1", checker, "", "", 9090)
	assert.True(t, result.Found, "expected to find Prometheus after cache expiry")
	assert.Greater(t, checker.callCount(), callsAfterFirst, "expected fresh scan after cache expiry")
}

func TestDetector_PositiveCacheExpires(t *testing.T) {
	checker := newFakeServiceChecker()
	checker.addService("monitoring", "prometheus-server")

	now := time.Now()
	var mu sync.Mutex

	d := NewPrometheusDetector(DetectorOpts{
		PositiveTTL: 5 * time.Minute,
		NowFunc: func() time.Time {
			mu.Lock()
			defer mu.Unlock()
			return now
		},
	})

	// Detect - found.
	d.Detect("conn-1", checker, "prometheus-server", "monitoring", 9090)
	callsAfterFirst := checker.callCount()

	// Advance past positive TTL.
	mu.Lock()
	now = now.Add(6 * time.Minute)
	mu.Unlock()

	// Remove Prometheus.
	checker.removeService("monitoring", "prometheus-server")

	// Re-detect - cache expired, should re-scan.
	result := d.Detect("conn-1", checker, "prometheus-server", "monitoring", 9090)
	assert.False(t, result.Found, "expected NOT found after Prometheus was removed and cache expired")
	assert.Greater(t, checker.callCount(), callsAfterFirst, "expected fresh scan after positive cache expiry")
}

func TestDetector_DifferentConnectionsIndependent(t *testing.T) {
	checker := newFakeServiceChecker()
	checker.addService("monitoring", "prometheus-server")

	d := NewPrometheusDetector(DetectorOpts{})

	r1 := d.Detect("conn-1", checker, "prometheus-server", "monitoring", 9090)
	assert.True(t, r1.Found, "conn-1 should find Prometheus")

	// conn-2 uses a different checker (simulating a different cluster).
	emptyChecker := newFakeServiceChecker()
	r2 := d.Detect("conn-2", emptyChecker, "prometheus-server", "monitoring", 9090)
	assert.False(t, r2.Found, "conn-2 should NOT find Prometheus")

	assert.Equal(t, 2, d.CacheLen())
}

func TestDetector_InvalidateConnection(t *testing.T) {
	checker := newFakeServiceChecker()
	checker.addService("monitoring", "prometheus-server")

	d := NewPrometheusDetector(DetectorOpts{})

	d.Detect("conn-1", checker, "prometheus-server", "monitoring", 9090)
	assert.Equal(t, 1, d.CacheLen())

	d.InvalidateConnection("conn-1")
	assert.Equal(t, 0, d.CacheLen())

	// Invalidating non-existent should not panic.
	d.InvalidateConnection("conn-nonexistent")
}

func TestDetector_DefaultPortWhenZero(t *testing.T) {
	checker := newFakeServiceChecker()
	checker.addService("monitoring", "prometheus-server")

	d := NewPrometheusDetector(DetectorOpts{})

	result := d.Detect("conn-1", checker, "prometheus-server", "monitoring", 0)
	require.True(t, result.Found)
	assert.Equal(t, 9090, result.Port, "should default to 9090 when configured port is 0")
}

func TestDetector_EmptyConfiguredServiceSkipsFirstCheck(t *testing.T) {
	checker := newFakeServiceChecker()
	checker.addService("prometheus", "prometheus")

	d := NewPrometheusDetector(DetectorOpts{})

	// Empty configured service/namespace should skip the configured check
	// and fall through to well-known scan.
	result := d.Detect("conn-1", checker, "", "", 9090)
	require.True(t, result.Found, "expected to find via well-known scan")
	assert.Equal(t, "prometheus", result.Service)
}

func TestDetector_KubePrometheusStackVariant(t *testing.T) {
	checker := newFakeServiceChecker()
	checker.addService("kube-prometheus-stack", "kube-prometheus-stack-prometheus")

	d := NewPrometheusDetector(DetectorOpts{})

	// No explicit config - auto-discover the kube-prometheus-stack variant.
	result := d.Detect("conn-1", checker, "", "", 9090)
	require.True(t, result.Found, "expected to find kube-prometheus-stack variant")
	assert.Equal(t, "kube-prometheus-stack-prometheus", result.Service)
	assert.Equal(t, "kube-prometheus-stack", result.Namespace)
}

func TestDetector_ConcurrentDetection(t *testing.T) {
	checker := newFakeServiceChecker()
	checker.addService("monitoring", "prometheus-server")

	d := NewPrometheusDetector(DetectorOpts{})

	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			result := d.Detect("conn-1", checker, "prometheus-server", "monitoring", 9090)
			assert.True(t, result.Found, "expected found in concurrent detect")
		}()
	}
	wg.Wait()
}

func TestDetector_DifferentConfigsGetDifferentCacheEntries(t *testing.T) {
	checker := newFakeServiceChecker()
	checker.addService("monitoring", "prom-a")
	checker.addService("observability", "prom-b")

	d := NewPrometheusDetector(DetectorOpts{})

	r1 := d.Detect("conn-1", checker, "prom-a", "monitoring", 9090)
	r2 := d.Detect("conn-1", checker, "prom-b", "observability", 9090)

	assert.True(t, r1.Found)
	assert.True(t, r2.Found)
	assert.Equal(t, "prom-a", r1.Service)
	assert.Equal(t, "prom-b", r2.Service)
	// Should have 2 cache entries (same connection, different configs).
	assert.Equal(t, 2, d.CacheLen())
}

func TestDetector_NegativePortDefaultsTo9090(t *testing.T) {
	checker := newFakeServiceChecker()
	checker.addService("monitoring", "prometheus-server")

	d := NewPrometheusDetector(DetectorOpts{})

	result := d.Detect("conn-1", checker, "prometheus-server", "monitoring", -1)
	require.True(t, result.Found)
	assert.Equal(t, 9090, result.Port, "negative port should default to 9090")
}

func TestFormatPrometheusURL(t *testing.T) {
	result := &DetectionResult{
		Service:   "prometheus-server",
		Namespace: "monitoring",
		Port:      9090,
	}
	assert.Equal(t, "http://prometheus-server.monitoring.svc:9090", formatPrometheusURL(result))
}

func TestFormatPrometheusURL_CustomPort(t *testing.T) {
	result := &DetectionResult{
		Service:   "prom",
		Namespace: "obs",
		Port:      8080,
	}
	assert.Equal(t, "http://prom.obs.svc:8080", formatPrometheusURL(result))
}

// --- Hot-install scenario tests ---

func TestDetector_HotInstallPrometheus(t *testing.T) {
	checker := newFakeServiceChecker()
	now := time.Now()
	var mu sync.Mutex

	d := NewPrometheusDetector(DetectorOpts{
		NegativeTTL: 1 * time.Minute,
		NowFunc: func() time.Time {
			mu.Lock()
			defer mu.Unlock()
			return now
		},
	})

	// Step 1: Prometheus not installed.
	r := d.Detect("conn-1", checker, "", "", 9090)
	assert.False(t, r.Found, "expected not found initially")

	// Step 2: User installs Prometheus.
	checker.addService("monitoring", "prometheus-server")

	// Step 3: Within the negative TTL, detection still returns cached "not found".
	mu.Lock()
	now = now.Add(30 * time.Second) // only 30s of 1min TTL elapsed
	mu.Unlock()

	r = d.Detect("conn-1", checker, "", "", 9090)
	assert.False(t, r.Found, "expected cached negative result within TTL")

	// Step 4: After negative TTL expires, re-scan finds Prometheus.
	mu.Lock()
	now = now.Add(45 * time.Second) // total 75s > 1min TTL
	mu.Unlock()

	r = d.Detect("conn-1", checker, "", "", 9090)
	assert.True(t, r.Found, "expected to find Prometheus after negative cache expired")
	assert.Equal(t, "prometheus-server", r.Service)
	assert.Equal(t, "monitoring", r.Namespace)
}

func TestDetector_WellKnownScanOrder(t *testing.T) {
	// When multiple well-known services exist, the scan should find the first
	// match based on the namespace-then-service iteration order.
	checker := newFakeServiceChecker()
	// Add services in two namespaces
	checker.addService("monitoring", "prometheus-server")     // should be found first
	checker.addService("kube-system", "prometheus-operated") // should NOT be returned

	d := NewPrometheusDetector(DetectorOpts{})

	result := d.Detect("conn-1", checker, "", "", 9090)
	require.True(t, result.Found)
	// "monitoring" comes before "kube-system" in knownPrometheusNamespaces,
	// and "prometheus-server" comes first in knownPrometheusServices.
	assert.Equal(t, "monitoring", result.Namespace)
	assert.Equal(t, "prometheus-server", result.Service)
}

func TestDetector_GetCached(t *testing.T) {
	checker := newFakeServiceChecker()
	checker.addService("monitoring", "prometheus-server")

	d := NewPrometheusDetector(DetectorOpts{})

	// Cache key format: "connectionID|service|namespace|port"
	cacheKey := "conn-1|prometheus-server|monitoring|9090"

	// Before detection, cache should be empty.
	_, ok := d.GetCached(cacheKey)
	assert.False(t, ok, "expected no cached result before detection")

	// After detection, cache should have the result.
	d.Detect("conn-1", checker, "prometheus-server", "monitoring", 9090)
	cached, ok := d.GetCached(cacheKey)
	require.True(t, ok, "expected cached result after detection")
	assert.True(t, cached.Found)
	assert.Equal(t, "prometheus-server", cached.Service)
	assert.Equal(t, "monitoring", cached.Namespace)

	// Non-existent key returns false.
	_, ok = d.GetCached("conn-nonexistent|x|y|0")
	assert.False(t, ok)
}
