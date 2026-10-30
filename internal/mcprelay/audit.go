package mcprelay

import (
	"context"
	"time"
)

// AuditEvent deliberately excludes arguments, resource identity, raw provider
// errors, credential material and client-supplied metadata. Opaque host-issued
// identifiers correlate consent, admission and the final result locally.
type AuditEvent struct {
	At              time.Time
	InvocationID    string
	CredentialID    string
	SessionID       string
	PluginID        string
	Tool            string
	Operation       string
	PolicyRevision  uint64
	CatalogRevision uint64
	Outcome         string
}

// SetAudit installs a local audit sink. The callback runs without authority or
// native resource locks held and must not expose the event to external clients.
func (a *Authority) SetAudit(sink func(AuditEvent)) {
	a.mu.Lock()
	a.audit = sink
	a.mu.Unlock()
}

func (a *Authority) Record(ctx context.Context, outcome string) {
	c, ok := ctx.Value(authorityContextKey{}).(*authorityCall)
	if !ok {
		return
	}
	event := AuditEvent{At: time.Now(), InvocationID: c.id, CredentialID: c.credential,
		SessionID: c.session, PluginID: c.tool.PluginID, Tool: c.tool.MCPName,
		Operation: c.operation, PolicyRevision: c.policy, CatalogRevision: c.catalog, Outcome: outcome}
	a.mu.Lock()
	sink := a.audit
	a.mu.Unlock()
	if sink != nil {
		sink(event)
	}
}
