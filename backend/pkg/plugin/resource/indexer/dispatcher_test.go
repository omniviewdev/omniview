package indexer

import (
	"encoding/json"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/registry"
)

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

type recordingIndexer struct {
	name    string
	mu      sync.Mutex
	adds    []registry.ResourceEntry
	updates []registry.ResourceEntry
	deletes []registry.ResourceEntry
}

func (r *recordingIndexer) Name() string { return r.name }

func (r *recordingIndexer) OnAdd(entry registry.ResourceEntry, _ json.RawMessage) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.adds = append(r.adds, entry)
}

func (r *recordingIndexer) OnUpdate(old registry.ResourceEntry, new_ registry.ResourceEntry, _ json.RawMessage) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.updates = append(r.updates, new_)
}

func (r *recordingIndexer) OnDelete(entry registry.ResourceEntry) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.deletes = append(r.deletes, entry)
}

func (r *recordingIndexer) addCount() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.adds)
}

func (r *recordingIndexer) updateCount() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.updates)
}

func (r *recordingIndexer) deleteCount() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.deletes)
}

// ---------------------------------------------------------------------------

type callbackIndexer struct {
	name     string
	onAdd    func(registry.ResourceEntry, json.RawMessage)
	onUpdate func(registry.ResourceEntry, registry.ResourceEntry, json.RawMessage)
	onDelete func(registry.ResourceEntry)
}

func (c *callbackIndexer) Name() string { return c.name }

func (c *callbackIndexer) OnAdd(entry registry.ResourceEntry, raw json.RawMessage) {
	if c.onAdd != nil {
		c.onAdd(entry, raw)
	}
}

func (c *callbackIndexer) OnUpdate(old registry.ResourceEntry, new_ registry.ResourceEntry, raw json.RawMessage) {
	if c.onUpdate != nil {
		c.onUpdate(old, new_, raw)
	}
}

func (c *callbackIndexer) OnDelete(entry registry.ResourceEntry) {
	if c.onDelete != nil {
		c.onDelete(entry)
	}
}

// ---------------------------------------------------------------------------

type panickingIndexer struct{}

func (p *panickingIndexer) Name() string { return "panicker" }

func (p *panickingIndexer) OnAdd(_ registry.ResourceEntry, _ json.RawMessage) {
	panic("intentional panic in OnAdd")
}

func (p *panickingIndexer) OnUpdate(_, _ registry.ResourceEntry, _ json.RawMessage) {
	panic("intentional panic in OnUpdate")
}

func (p *panickingIndexer) OnDelete(_ registry.ResourceEntry) {
	panic("intentional panic in OnDelete")
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

func waitFor(t *testing.T, condition func() bool, timeout time.Duration, msg string) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("timed out waiting for: %s", msg)
}

func testEntry(id string) registry.ResourceEntry {
	return registry.ResourceEntry{
		PluginID:     "k8s",
		ConnectionID: "c1",
		ResourceKey:  "core::v1::Pod",
		ID:           id,
		Namespace:    "default",
		UID:          "uid-" + id,
	}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

func TestDispatcher_DeliverAddEvent(t *testing.T) {
	rec := &recordingIndexer{name: "rec"}
	d := NewDispatcher([]ResourceIndexer{rec})
	d.Start()

	entry := testEntry("pod-1")
	d.Enqueue(Event{Type: EventAdd, Entry: entry, Raw: json.RawMessage(`{}`)})

	waitFor(t, func() bool { return rec.addCount() == 1 }, 2*time.Second, "add event delivered")
	d.Stop()

	if rec.addCount() != 1 {
		t.Fatalf("expected 1 add, got %d", rec.addCount())
	}
	if rec.updateCount() != 0 || rec.deleteCount() != 0 {
		t.Fatal("unexpected update or delete events")
	}
}

func TestDispatcher_DeliverUpdateEvent(t *testing.T) {
	rec := &recordingIndexer{name: "rec"}
	d := NewDispatcher([]ResourceIndexer{rec})
	d.Start()

	old := testEntry("pod-1")
	new_ := testEntry("pod-1")
	new_.Labels = map[string]string{"version": "2"}

	d.Enqueue(Event{Type: EventUpdate, Entry: new_, Old: &old, Raw: json.RawMessage(`{}`)})

	waitFor(t, func() bool { return rec.updateCount() == 1 }, 2*time.Second, "update event delivered")
	d.Stop()

	if rec.updateCount() != 1 {
		t.Fatalf("expected 1 update, got %d", rec.updateCount())
	}
	if rec.addCount() != 0 || rec.deleteCount() != 0 {
		t.Fatal("unexpected add or delete events")
	}
}

func TestDispatcher_DeliverUpdateEvent_NilOldFallsBackToAdd(t *testing.T) {
	rec := &recordingIndexer{name: "rec"}
	d := NewDispatcher([]ResourceIndexer{rec})
	d.Start()

	entry := testEntry("pod-1")
	// Old is nil — dispatcher should call OnAdd instead
	d.Enqueue(Event{Type: EventUpdate, Entry: entry, Old: nil, Raw: json.RawMessage(`{}`)})

	waitFor(t, func() bool { return rec.addCount() == 1 }, 2*time.Second, "fallback add delivered")
	d.Stop()

	if rec.addCount() != 1 {
		t.Fatalf("expected fallback add, got addCount=%d updateCount=%d", rec.addCount(), rec.updateCount())
	}
}

func TestDispatcher_DeliverDeleteEvent(t *testing.T) {
	rec := &recordingIndexer{name: "rec"}
	d := NewDispatcher([]ResourceIndexer{rec})
	d.Start()

	entry := testEntry("pod-1")
	d.Enqueue(Event{Type: EventDelete, Entry: entry})

	waitFor(t, func() bool { return rec.deleteCount() == 1 }, 2*time.Second, "delete event delivered")
	d.Stop()

	if rec.deleteCount() != 1 {
		t.Fatalf("expected 1 delete, got %d", rec.deleteCount())
	}
	if rec.addCount() != 0 || rec.updateCount() != 0 {
		t.Fatal("unexpected add or update events")
	}
}

func TestDispatcher_MultipleIndexers(t *testing.T) {
	rec1 := &recordingIndexer{name: "rec1"}
	rec2 := &recordingIndexer{name: "rec2"}
	rec3 := &recordingIndexer{name: "rec3"}

	d := NewDispatcher([]ResourceIndexer{rec1, rec2, rec3})
	d.Start()

	entry := testEntry("pod-1")
	d.Enqueue(Event{Type: EventAdd, Entry: entry, Raw: json.RawMessage(`{}`)})

	waitFor(t, func() bool {
		return rec1.addCount() == 1 && rec2.addCount() == 1 && rec3.addCount() == 1
	}, 2*time.Second, "all indexers received add event")

	d.Stop()

	for _, rec := range []*recordingIndexer{rec1, rec2, rec3} {
		if rec.addCount() != 1 {
			t.Errorf("indexer %s: expected 1 add, got %d", rec.name, rec.addCount())
		}
	}
}

func TestDispatcher_OrderPreserved(t *testing.T) {
	const numEvents = 100

	var mu sync.Mutex
	var received []string

	cb := &callbackIndexer{
		name: "order-checker",
		onAdd: func(entry registry.ResourceEntry, _ json.RawMessage) {
			mu.Lock()
			defer mu.Unlock()
			received = append(received, entry.ID)
		},
	}

	d := NewDispatcher([]ResourceIndexer{cb})
	d.Start()

	for i := 0; i < numEvents; i++ {
		id := fmt.Sprintf("pod-%03d", i)
		d.Enqueue(Event{Type: EventAdd, Entry: testEntry(id), Raw: json.RawMessage(`{}`)})
	}

	waitFor(t, func() bool {
		mu.Lock()
		defer mu.Unlock()
		return len(received) == numEvents
	}, 5*time.Second, "all 100 events received")

	d.Stop()

	mu.Lock()
	defer mu.Unlock()

	if len(received) != numEvents {
		t.Fatalf("expected %d events, got %d", numEvents, len(received))
	}

	for i, id := range received {
		expected := fmt.Sprintf("pod-%03d", i)
		if id != expected {
			t.Fatalf("order violation at index %d: expected %s, got %s", i, expected, id)
		}
	}
}

func TestDispatcher_PanicRecovery(t *testing.T) {
	panicker := &panickingIndexer{}
	rec := &recordingIndexer{name: "survivor"}

	// panicker is listed first; survivor must still receive the event
	d := NewDispatcher([]ResourceIndexer{panicker, rec})
	d.Start()

	entry := testEntry("pod-1")
	d.Enqueue(Event{Type: EventAdd, Entry: entry, Raw: json.RawMessage(`{}`)})

	waitFor(t, func() bool { return rec.addCount() == 1 }, 2*time.Second, "survivor received event after panic")
	d.Stop()

	if rec.addCount() != 1 {
		t.Fatalf("survivor expected 1 add after panic recovery, got %d", rec.addCount())
	}
}

func TestDispatcher_StopDrains(t *testing.T) {
	const numEvents = 500

	rec := &recordingIndexer{name: "drainer"}
	d := NewDispatcher([]ResourceIndexer{rec})
	d.Start()

	for i := 0; i < numEvents; i++ {
		d.Enqueue(Event{
			Type:  EventAdd,
			Entry: testEntry(fmt.Sprintf("pod-%d", i)),
			Raw:   json.RawMessage(`{}`),
		})
	}

	// Stop must block until all queued events are processed.
	d.Stop()

	if rec.addCount() != numEvents {
		t.Fatalf("expected all %d events to be processed before Stop returns, got %d", numEvents, rec.addCount())
	}
}
