package types

import (
	"fmt"
	"sync"
)

// InProcessBackend serves as both the test backend and the future bundled
// plugin backend. Providers are registered by name and dispensed directly
// without any gRPC or process boundary.
type InProcessBackend struct {
	mu        sync.Mutex
	providers map[string]interface{}
	stopped   bool

	// HealthFunc optionally overrides the default health check.
	// If nil, Healthy() returns !stopped.
	HealthFunc func() bool
}

// NewInProcessBackend creates a new InProcessBackend with the given providers.
func NewInProcessBackend(providers map[string]interface{}) *InProcessBackend {
	if providers == nil {
		providers = make(map[string]interface{})
	}
	return &InProcessBackend{
		providers: providers,
	}
}

// Dispense returns the provider registered under the given name.
func (b *InProcessBackend) Dispense(name string) (interface{}, error) {
	b.mu.Lock()
	defer b.mu.Unlock()

	if b.stopped {
		return nil, fmt.Errorf("backend is stopped")
	}

	provider, ok := b.providers[name]
	if !ok {
		return nil, fmt.Errorf("no provider registered for %q", name)
	}
	return provider, nil
}

// Healthy returns true if the backend has not been stopped.
func (b *InProcessBackend) Healthy() bool {
	b.mu.Lock()
	defer b.mu.Unlock()

	if b.HealthFunc != nil {
		return b.HealthFunc()
	}
	return !b.stopped
}

// Stop marks the backend as stopped.
func (b *InProcessBackend) Stop() error {
	b.mu.Lock()
	defer b.mu.Unlock()

	b.stopped = true
	return nil
}

// Kill is equivalent to Stop for in-process backends.
func (b *InProcessBackend) Kill() {
	b.Stop()
}

// Exited returns true if the backend has been stopped.
func (b *InProcessBackend) Exited() bool {
	b.mu.Lock()
	defer b.mu.Unlock()

	return b.stopped
}

// NegotiatedVersion returns the current protocol version for in-process backends.
func (b *InProcessBackend) NegotiatedVersion() int {
	return CurrentProtocolVersion
}

// DetectCapabilities returns the names of all registered providers.
func (b *InProcessBackend) DetectCapabilities() ([]string, error) {
	b.mu.Lock()
	defer b.mu.Unlock()

	caps := make([]string, 0, len(b.providers))
	for name := range b.providers {
		caps = append(caps, name)
	}
	return caps, nil
}
