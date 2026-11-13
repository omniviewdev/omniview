package gateway

// HeldCalls is the number of runtime calls that currently hold the tunnel bound
// to a credential's page label, or 0 when there is none. Tests in the external
// package use it to see how long a call holds its tunnel.
func (g *Gateway) HeldCalls(credentialID, label string) int {
	g.mu.Lock()
	defer g.mu.Unlock()
	if c := g.clients[clientKey{credential: credentialID, label: label}]; c != nil {
		return c.calls
	}
	return 0
}
