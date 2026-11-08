package data

import (
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"sort"
	"testing"

	"github.com/omniviewdev/omniview/internal/appstate"
	logging "github.com/omniviewdev/plugin-sdk/log"
)

func stateController(t *testing.T) (Controller, *appstate.Service) {
	t.Helper()
	state := appstate.NewTestService(t)
	return NewController(logging.NewNop(), state), state
}

func listNames(t *testing.T, dir string) []string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		names = append(names, e.Name())
	}
	sort.Strings(names)
	return names
}

func openFDs(t *testing.T) int {
	dir, err := os.Open("/dev/fd")
	if err != nil {
		t.Fatal(err)
	}
	defer dir.Close()
	names, err := dir.Readdirnames(-1)
	if err != nil {
		t.Fatal(err)
	}
	return len(names)
}

func TestReadsOfNovelPluginIDsCreateNothingAndLeakNoDescriptors(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("/dev/fd is unavailable on windows")
	}
	c, state := stateController(t)
	pluginsDir := filepath.Join(state.Root(), "plugins")

	dirsBefore := listNames(t, pluginsDir)
	fdsBefore := openFDs(t)
	for i := range 250 {
		id := fmt.Sprintf("novel-plugin-%d", i)
		value, err := c.Get(id, "counts")
		if err != nil || value != nil {
			t.Fatalf("Get(%q) = %v, %v; want nil, nil", id, value, err)
		}
		snap, err := c.GetSnapshot(id, "counts")
		if err != nil || snap.Value != nil || snap.Revision != "" {
			t.Fatalf("GetSnapshot(%q) = %#v, %v; want empty", id, snap, err)
		}
		keys, err := c.Keys(id)
		if err != nil || keys == nil || len(keys) != 0 {
			t.Fatalf("Keys(%q) = %#v, %v; want empty non-nil slice", id, keys, err)
		}
	}
	if after := listNames(t, pluginsDir); !reflect.DeepEqual(dirsBefore, after) {
		t.Fatalf("reads created directories: before %v after %d entries", dirsBefore, len(after))
	}
	if fdsAfter := openFDs(t); fdsAfter != fdsBefore {
		t.Fatalf("open descriptors changed: before %d after %d", fdsBefore, fdsAfter)
	}
}

func TestMissingStoreReadsLikeEmptyStore(t *testing.T) {
	c, _ := stateController(t)
	// An existing but empty store is the reference behavior.
	if err := c.Set("empty-store", "tmp", 1); err != nil {
		t.Fatal(err)
	}
	if err := c.Delete("empty-store", "tmp"); err != nil {
		t.Fatal(err)
	}
	wantKeys, wantErr := c.Keys("empty-store")
	gotKeys, gotErr := c.Keys("never-created")
	if wantErr != nil || gotErr != nil || !reflect.DeepEqual(wantKeys, gotKeys) {
		t.Fatalf("Keys: missing %#v, %v; empty %#v, %v", gotKeys, gotErr, wantKeys, wantErr)
	}
	wantValue, wantErr := c.Get("empty-store", "k")
	gotValue, gotErr := c.Get("never-created", "k")
	if wantErr != nil || gotErr != nil || !reflect.DeepEqual(wantValue, gotValue) {
		t.Fatalf("Get: missing %#v, %v; empty %#v, %v", gotValue, gotErr, wantValue, wantErr)
	}
	wantSnap, wantErr := c.GetSnapshot("empty-store", "k")
	gotSnap, gotErr := c.GetSnapshot("never-created", "k")
	if wantErr != nil || gotErr != nil || wantSnap != gotSnap {
		t.Fatalf("GetSnapshot: missing %#v, %v; empty %#v, %v", gotSnap, gotErr, wantSnap, wantErr)
	}
}

func TestExistingStoreReadsAndSetThenGetStillWork(t *testing.T) {
	c, _ := stateController(t)
	// Probe first so a stale "missing" result would be observable.
	if v, err := c.Get("late", "a"); err != nil || v != nil {
		t.Fatalf("pre-create Get: %v, %v", v, err)
	}
	if err := c.Set("late", "a", map[string]int{"n": 1}); err != nil {
		t.Fatal(err)
	}
	if err := c.Set("late", "b", "two"); err != nil {
		t.Fatal(err)
	}
	keys, err := c.Keys("late")
	sort.Strings(keys)
	if err != nil || !reflect.DeepEqual(keys, []string{"a", "b"}) {
		t.Fatalf("Keys = %v, %v", keys, err)
	}
	v, err := c.Get("late", "b")
	if err != nil || v != "two" {
		t.Fatalf("Get = %v, %v", v, err)
	}
	snap, err := c.GetSnapshot("late", "a")
	if err != nil || len(snap.Revision) != 64 {
		t.Fatalf("GetSnapshot = %#v, %v", snap, err)
	}
}

func TestReadsStillRejectInvalidPluginIDs(t *testing.T) {
	c, state := stateController(t)
	for _, id := range []string{"", "..", "../escape", "a/b", `a\b`} {
		if _, err := c.Get(id, "k"); err == nil {
			t.Errorf("Get(%q) accepted invalid ID", id)
		}
		if _, err := c.GetSnapshot(id, "k"); err == nil {
			t.Errorf("GetSnapshot(%q) accepted invalid ID", id)
		}
		if _, err := c.Keys(id); err == nil {
			t.Errorf("Keys(%q) accepted invalid ID", id)
		}
		if _, err := state.PluginData(id); err == nil {
			t.Errorf("PluginData(%q) accepted invalid ID", id)
		}
		if _, _, err := state.PluginDataIfExists(id); err == nil {
			t.Errorf("PluginDataIfExists(%q) accepted invalid ID", id)
		}
	}
}
