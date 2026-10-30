package resource

import "sync"

// inventorySubscriptions invokes subscribers only after the committing method
// releases resource locks. Subscribers may immediately read the new inventory.
type inventorySubscriptions struct {
	mu        sync.Mutex
	next      uint64
	callbacks map[uint64]func()
}

func (c *controller) OnInventoryChange(callback func()) func() {
	c.inventory.mu.Lock()
	c.inventory.next++
	id := c.inventory.next
	if c.inventory.callbacks == nil {
		c.inventory.callbacks = make(map[uint64]func())
	}
	c.inventory.callbacks[id] = callback
	c.inventory.mu.Unlock()
	var once sync.Once
	return func() {
		once.Do(func() { c.inventory.mu.Lock(); delete(c.inventory.callbacks, id); c.inventory.mu.Unlock() })
	}
}

func (c *controller) notifyInventory() {
	c.inventory.mu.Lock()
	callbacks := make([]func(), 0, len(c.inventory.callbacks))
	for _, callback := range c.inventory.callbacks {
		if callback != nil {
			callbacks = append(callbacks, callback)
		}
	}
	c.inventory.mu.Unlock()
	for _, callback := range callbacks {
		callback()
	}
}
