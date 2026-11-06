package types

import (
	"errors"
	"fmt"
	"maps"
	"sync"
)

// InProcessBackendConfig defines the providers and lifetime of a direct backend.
// Callbacks are fixed at construction and may inspect the backend's state.
type InProcessBackendConfig struct {
	// Providers are snapshotted at construction. Provider instances are not copied.
	Providers map[string]interface{}

	// HealthCheck optionally checks native readiness while the backend is running.
	// It may run concurrently with Shutdown and must synchronize its own state.
	HealthCheck func() bool

	// Shutdown releases aggregate resources not owned by capability controllers.
	// It runs once; it must not call Stop or Kill on this backend. The backend
	// never infers resource ownership by calling Close on dispensed providers.
	Shutdown func() error
}

// InProcessBackend dispenses providers without a gRPC or process boundary.
// Stopping fences new access immediately; exited means shutdown has completed.
type InProcessBackend struct {
	mu        sync.Mutex
	providers map[string]interface{}
	health    func() bool
	shutdown  func() error
	stopped   bool
	exited    bool
	stopOnce  sync.Once
	stopErr   error
}

// NewInProcessBackend constructs a direct backend with immutable configuration.
func NewInProcessBackend(config InProcessBackendConfig) *InProcessBackend {
	config.Providers = maps.Clone(config.Providers)
	return newOwnedInProcessBackend(config)
}

// newOwnedInProcessBackend consumes a private provider map without copying it.
func newOwnedInProcessBackend(config InProcessBackendConfig) *InProcessBackend {
	return &InProcessBackend{
		providers: config.Providers,
		health:    config.HealthCheck,
		shutdown:  config.Shutdown,
	}
}

// Dispense returns the provider registered under the given name.
func (b *InProcessBackend) Dispense(name string) (interface{}, error) {
	b.mu.Lock()
	defer b.mu.Unlock()

	if b.stopped {
		return nil, errors.New("backend is stopped")
	}

	provider, ok := b.providers[name]
	if !ok {
		return nil, fmt.Errorf("no provider registered for %q", name)
	}
	return provider, nil
}

// Healthy checks readiness without holding the state lock across provider code.
// Shutdown always overrides a custom health result.
func (b *InProcessBackend) Healthy() bool {
	b.mu.Lock()
	stopped := b.stopped
	b.mu.Unlock()
	if stopped {
		return false
	}
	if b.health == nil {
		return true
	}

	healthy := b.health()
	b.mu.Lock()
	defer b.mu.Unlock()
	return healthy && !b.stopped
}

// Stop fences new access and waits for aggregate shutdown exactly once.
// Concurrent callers receive the same result after shutdown completes.
func (b *InProcessBackend) Stop() error {
	b.stopOnce.Do(func() {
		b.mu.Lock()
		b.stopped = true
		b.mu.Unlock()

		if b.shutdown != nil {
			b.stopErr = b.shutdown()
		}

		b.mu.Lock()
		b.exited = true
		b.mu.Unlock()
	})
	return b.stopErr
}

// Kill waits for Stop; in-process code cannot be forcefully terminated.
func (b *InProcessBackend) Kill() {
	_ = b.Stop()
}

// Exited reports whether aggregate shutdown has completed.
func (b *InProcessBackend) Exited() bool {
	b.mu.Lock()
	defer b.mu.Unlock()

	return b.exited
}

// NegotiatedVersion returns the current protocol version for in-process backends.
func (b *InProcessBackend) NegotiatedVersion() int {
	return CurrentProtocolVersion
}

// DetectCapabilities returns the names of all registered providers.
func (b *InProcessBackend) DetectCapabilities() ([]string, error) {
	// The provider map is immutable after construction.
	caps := make([]string, 0, len(b.providers))
	for name := range b.providers {
		caps = append(caps, name)
	}
	return caps, nil
}
