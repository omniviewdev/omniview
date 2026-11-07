package diagnostics

import (
	"strings"
	"testing"
	"time"
)

func TestProcessSessionDiffersForSameProfileAndGeneration(t *testing.T) {
	identity := Identity{InstanceID: "profile", Generation: "supervisor-generation"}
	first, err := New(Options{Directory: t.TempDir(), Identity: identity})
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	second, err := New(Options{Directory: t.TempDir(), Identity: identity, Interval: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	a, b := first.GetCatalog().Identity, second.GetCatalog().Identity
	if a.SessionID == "" || a.SessionID == b.SessionID || a.InstanceID != b.InstanceID || a.Generation != b.Generation {
		t.Fatalf("process session not distinct: %+v %+v", a, b)
	}
	if a.ConfigID == b.ConfigID || !strings.Contains(a.ConfigScope, "not application settings or workload fingerprint") {
		t.Fatalf("collection config scope not explicit: %+v %+v", a, b)
	}
	first.SetConfigID("telemetry-disabled")
	if !strings.Contains(first.GetCatalog().Identity.ConfigID, "interval_ns=2000000000") {
		t.Fatal("config update lost collection bounds")
	}
}
func TestComparisonResolvesNamesAndWarnsAboutSessionAndSource(t *testing.T) {
	s := testService(t)
	s.captures["base-id"] = &Capture{ID: "base-id", Name: "baseline", Status: "complete", Coverage: Health{Complete: true}, Identity: Identity{SessionID: "session-a", SourceState: "modified"}}
	s.captures["candidate-id"] = &Capture{ID: "candidate-id", Name: "candidate", Status: "complete", Coverage: Health{Complete: true}, Identity: Identity{SessionID: "session-b", SourceState: "unknown"}}
	comparison, err := s.CompareCaptures("baseline", "candidate")
	if err != nil {
		t.Fatal(err)
	}
	if comparison.Baseline != "base-id" || comparison.Candidate != "candidate-id" {
		t.Fatalf("comparison lost persisted IDs: %+v", comparison)
	}
	warnings := strings.Join(comparison.Warnings, " ")
	if !strings.Contains(warnings, "process sessions differ") || !strings.Contains(warnings, "not a complete source fingerprint") {
		t.Fatal(warnings)
	}
}
