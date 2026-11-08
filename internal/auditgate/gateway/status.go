package gateway

import (
	"sort"
	"time"
)

// CredentialState is where a credential is in its life.
type CredentialState string

// Credential states.
const (
	// CredentialPending is a credential whose secret is still being delivered.
	CredentialPending CredentialState = "pending"
	CredentialActive  CredentialState = "active"
	CredentialRevoked CredentialState = "revoked"
	CredentialExpired CredentialState = "expired"
)

// CredentialStatus describes one credential. It carries no secret.
type CredentialStatus struct {
	ID        string
	Username  string
	State     CredentialState
	CreatedAt time.Time
	ExpiresAt time.Time
	// Node is the node the credential is pinned to: the first node that
	// authenticated with it. It is empty until then. It is an opaque
	// identifier and is evidence that a credential was used from that node;
	// it does not say which person held the device.
	Node string
	// FirstUsedAt is when the credential was pinned.
	FirstUsedAt time.Time
}

// Status is a bounded snapshot of an audit for the supervisor's inspect output.
// It carries opaque IDs, counts and timestamps only: no secret, header, URL,
// username of a failed attempt or request text.
type Status struct {
	AuditID   string
	Realm     string
	Origin    string
	State     State
	EndReason EndReason
	CreatedAt time.Time
	ExpiresAt time.Time
	// Credentials lists the credentials the audit still remembers, oldest
	// first. Ended credentials are kept only until their place is needed.
	Credentials []CredentialStatus
	// PendingOffers is the number of pairing offers not yet redeemed or
	// expired.
	PendingOffers int
	// InFlight and Tunnels count open authenticated requests and events
	// tunnels.
	InFlight int
	Tunnels  int
	// EventSocketOpens is how many events sockets the audit has opened
	// upstream, against its lifetime budget.
	EventSocketOpens int
	// EventsForwarded and EventsDropped count backend event messages the
	// filter let through or dropped, binary and oversized ones included.
	EventsForwarded uint64
	EventsDropped   uint64
	// Denials counts refused requests by category.
	Denials map[Denial]uint64
}

// Status reports the audit's state. It is safe to call at any time, including
// after the audit ended.
func (g *Gateway) Status() Status {
	now := g.cfg.Clock.Now()
	g.mu.Lock()
	status := Status{
		AuditID:          g.id,
		Realm:            g.realm,
		Origin:           g.origin,
		State:            g.state,
		EndReason:        g.reason,
		CreatedAt:        g.created.Wall,
		ExpiresAt:        g.expires.wall,
		Credentials:      g.credentialStatusesLocked(now),
		PendingOffers:    g.pendingOffersLocked(now),
		InFlight:         g.requests,
		Tunnels:          g.tunnels,
		EventSocketOpens: g.socketOpens,
		EventsForwarded:  g.eventsForwarded.Load(),
		EventsDropped:    g.eventsDropped.Load(),
		Denials:          nil,
	}
	g.mu.Unlock()
	status.Denials = g.denials.snapshot()
	return status
}

func (g *Gateway) credentialStatusesLocked(now Instant) []CredentialStatus {
	var out []CredentialStatus
	for i := range g.table.slots {
		slot := &g.table.slots[i]
		if slot.state == slotFree {
			continue
		}
		out = append(out, CredentialStatus{
			ID:          slot.id,
			Username:    string(slot.username[:]),
			State:       credentialState(slot, now),
			CreatedAt:   slot.created,
			ExpiresAt:   slot.expires.wall,
			Node:        slot.node,
			FirstUsedAt: slot.firstUse,
		})
	}
	sort.Slice(out, func(a, b int) bool { return out[a].CreatedAt.Before(out[b].CreatedAt) })
	return out
}

func credentialState(slot *credentialSlot, now Instant) CredentialState {
	switch slot.state {
	case slotPending:
		if slot.expires.reached(now) {
			return CredentialExpired
		}
		return CredentialPending
	case slotActive:
		if slot.expires.reached(now) {
			return CredentialExpired
		}
		return CredentialActive
	case slotRevoked:
		return CredentialRevoked
	case slotExpired:
		return CredentialExpired
	case slotFree:
		return ""
	}
	return ""
}

func (g *Gateway) pendingOffersLocked(now Instant) int {
	count := 0
	for i := range g.offers {
		if g.offers[i].live && !g.offers[i].expires.reached(now) {
			count++
		}
	}
	return count
}
