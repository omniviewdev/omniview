package sso

import "sync"

// PendingFlows tracks in-progress device authorization flows keyed by
// connection ID. It is safe for concurrent use.
type PendingFlows struct {
	mu    sync.RWMutex
	flows map[string]*DeviceAuth
}

// NewPendingFlows creates a new PendingFlows instance.
func NewPendingFlows() *PendingFlows {
	return &PendingFlows{
		flows: make(map[string]*DeviceAuth),
	}
}

// Get retrieves a pending device auth flow for the given connection ID.
// Returns nil if no flow is pending.
func (p *PendingFlows) Get(connectionID string) *DeviceAuth {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.flows[connectionID]
}

// Set stores a pending device auth flow for the given connection ID.
func (p *PendingFlows) Set(connectionID string, auth *DeviceAuth) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.flows[connectionID] = auth
}

// Delete removes a pending device auth flow for the given connection ID.
func (p *PendingFlows) Delete(connectionID string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	delete(p.flows, connectionID)
}
