package resource

import (
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestSubscriptionManager_Subscribe_FirstSubscriber(t *testing.T) {
	m := newSubscriptionManager()
	count := m.Subscribe("p1", "c1", "pods")
	assert.Equal(t, 1, count)
}

func TestSubscriptionManager_Subscribe_Increments(t *testing.T) {
	m := newSubscriptionManager()
	m.Subscribe("p1", "c1", "pods")
	count := m.Subscribe("p1", "c1", "pods")
	assert.Equal(t, 2, count)
}

func TestSubscriptionManager_Unsubscribe_Decrements(t *testing.T) {
	m := newSubscriptionManager()
	m.Subscribe("p1", "c1", "pods")
	m.Subscribe("p1", "c1", "pods")
	count := m.Unsubscribe("p1", "c1", "pods")
	assert.Equal(t, 1, count)
}

func TestSubscriptionManager_Unsubscribe_RemovesAtZero(t *testing.T) {
	m := newSubscriptionManager()
	m.Subscribe("p1", "c1", "pods")
	count := m.Unsubscribe("p1", "c1", "pods")
	assert.Equal(t, 0, count)

	// Key should be deleted from the map entirely.
	m.mu.RLock()
	_, exists := m.subscriptions[subscriptionKey("p1", "c1", "pods")]
	m.mu.RUnlock()
	assert.False(t, exists)
}

func TestSubscriptionManager_Unsubscribe_NeverNegative(t *testing.T) {
	m := newSubscriptionManager()
	count := m.Unsubscribe("p1", "c1", "pods")
	assert.Equal(t, 0, count)
	// Unsubscribe again — still 0, no panic.
	count = m.Unsubscribe("p1", "c1", "pods")
	assert.Equal(t, 0, count)
}

func TestSubscriptionManager_IsSubscribed_True(t *testing.T) {
	m := newSubscriptionManager()
	m.Subscribe("p1", "c1", "pods")
	assert.True(t, m.IsSubscribed("p1", "c1", "pods"))
}

func TestSubscriptionManager_IsSubscribed_False(t *testing.T) {
	m := newSubscriptionManager()
	assert.False(t, m.IsSubscribed("p1", "c1", "pods"))
}

func TestSubscriptionManager_IsSubscribed_AfterRemoveAll(t *testing.T) {
	m := newSubscriptionManager()
	m.Subscribe("p1", "c1", "pods")
	m.Subscribe("p1", "c1", "svcs")
	m.RemoveAll("p1")
	assert.False(t, m.IsSubscribed("p1", "c1", "pods"))
	assert.False(t, m.IsSubscribed("p1", "c1", "svcs"))
}

func TestSubscriptionManager_RemoveAll_OnlyTargetPlugin(t *testing.T) {
	m := newSubscriptionManager()
	m.Subscribe("p1", "c1", "pods")
	m.Subscribe("p2", "c1", "pods")
	m.RemoveAll("p1")
	assert.False(t, m.IsSubscribed("p1", "c1", "pods"))
	assert.True(t, m.IsSubscribed("p2", "c1", "pods"))
}

func TestSubscriptionManager_RemoveAll_EmptyMap(t *testing.T) {
	m := newSubscriptionManager()
	assert.NotPanics(t, func() {
		m.RemoveAll("nonexistent")
	})
}

func TestSubscriptionManager_DifferentKeys(t *testing.T) {
	m := newSubscriptionManager()
	m.Subscribe("p1", "c1", "pods")
	m.Subscribe("p1", "c2", "svcs")
	assert.True(t, m.IsSubscribed("p1", "c1", "pods"))
	assert.True(t, m.IsSubscribed("p1", "c2", "svcs"))
	assert.False(t, m.IsSubscribed("p1", "c1", "svcs"))
}

func TestSubscriptionManager_Concurrent_SubscribeUnsubscribe(t *testing.T) {
	m := newSubscriptionManager()
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			m.Subscribe("p1", "c1", "pods")
			m.Unsubscribe("p1", "c1", "pods")
		}()
	}
	wg.Wait()
}

func TestSubscriptionManager_Concurrent_RemoveAll(t *testing.T) {
	m := newSubscriptionManager()
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(2)
		go func() {
			defer wg.Done()
			m.Subscribe("p1", "c1", "pods")
		}()
		go func() {
			defer wg.Done()
			m.RemoveAll("p1")
		}()
	}
	wg.Wait()
}

func TestSubscriptionManager_SubscriptionKey_Format(t *testing.T) {
	key := subscriptionKey("plugin-a", "conn-1", "core::v1::Pod")
	assert.Equal(t, "plugin-a/conn-1/core::v1::Pod", key)
}
