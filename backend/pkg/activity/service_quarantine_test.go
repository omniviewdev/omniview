package activity

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/omniviewdev/omniview/internal/appstate"
	sdk "github.com/omniviewdev/plugin-sdk/pkg/activity"
)

func quarantineFiles(t *testing.T, root *appstate.ScopedRoot) []string {
	t.Helper()
	entries, err := root.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	var found []string
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), "activities.json.invalid.") {
			found = append(found, entry.Name())
		}
	}
	return found
}

func TestUnreadableHistoryIsQuarantinedNotFatal(t *testing.T) {
	fixtures := map[string][]byte{
		"truncated":     []byte(`{"version":1,"revision":4,"records":{"a`),
		"unknown field": []byte(`{"version":1,"revision":0,"records":{},"extra":true}`),
		"future":        []byte(`{"version":2,"revision":0,"records":{}}`),
		"not json":      []byte("sensitive text that is not json"),
		"nil records":   []byte(`{"version":1,"revision":0,"records":null}`),
		"oversize":      nil,
	}
	for name, data := range fixtures {
		t.Run(name, func(t *testing.T) {
			_, root := testService(t)
			if data == nil {
				data = make([]byte, maxActivityFileBytes+1)
			}
			if err := root.WriteFile("activities.json", data, 0600); err != nil {
				t.Fatal(err)
			}

			s, err := NewService(root, nil)
			if err != nil {
				t.Fatalf("a bad history file must not stop startup: %v", err)
			}
			if snapshot := s.Snapshot(); snapshot.Revision != 0 || len(snapshot.Records) != 0 {
				t.Fatalf("expected empty state, got %+v", snapshot)
			}

			moved := quarantineFiles(t, root)
			if len(moved) != 1 {
				t.Fatalf("expected one quarantine file, got %v", moved)
			}
			kept, err := root.ReadFile(moved[0])
			if err != nil {
				t.Fatal(err)
			}
			if string(kept) != string(data) {
				t.Fatal("quarantine file does not hold the original bytes")
			}
			info, err := root.Stat(moved[0])
			if err != nil {
				t.Fatal(err)
			}
			if info.Mode().Perm() != 0600 {
				t.Fatalf("quarantine file mode %v, want the original 0600", info.Mode().Perm())
			}
			if _, err := NewService(root, nil); err != nil {
				t.Fatalf("history rewritten after quarantine does not load: %v", err)
			}
		})
	}
}

func TestSecondBadHistoryNeverOverwritesEarlierQuarantine(t *testing.T) {
	_, root := testService(t)
	for _, evidence := range []string{"first bad file", "second bad file"} {
		if err := root.WriteFile("activities.json", []byte(evidence), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := NewService(root, nil); err != nil {
			t.Fatal(err)
		}
	}
	moved := quarantineFiles(t, root)
	if len(moved) != 2 {
		t.Fatalf("expected two quarantine files, got %v", moved)
	}
	seen := map[string]bool{}
	for _, name := range moved {
		data, err := root.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		seen[string(data)] = true
	}
	if !seen["first bad file"] || !seen["second bad file"] {
		t.Fatalf("an earlier quarantine file was overwritten: %v", seen)
	}
}

func TestHistoryOverflowPrunesOldestInsteadOfRejectingEveryCommit(t *testing.T) {
	s, root := testService(t)
	spec := taskSpec("large")
	spec.Presentation.Details = strings.Repeat("x", 64000)
	seed, err := s.publishMessage("native:alpha", spec)
	if err != nil {
		t.Fatal(err)
	}

	// Fill the file to just under its cap with eligible messages.
	state := diskState{Version: 1, Records: map[string]storedRecord{}}
	for i := 1; i <= 250; i++ {
		record := seed
		record.ID = fmt.Sprintf("%032x", i)
		record.Revision = uint64(i)
		state.Records[record.ID] = storedRecord{Record: record, Owner: "native:alpha"}
	}
	state.Revision = 250
	data, err := json.Marshal(state)
	if err != nil {
		t.Fatal(err)
	}
	if len(data) >= maxActivityFileBytes {
		t.Fatalf("fixture already over the cap: %d", len(data))
	}
	if err := root.WriteFile("activities.json", data, 0600); err != nil {
		t.Fatal(err)
	}
	full, err := NewService(root, nil)
	if err != nil {
		t.Fatal(err)
	}

	var last sdk.Record
	for i := range 12 {
		spec.Presentation.Title = fmt.Sprintf("after %d", i)
		last, err = full.publishMessage("native:alpha", spec)
		if err != nil {
			t.Fatalf("commit %d rolled back at the storage cap: %v", i, err)
		}
	}
	on, err := os.Stat(root.ResolvePath("activities.json"))
	if err != nil {
		t.Fatal(err)
	}
	if on.Size() > maxActivityFileBytes {
		t.Fatalf("file over cap: %d", on.Size())
	}
	found := false
	for _, record := range full.Snapshot().Records {
		found = found || record.ID == last.ID
	}
	if !found {
		t.Fatal("the newest record must survive pruning")
	}
}
