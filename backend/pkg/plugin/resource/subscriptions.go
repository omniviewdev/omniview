package resource

import "sync"

// subscriptionManager handles ref-counted frontend subscriptions for resource events.
// ADD/UPDATE/DELETE events are only forwarded when at least one subscriber exists.
// STATE events bypass the gate and always flow.
type subscriptionManager struct {
	mu            sync.RWMutex
	subscriptions map[string]int // key: "pluginID/connectionID/resourceKey" → refcount
}

func newSubscriptionManager() *subscriptionManager {
	return &subscriptionManager{
		subscriptions: make(map[string]int),
	}
}

// subscriptionKey builds the map key for a resource subscription.
func subscriptionKey(pluginID, connectionID, resourceKey string) string {
	return pluginID + "/" + connectionID + "/" + resourceKey
}

// Subscribe increments the ref count for a resource.
func (m *subscriptionManager) Subscribe(pluginID, connectionID, resourceKey string) int {
	key := subscriptionKey(pluginID, connectionID, resourceKey)
	m.mu.Lock()
	m.subscriptions[key]++
	count := m.subscriptions[key]
	m.mu.Unlock()
	return count
}

// Unsubscribe decrements the ref count. Returns the new count.
func (m *subscriptionManager) Unsubscribe(pluginID, connectionID, resourceKey string) int {
	key := subscriptionKey(pluginID, connectionID, resourceKey)
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.subscriptions[key] > 1 {
		m.subscriptions[key]--
		return m.subscriptions[key]
	}
	delete(m.subscriptions, key)
	return 0
}

// IsSubscribed returns true if at least one subscriber exists.
func (m *subscriptionManager) IsSubscribed(pluginID, connectionID, resourceKey string) bool {
	key := subscriptionKey(pluginID, connectionID, resourceKey)
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.subscriptions[key] > 0
}

// RemoveAll removes all subscriptions for a plugin.
func (m *subscriptionManager) RemoveAll(pluginID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	prefix := pluginID + "/"
	for key := range m.subscriptions {
		if len(key) >= len(prefix) && key[:len(prefix)] == prefix {
			delete(m.subscriptions, key)
		}
	}
}
