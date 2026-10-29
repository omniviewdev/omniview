package resource

import (
	"context"
	"sync"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

const maxResourceSubscriptions = 4096

// HostSubscription is one actual live frontend subscription, not a target lease.
type HostSubscription struct {
	TargetID string                `json:"targetId"`
	Target   resourcev2.ReadTarget `json:"target"`
}

type subscriptionKey struct {
	Owner       invocation.Principal
	Plugin      string
	Connection  string
	Type        string
	TargetID    string
	Fingerprint string
}

type subscription struct {
	Owner    invocation.Principal
	Context  context.Context
	TargetID string
	Target   resourcev2.ReadTarget
	count    uint64
}

type subscriptionManager struct {
	mu            sync.RWMutex
	subscriptions map[subscriptionKey]subscription
}

func newSubscriptionManager() *subscriptionManager {
	return &subscriptionManager{subscriptions: make(map[subscriptionKey]subscription)}
}

func subscriptionIdentity(owner invocation.Principal, pluginID string, request HostSubscription) (subscriptionKey, resourcev2.ReadTarget, error) {
	if request.TargetID == "" || len(request.TargetID) > 4096 {
		return subscriptionKey{}, resourcev2.ReadTarget{}, resourcev2.NewError("INVALID_REQUEST", "A bounded subscription target ID is required.")
	}
	target, fingerprint, err := resourcev2.CanonicalReadTarget(request.Target)
	if err != nil {
		return subscriptionKey{}, resourcev2.ReadTarget{}, err
	}
	return subscriptionKey{Owner: owner, Plugin: pluginID, Connection: target.Route.Connection, Type: target.Type, TargetID: request.TargetID, Fingerprint: fingerprint}, target, nil
}

func (m *subscriptionManager) Subscribe(ctx context.Context, owner invocation.Principal, pluginID string, request HostSubscription) error {
	key, target, err := subscriptionIdentity(owner, pluginID, request)
	if err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	entry, exists := m.subscriptions[key]
	if !exists {
		if len(m.subscriptions) >= maxResourceSubscriptions {
			return resourcev2.NewError("RESOURCE_LIMIT", "Too many live resource subscriptions.")
		}
		entry = subscription{Context: context.WithoutCancel(ctx), Owner: owner, TargetID: request.TargetID, Target: target}
	}
	if entry.count == ^uint64(0) {
		return resourcev2.NewError("RESOURCE_LIMIT", "The subscription reference count exceeds the host limit.")
	}
	entry.count++
	m.subscriptions[key] = entry
	return nil
}

func (m *subscriptionManager) Unsubscribe(owner invocation.Principal, pluginID string, request HostSubscription) error {
	key, _, err := subscriptionIdentity(owner, pluginID, request)
	if err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	entry, exists := m.subscriptions[key]
	if !exists {
		return nil
	}
	if entry.count > 1 {
		entry.count--
		m.subscriptions[key] = entry
	} else {
		delete(m.subscriptions, key)
	}
	return nil
}

func (m *subscriptionManager) Matching(pluginID, connectionID, resourceType string) []subscription {
	m.mu.RLock()
	defer m.mu.RUnlock()
	var matches []subscription
	for key, entry := range m.subscriptions {
		if key.Plugin == pluginID && key.Connection == connectionID && key.Type == resourceType {
			matches = append(matches, entry)
		}
	}
	return matches
}

func (m *subscriptionManager) IsSubscribed(pluginID, connectionID, resourceType string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for key := range m.subscriptions {
		if key.Plugin == pluginID && key.Connection == connectionID && key.Type == resourceType {
			return true
		}
	}
	return false
}

func (m *subscriptionManager) RemoveAll(pluginID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for key := range m.subscriptions {
		if key.Plugin == pluginID {
			delete(m.subscriptions, key)
		}
	}
}

func (m *subscriptionManager) RemoveRoute(pluginID, connectionID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for key := range m.subscriptions {
		if key.Plugin == pluginID && key.Connection == connectionID {
			delete(m.subscriptions, key)
		}
	}
}
