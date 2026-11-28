package linkresolve

import (
	"container/list"
	"sync"
	"time"
)

// cache holds the answers of the last ttl, at most size of them, the least recently used going first. Only answers that found something are
// kept, and each is asked of the file system again when it is used (call.stillThere), so a deleted file is told as gone and a file made after
// a miss is found at once: what the cache saves is the walk of the path and the scan, not the last look. The host cannot see writes under a
// directory (VS Code resets on a write to the terminal; the host has no such event), so the time is the bound.
type cache struct {
	mu    sync.Mutex
	size  int
	ttl   time.Duration
	now   func() time.Time
	order *list.List
	byKey map[string]*list.Element
}

type cached struct {
	key string
	res Result
	at  time.Time
}

func newCache(size int, ttl time.Duration, now func() time.Time) *cache {
	return &cache{size: size, ttl: ttl, now: now, order: list.New(), byKey: make(map[string]*list.Element, size)}
}

func (c *cache) get(key string) (Result, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	el, ok := c.byKey[key]
	if !ok {
		return Result{}, false
	}
	entry, _ := el.Value.(*cached)
	if c.now().Sub(entry.at) >= c.ttl {
		c.order.Remove(el)
		delete(c.byKey, key)
		return Result{}, false
	}
	c.order.MoveToFront(el)
	return entry.res, true
}

func (c *cache) put(key string, res Result) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if el, ok := c.byKey[key]; ok {
		el.Value = &cached{key, res, c.now()}
		c.order.MoveToFront(el)
		return
	}
	c.byKey[key] = c.order.PushFront(&cached{key, res, c.now()})
	for c.order.Len() > c.size {
		oldest := c.order.Back()
		entry, _ := oldest.Value.(*cached)
		delete(c.byKey, entry.key)
		c.order.Remove(oldest)
	}
}

func (c *cache) drop(key string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if el, ok := c.byKey[key]; ok {
		c.order.Remove(el)
		delete(c.byKey, key)
	}
}

func (c *cache) len() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.order.Len()
}
