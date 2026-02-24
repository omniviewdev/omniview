package metric

import (
	"context"
	"fmt"
	"sync"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

// Well-known Prometheus service names, ordered by likelihood.
var knownPrometheusServices = []string{
	"prometheus-server",
	"prometheus-kube-prometheus-prometheus",
	"prometheus-operated",
	"prometheus",
	"kube-prometheus-stack-prometheus",
}

// Well-known namespaces where Prometheus is commonly installed.
var knownPrometheusNamespaces = []string{
	"monitoring",
	"prometheus",
	"kube-prometheus-stack",
	"observability",
	"kube-system",
	"default",
}

const (
	// DetectionPositiveTTL is how long a successful detection stays cached.
	DetectionPositiveTTL = 5 * time.Minute
	// DetectionNegativeTTL is how long a failed detection stays cached
	// before retrying (shorter so Prometheus installed after plugin start is found quickly).
	DetectionNegativeTTL = 1 * time.Minute
)

// DetectionResult holds the outcome of a Prometheus auto-detection scan.
type DetectionResult struct {
	Found     bool
	Service   string
	Namespace string
	Port      int
	CheckedAt time.Time
}

// ServiceChecker abstracts the Kubernetes API call for listing services.
// Implementations: real kubernetes.Interface, or a fake for testing.
type ServiceChecker interface {
	ServiceExists(ctx context.Context, namespace, name string) (bool, error)
}

// kubeServiceChecker implements ServiceChecker using a real kube clientset.
type kubeServiceChecker struct {
	clientset kubernetes.Interface
}

func (k *kubeServiceChecker) ServiceExists(ctx context.Context, namespace, name string) (bool, error) {
	_, err := k.clientset.CoreV1().Services(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return false, nil // treat all errors as "not found" — includes forbidden, not found, etc.
	}
	return true, nil
}

// PrometheusDetector performs lazy per-connection auto-detection of Prometheus
// services in Kubernetes clusters. Results are cached with separate TTLs for
// positive (found) and negative (not found) outcomes.
type PrometheusDetector struct {
	mu          sync.RWMutex
	cache       map[string]*DetectionResult
	positiveTTL time.Duration
	negativeTTL time.Duration
	nowFunc     func() time.Time
}

// DetectorOpts configures a PrometheusDetector.
type DetectorOpts struct {
	PositiveTTL time.Duration
	NegativeTTL time.Duration
	NowFunc     func() time.Time
}

// NewPrometheusDetector creates a new detector with the given options.
func NewPrometheusDetector(opts DetectorOpts) *PrometheusDetector {
	posTTL := opts.PositiveTTL
	if posTTL == 0 {
		posTTL = DetectionPositiveTTL
	}
	negTTL := opts.NegativeTTL
	if negTTL == 0 {
		negTTL = DetectionNegativeTTL
	}
	nowFunc := opts.NowFunc
	if nowFunc == nil {
		nowFunc = time.Now
	}
	return &PrometheusDetector{
		cache:       make(map[string]*DetectionResult),
		positiveTTL: posTTL,
		negativeTTL: negTTL,
		nowFunc:     nowFunc,
	}
}

// Detect checks whether Prometheus is available for the given connection.
// It returns a cached result if still valid, otherwise performs a fresh scan.
//
// The scan order is:
//  1. Check the user-configured service name in the user-configured namespace
//  2. If NO explicit config is provided, scan well-known service names across well-known namespaces
//
// When the user provides both a service name and namespace, only that exact
// combination is checked — no auto-detection fallback. This ensures the test
// connection accurately reflects whether the user's config is correct.
func (d *PrometheusDetector) Detect(
	connectionID string,
	checker ServiceChecker,
	configuredService string,
	configuredNamespace string,
	configuredPort int,
) *DetectionResult {
	// Include config in cache key so different configs get different entries.
	cacheKey := fmt.Sprintf("%s|%s|%s|%d", connectionID, configuredService, configuredNamespace, configuredPort)

	// Check cache first.
	d.mu.RLock()
	cached, ok := d.cache[cacheKey]
	d.mu.RUnlock()

	if ok && d.isCacheValid(cached) {
		return cached
	}

	// Perform fresh detection.
	result := d.scan(checker, configuredService, configuredNamespace, configuredPort)

	d.mu.Lock()
	d.cache[cacheKey] = result
	d.mu.Unlock()

	return result
}

// InvalidateConnection removes all cached detection entries for a connection.
func (d *PrometheusDetector) InvalidateConnection(connectionID string) {
	prefix := connectionID + "|"
	d.mu.Lock()
	for key := range d.cache {
		if len(key) >= len(prefix) && key[:len(prefix)] == prefix {
			delete(d.cache, key)
		}
	}
	d.mu.Unlock()
}

// isCacheValid checks if a cached result is still within its TTL.
func (d *PrometheusDetector) isCacheValid(result *DetectionResult) bool {
	age := d.nowFunc().Sub(result.CheckedAt)
	if result.Found {
		return age < d.positiveTTL
	}
	return age < d.negativeTTL
}

// scan performs the actual service discovery.
func (d *PrometheusDetector) scan(
	checker ServiceChecker,
	configuredService string,
	configuredNamespace string,
	configuredPort int,
) *DetectionResult {
	ctx := context.Background()
	now := d.nowFunc()

	port := configuredPort
	if port <= 0 {
		port = 9090
	}

	hasExplicitConfig := configuredService != "" && configuredNamespace != ""

	// 1. Check user-configured service first.
	if hasExplicitConfig {
		if exists, _ := checker.ServiceExists(ctx, configuredNamespace, configuredService); exists {
			return &DetectionResult{
				Found:     true,
				Service:   configuredService,
				Namespace: configuredNamespace,
				Port:      port,
				CheckedAt: now,
			}
		}
		// User provided explicit config but the service doesn't exist.
		// Do NOT fall back to auto-detection — return not-found so the
		// user knows their config is wrong.
		return &DetectionResult{
			Found:     false,
			CheckedAt: now,
		}
	}

	// 2. No explicit config — scan well-known services across well-known namespaces.
	for _, ns := range knownPrometheusNamespaces {
		for _, svc := range knownPrometheusServices {
			if exists, _ := checker.ServiceExists(ctx, ns, svc); exists {
				return &DetectionResult{
					Found:     true,
					Service:   svc,
					Namespace: ns,
					Port:      port,
					CheckedAt: now,
				}
			}
		}
	}

	return &DetectionResult{
		Found:     false,
		CheckedAt: now,
	}
}

// CacheLen returns the number of cached detection results (for testing).
func (d *PrometheusDetector) CacheLen() int {
	d.mu.RLock()
	defer d.mu.RUnlock()
	return len(d.cache)
}

// GetCached returns the cached result for a connection (for testing).
func (d *PrometheusDetector) GetCached(connectionID string) (*DetectionResult, bool) {
	d.mu.RLock()
	defer d.mu.RUnlock()
	r, ok := d.cache[connectionID]
	return r, ok
}

// formatPrometheusURL builds the Prometheus base URL for API proxy or direct access.
func formatPrometheusURL(result *DetectionResult) string {
	return fmt.Sprintf("http://%s.%s.svc:%d", result.Service, result.Namespace, result.Port)
}
