package data

import (
	"bytes"
	"errors"
	"io"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/omniviewdev/omniview/internal/appstate"
	logging "github.com/omniviewdev/plugin-sdk/log"
)

func testController(t *testing.T) (Controller, *appstate.Service) {
	t.Helper()
	state := appstate.NewTestService(t)
	return NewController(logging.NewNop(), state), state
}

// brokenState fails every root lookup.
type brokenState struct{ err error }

func (b brokenState) PluginData(string) (*appstate.ScopedRoot, error) { return nil, b.err }
func (b brokenState) PluginDataIfExists(string) (*appstate.ScopedRoot, bool, error) {
	return nil, false, b.err
}

func TestMaximumLengthDataKeyRemainsUsable(t *testing.T) {
	c, _ := testController(t)
	key := strings.Repeat("k", 250)
	if err := c.Set("test", key, true); err != nil {
		t.Fatal(err)
	}
	value, err := c.Get("test", key)
	if err != nil || value != true {
		t.Fatalf("valid data key could not be read: %v, %v", value, err)
	}
}

func TestSnapshotAbsentNullAndPersistedRevision(t *testing.T) {
	c, state := testController(t)
	missing, err := c.GetSnapshot("test", "counts")
	if err != nil || missing.Value != nil || missing.Revision != "" {
		t.Fatalf("missing snapshot: %#v, %v", missing, err)
	}
	ok, err := c.CompareAndSwap("test", "counts", "", nil)
	if err != nil || !ok {
		t.Fatalf("create null: %v, %v", ok, err)
	}
	null, err := c.GetSnapshot("test", "counts")
	if err != nil || null.Value != nil || len(null.Revision) != 64 {
		t.Fatalf("null snapshot: %#v, %v", null, err)
	}
	ok, err = c.CompareAndSwap("test", "counts", "", "overwrite")
	if err != nil || ok {
		t.Fatalf("absent revision overwrote null: %v, %v", ok, err)
	}
	reopened := NewController(logging.NewNop(), state)
	stored, err := reopened.GetSnapshot("test", "counts")
	if err != nil || stored.Revision != null.Revision || stored.Value != nil {
		t.Fatalf("reopened snapshot: %#v, %v", stored, err)
	}
	if err := c.Delete("test", "counts"); err != nil {
		t.Fatal(err)
	}
	deleted, err := c.GetSnapshot("test", "counts")
	if err != nil || deleted.Revision != "" {
		t.Fatalf("deleted: %#v, %v", deleted, err)
	}
}

func TestStaleRevisionNeverOverwrites(t *testing.T) {
	c, state := testController(t)
	if err := c.Set("test", "counts", map[string]int{"count": 1}); err != nil {
		t.Fatal(err)
	}
	first, err := c.GetSnapshot("test", "counts")
	if err != nil {
		t.Fatal(err)
	}
	if err := c.Set("test", "counts", map[string]int{"count": 2, "existing": 9}); err != nil {
		t.Fatal(err)
	}
	reopened := NewController(logging.NewNop(), state)
	persisted, err := reopened.GetSnapshot("test", "counts")
	if err != nil {
		t.Fatal(err)
	}
	fields := persisted.Value.(map[string]any)
	if fields["count"] != float64(2) || fields["existing"] != float64(9) {
		t.Fatalf("persisted fields lost across controller construction: %#v", fields)
	}
	root, err := state.PluginData("test")
	if err != nil {
		t.Fatal(err)
	}
	before, err := root.ReadFile("counts.json")
	if err != nil {
		t.Fatal(err)
	}
	ok, err := c.CompareAndSwap("test", "counts", first.Revision, map[string]int{"count": 3})
	if err != nil || ok {
		t.Fatalf("stale CAS: %v, %v", ok, err)
	}
	after, err := root.ReadFile("counts.json")
	if err != nil || !bytes.Equal(before, after) {
		t.Fatalf("stale CAS changed bytes: %s, %v", after, err)
	}
}

func TestCommittedReaderSurvivesReplacement(t *testing.T) {
	c, state := testController(t)
	if err := c.Set("test", "counts", 1); err != nil {
		t.Fatal(err)
	}
	previous, err := c.GetSnapshot("test", "counts")
	if err != nil {
		t.Fatal(err)
	}
	root, err := state.PluginData("test")
	if err != nil {
		t.Fatal(err)
	}
	reader, err := root.OpenFile("counts.json", os.O_RDONLY, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	ok, writeErr := c.CompareAndSwap("test", "counts", previous.Revision, 200)
	if writeErr == nil && !ok {
		t.Fatal("unchanged revision was rejected")
	}
	committed, err := io.ReadAll(reader)
	if err != nil || string(committed) != "1" {
		t.Fatalf("replacement changed previously opened committed data: %q, %v", committed, err)
	}
	if writeErr != nil {
		// Some platforms forbid replacement while the destination is open.
		unchanged, err := c.GetSnapshot("test", "counts")
		if err != nil || unchanged.Revision != previous.Revision || unchanged.Value != float64(1) {
			t.Fatalf("failed replacement changed committed value: %#v, %v", unchanged, err)
		}
		if err := reader.Close(); err != nil {
			t.Fatal(err)
		}
		ok, err := c.CompareAndSwap("test", "counts", previous.Revision, 200)
		if err != nil || !ok {
			t.Fatalf("replace after releasing reader: %v, %v", ok, err)
		}
	}
	current, err := c.GetSnapshot("test", "counts")
	if err != nil || current.Value != float64(200) || current.Revision == previous.Revision {
		t.Fatalf("replacement was not committed: %#v, %v", current, err)
	}
}

func TestConcurrentClientsRetainIncrements(t *testing.T) {
	c, _ := testController(t)
	if err := c.Set("test", "counts", map[string]int{"count": 1, "existing": 9}); err != nil {
		t.Fatal(err)
	}
	var clients sync.WaitGroup
	for range 8 {
		clients.Add(1)
		go func() {
			defer clients.Done()
			for range 20 {
				for {
					snapshot, err := c.GetSnapshot("test", "counts")
					if err != nil {
						t.Error(err)
						return
					}
					value := snapshot.Value.(map[string]any)
					value["count"] = value["count"].(float64) + 1
					ok, err := c.CompareAndSwap("test", "counts", snapshot.Revision, value)
					if err != nil {
						t.Error(err)
						return
					}
					if ok {
						break
					}
				}
			}
		}()
	}
	clients.Wait()
	value, err := c.Get("test", "counts")
	if err != nil {
		t.Fatal(err)
	}
	counts := value.(map[string]any)
	if counts["count"] != float64(161) || counts["existing"] != float64(9) {
		t.Fatalf("lost update: %#v", counts)
	}
}

func TestFailedReadsNeverOverwrite(t *testing.T) {
	c, state := testController(t)
	root, err := state.PluginData("test")
	if err != nil {
		t.Fatal(err)
	}
	corrupt := []byte("{broken json")
	if err := root.WriteFile("counts.json", corrupt, dataFilePerm); err != nil {
		t.Fatal(err)
	}
	if _, err := c.GetSnapshot("test", "counts"); err == nil {
		t.Fatal("corrupt snapshot succeeded")
	}
	if ok, err := c.CompareAndSwap("test", "counts", "", 1); err == nil || ok {
		t.Fatalf("corrupt CAS: %v, %v", ok, err)
	}
	after, err := root.ReadFile("counts.json")
	if err != nil || !bytes.Equal(after, corrupt) {
		t.Fatalf("corrupt file overwritten: %s, %v", after, err)
	}
	failure := errors.New("scoped root unavailable")
	broken := NewController(logging.NewNop(), brokenState{err: failure})
	if ok, err := broken.CompareAndSwap("test", "counts", "", 1); ok || !errors.Is(err, failure) {
		t.Fatalf("failed root CAS: %v, %v", ok, err)
	}
	if _, err := broken.GetSnapshot("test", "counts"); !errors.Is(err, failure) {
		t.Fatalf("failed root snapshot: %v", err)
	}
	// A directory at the key path produces a real filesystem read failure.
	if err := root.Remove("counts.json"); err != nil {
		t.Fatal(err)
	}
	if err := root.MkdirAll("counts.json", 0o700); err != nil {
		t.Fatal(err)
	}
	if ok, err := c.CompareAndSwap("test", "counts", "", 2); ok || err == nil || errors.Is(err, os.ErrNotExist) {
		t.Fatalf("unreadable CAS: %v, %v", ok, err)
	}
}
