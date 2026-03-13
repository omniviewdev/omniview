package registry

import (
	"fmt"
	"sync"
	"testing"
	"time"
)

func makeEntry(pluginID, connectionID, resourceKey, namespace, id string, labels map[string]string) ResourceEntry {
	return ResourceEntry{
		PluginID:     pluginID,
		ConnectionID: connectionID,
		ResourceKey:  resourceKey,
		Namespace:    namespace,
		ID:           id,
		UID:          pluginID + "-" + connectionID + "-" + id,
		Labels:       labels,
		CreatedAt:    time.Now(),
	}
}

func TestMemoryStore_PutAndGet(t *testing.T) {
	s := NewMemoryStore()
	entry := makeEntry("plugin-a", "conn-1", "core::v1::Pod", "default", "my-pod", nil)

	old, existed := s.Put(entry)
	if old != nil || existed {
		t.Fatalf("expected no previous entry, got existed=%v", existed)
	}

	got, ok := s.Get("plugin-a", "conn-1", "core::v1::Pod", "default", "my-pod")
	if !ok {
		t.Fatal("expected entry to exist after Put")
	}
	if got.ID != "my-pod" {
		t.Errorf("expected ID=my-pod, got %q", got.ID)
	}
}

func TestMemoryStore_PutReturnsOld(t *testing.T) {
	s := NewMemoryStore()
	entry := makeEntry("plugin-a", "conn-1", "core::v1::Pod", "default", "my-pod", map[string]string{"app": "nginx"})
	s.Put(entry)

	updated := entry
	updated.Labels = map[string]string{"app": "apache"}
	old, existed := s.Put(updated)

	if !existed {
		t.Fatal("expected existed=true on second Put")
	}
	if old == nil {
		t.Fatal("expected non-nil old entry")
	}
	if old.Labels["app"] != "nginx" {
		t.Errorf("expected old label app=nginx, got %q", old.Labels["app"])
	}

	// Verify old label index is cleaned up
	results := s.ScanByLabel("plugin-a", "conn-1", "core::v1::Pod", map[string]string{"app": "nginx"})
	if len(results) != 0 {
		t.Errorf("expected old label index to be cleaned up, got %d results", len(results))
	}
}

func TestMemoryStore_Delete(t *testing.T) {
	s := NewMemoryStore()
	entry := makeEntry("plugin-a", "conn-1", "core::v1::Pod", "default", "my-pod", nil)
	s.Put(entry)

	deleted, ok := s.Delete("plugin-a", "conn-1", "core::v1::Pod", "default", "my-pod")
	if !ok {
		t.Fatal("expected Delete to return true")
	}
	if deleted.ID != "my-pod" {
		t.Errorf("expected deleted ID=my-pod, got %q", deleted.ID)
	}

	_, ok = s.Get("plugin-a", "conn-1", "core::v1::Pod", "default", "my-pod")
	if ok {
		t.Fatal("expected entry to be gone after Delete")
	}
}

func TestMemoryStore_DeleteByConnection(t *testing.T) {
	s := NewMemoryStore()

	// Add entries for conn-1
	for i := 0; i < 3; i++ {
		e := makeEntry("plugin-a", "conn-1", "core::v1::Pod", "default", fmt.Sprintf("pod-%d", i), nil)
		s.Put(e)
	}
	// Add an entry for a different connection
	s.Put(makeEntry("plugin-a", "conn-2", "core::v1::Pod", "default", "pod-other", nil))

	removed := s.DeleteByConnection("plugin-a", "conn-1")
	if len(removed) != 3 {
		t.Fatalf("expected 3 removed entries, got %d", len(removed))
	}

	// conn-1 entries should be gone
	for i := 0; i < 3; i++ {
		_, ok := s.Get("plugin-a", "conn-1", "core::v1::Pod", "default", fmt.Sprintf("pod-%d", i))
		if ok {
			t.Errorf("expected pod-%d to be deleted", i)
		}
	}

	// conn-2 entry should still exist
	_, ok := s.Get("plugin-a", "conn-2", "core::v1::Pod", "default", "pod-other")
	if !ok {
		t.Error("expected conn-2 entry to remain after DeleteByConnection for conn-1")
	}
}

func TestMemoryStore_GetNotFound(t *testing.T) {
	s := NewMemoryStore()
	got, ok := s.Get("plugin-x", "conn-x", "core::v1::Pod", "default", "nonexistent")
	if ok || got != nil {
		t.Errorf("expected not found, got ok=%v, entry=%v", ok, got)
	}
}

func TestMemoryStore_DeleteNotFound(t *testing.T) {
	s := NewMemoryStore()
	deleted, ok := s.Delete("plugin-x", "conn-x", "core::v1::Pod", "default", "nonexistent")
	if ok || deleted != nil {
		t.Errorf("expected not found, got ok=%v, entry=%v", ok, deleted)
	}
}

func TestMemoryStore_ScanByLabel(t *testing.T) {
	s := NewMemoryStore()

	// Two entries with "app=nginx"
	s.Put(makeEntry("p", "c", "core::v1::Pod", "default", "pod-1", map[string]string{"app": "nginx", "env": "prod"}))
	s.Put(makeEntry("p", "c", "core::v1::Pod", "default", "pod-2", map[string]string{"app": "nginx", "env": "staging"}))
	// One with different app
	s.Put(makeEntry("p", "c", "core::v1::Pod", "default", "pod-3", map[string]string{"app": "apache", "env": "prod"}))

	t.Run("single label match", func(t *testing.T) {
		results := s.ScanByLabel("p", "c", "core::v1::Pod", map[string]string{"app": "nginx"})
		if len(results) != 2 {
			t.Errorf("expected 2 results for app=nginx, got %d", len(results))
		}
	})

	t.Run("multi-label intersection", func(t *testing.T) {
		results := s.ScanByLabel("p", "c", "core::v1::Pod", map[string]string{"app": "nginx", "env": "prod"})
		if len(results) != 1 {
			t.Fatalf("expected 1 result for app=nginx,env=prod, got %d", len(results))
		}
		if results[0].ID != "pod-1" {
			t.Errorf("expected pod-1, got %q", results[0].ID)
		}
	})

	t.Run("no match", func(t *testing.T) {
		results := s.ScanByLabel("p", "c", "core::v1::Pod", map[string]string{"app": "doesnotexist"})
		if len(results) != 0 {
			t.Errorf("expected 0 results, got %d", len(results))
		}
	})

	t.Run("empty selector returns nil", func(t *testing.T) {
		results := s.ScanByLabel("p", "c", "core::v1::Pod", map[string]string{})
		if results != nil {
			t.Errorf("expected nil for empty selector, got %v", results)
		}
	})
}

func TestMemoryStore_ScanByLabel_ScopedToResourceKey(t *testing.T) {
	s := NewMemoryStore()

	// Same label, different resource keys
	s.Put(makeEntry("p", "c", "core::v1::Pod", "default", "pod-1", map[string]string{"app": "nginx"}))
	s.Put(makeEntry("p", "c", "core::v1::Service", "default", "svc-1", map[string]string{"app": "nginx"}))

	results := s.ScanByLabel("p", "c", "core::v1::Pod", map[string]string{"app": "nginx"})
	if len(results) != 1 {
		t.Fatalf("expected 1 result scoped to Pod, got %d", len(results))
	}
	if results[0].ResourceKey != "core::v1::Pod" {
		t.Errorf("expected Pod resourceKey, got %q", results[0].ResourceKey)
	}
}

func TestMemoryStore_ScanByLabel_UpdateRemovesOldLabels(t *testing.T) {
	s := NewMemoryStore()

	entry := makeEntry("p", "c", "core::v1::Pod", "default", "pod-1", map[string]string{"app": "nginx"})
	s.Put(entry)

	// Update with new label, removing old
	updated := entry
	updated.Labels = map[string]string{"app": "apache"}
	s.Put(updated)

	// Old label should not match
	results := s.ScanByLabel("p", "c", "core::v1::Pod", map[string]string{"app": "nginx"})
	if len(results) != 0 {
		t.Errorf("expected 0 results for old label after update, got %d", len(results))
	}

	// New label should match
	results = s.ScanByLabel("p", "c", "core::v1::Pod", map[string]string{"app": "apache"})
	if len(results) != 1 {
		t.Errorf("expected 1 result for new label after update, got %d", len(results))
	}
}

func TestMemoryStore_ScanByResourceKey(t *testing.T) {
	s := NewMemoryStore()

	for i := 0; i < 5; i++ {
		s.Put(makeEntry("p", "c", "core::v1::Pod", "default", fmt.Sprintf("pod-%d", i), nil))
	}
	s.Put(makeEntry("p", "c", "core::v1::Service", "default", "svc-1", nil))

	results := s.ScanByResourceKey("p", "c", "core::v1::Pod")
	if len(results) != 5 {
		t.Errorf("expected 5 Pod entries, got %d", len(results))
	}

	for _, r := range results {
		if r.ResourceKey != "core::v1::Pod" {
			t.Errorf("expected resourceKey=core::v1::Pod, got %q", r.ResourceKey)
		}
	}

	// Services should not appear
	svcResults := s.ScanByResourceKey("p", "c", "core::v1::Service")
	if len(svcResults) != 1 {
		t.Errorf("expected 1 Service entry, got %d", len(svcResults))
	}
}

func TestMemoryStore_ConcurrentAccess(t *testing.T) {
	s := NewMemoryStore()
	const goroutines = 20
	const opsPerGoroutine = 50

	var wg sync.WaitGroup
	wg.Add(goroutines)

	for g := 0; g < goroutines; g++ {
		g := g
		go func() {
			defer wg.Done()
			for i := 0; i < opsPerGoroutine; i++ {
				id := fmt.Sprintf("pod-%d-%d", g, i)
				entry := makeEntry(
					"plugin-a", fmt.Sprintf("conn-%d", g%3),
					"core::v1::Pod", "default", id,
					map[string]string{"worker": fmt.Sprintf("%d", g)},
				)
				s.Put(entry)
				s.Get("plugin-a", fmt.Sprintf("conn-%d", g%3), "core::v1::Pod", "default", id)
				s.ScanByLabel("plugin-a", fmt.Sprintf("conn-%d", g%3), "core::v1::Pod",
					map[string]string{"worker": fmt.Sprintf("%d", g)})
				s.ScanByResourceKey("plugin-a", fmt.Sprintf("conn-%d", g%3), "core::v1::Pod")
				if i%10 == 0 {
					s.Delete("plugin-a", fmt.Sprintf("conn-%d", g%3), "core::v1::Pod", "default", id)
				}
			}
		}()
	}

	wg.Wait()
	// No race detector failures = pass
}
