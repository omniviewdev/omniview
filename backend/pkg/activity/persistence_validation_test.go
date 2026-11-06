package activity

import (
	"fmt"
	"math"
	"strings"
	"testing"

	sdk "github.com/omniviewdev/plugin-sdk/pkg/activity"
)

func persistedValidationFixture() diskState {
	id := strings.Repeat("a", 32)
	return diskState{Version: 1, Revision: 1, Records: map[string]storedRecord{
		id: {Owner: "native:alpha", Record: sdk.Record{
			ID: id, Revision: 1, Kind: "task", Severity: "info",
			CreatedAt: "2026-01-01T00:00:00Z", UpdatedAt: "2026-01-01T00:00:01Z",
			Presentation: sdk.Presentation{Title: "Work"},
			Task:         &sdk.Task{State: "running", Cancellation: "unsupported"},
		}},
	}}
}

func TestValidatePersistedStateRejectsMaliciousRecords(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*storedRecord)
		want   string
	}{
		{"invalid ID", func(v *storedRecord) { v.Record.ID = "../escape" }, "map key"},
		{"self parent", func(v *storedRecord) { v.Record.ParentID = v.Record.ID }, "parent ID"},
		{"invalid parent", func(v *storedRecord) { v.Record.ParentID = "not-an-id" }, "parent ID"},
		{"zero revision", func(v *storedRecord) { v.Record.Revision = 0 }, "revision"},
		{"future revision", func(v *storedRecord) { v.Record.Revision = 2 }, "revision"},
		{"missing owner", func(v *storedRecord) { v.Owner = "" }, "owner"},
		{"malformed plugin owner", func(v *storedRecord) { v.Owner = "plugin:" }, "owner"},
		{"empty generation", func(v *storedRecord) { v.Owner = "plugin:alpha:" }, "owner"},
		{"extra owner segments", func(v *storedRecord) { v.Owner = "plugin:alpha:g:extra" }, "owner"},
		{"bad UI capability", func(v *storedRecord) { v.Owner = "ui:not-a-capability" }, "owner"},
		{"frontend provenance spoof", func(v *storedRecord) { v.Owner = "ui"; v.Record.Source.PluginID = "alpha" }, "frontend"},
		{"plugin provenance spoof", func(v *storedRecord) { v.Owner = "plugin:alpha:generation"; v.Record.Source.PluginID = "beta" }, "provenance"},
		{"native provenance spoof", func(v *storedRecord) { v.Record.Source.PluginID = "beta" }, "provenance"},
		{"empty severity", func(v *storedRecord) { v.Record.Severity = "" }, "severity"},
		{"invalid severity", func(v *storedRecord) { v.Record.Severity = "fatal" }, "severity"},
		{"invalid presentation", func(v *storedRecord) { v.Record.Presentation.Title = "" }, "specification"},
		{"invalid created timestamp", func(v *storedRecord) { v.Record.CreatedAt = "tomorrow" }, "createdAt"},
		{"missing updated timestamp", func(v *storedRecord) { v.Record.UpdatedAt = "" }, "updatedAt"},
		{"backward timestamps", func(v *storedRecord) { v.Record.UpdatedAt = "2025-01-01T00:00:00Z" }, "precedes"},
		{"invalid observation timestamp", func(v *storedRecord) { v.Record.ObservedAt = "bad" }, "observedAt"},
		{"unknown kind", func(v *storedRecord) { v.Record.Kind = "native" }, "kind"},
		{"missing task", func(v *storedRecord) { v.Record.Task = nil }, "exclusive"},
		{"task alert overlap", func(v *storedRecord) { v.Record.Alert = &sdk.Alert{} }, "exclusive"},
		{"message task overlap", func(v *storedRecord) { v.Record.Kind = "message" }, "message"},
		{"invalid task state", func(v *storedRecord) { v.Record.Task.State = "done" }, "task state"},
		{"invalid cancellation", func(v *storedRecord) { v.Record.Task.Cancellation = "cancel" }, "cancellation"},
		{"unknown reason on running task", func(v *storedRecord) { v.Record.Task.UnknownReason = "producer-lost" }, "unknown task state"},
		{"invalid unknown reason", func(v *storedRecord) { v.Record.Task.State = "unknown"; v.Record.Task.UnknownReason = "made-up" }, "unknown reason"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			state := persistedValidationFixture()
			for id, record := range state.Records {
				tt.mutate(&record)
				state.Records[id] = record
			}
			err := validatePersistedState(state)
			if err == nil || !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("want error containing %q, got %v", tt.want, err)
			}
		})
	}
}

func TestValidatePersistedStateBoundsAndSchema(t *testing.T) {
	state := persistedValidationFixture()
	if err := validatePersistedState(state); err != nil {
		t.Fatal(err)
	}
	state.Version = 0
	if err := validatePersistedState(state); err == nil {
		t.Fatal("accepted missing schema version")
	}
	state.Version = 1
	state.Revision = math.MaxUint64
	if err := validatePersistedState(state); err == nil {
		t.Fatal("accepted exhausted revision")
	}
	state.Revision = 1
	for i := range maxPersistedActivities + 1 {
		state.Records[fmt.Sprintf("%032x", i)] = storedRecord{}
	}
	if err := validatePersistedState(state); err == nil || !strings.Contains(err.Error(), "count exceeds") {
		t.Fatalf("want record count error, got %v", err)
	}
}

func TestValidatePersistedAlertState(t *testing.T) {
	for _, mutate := range []func(*sdk.Record){
		func(r *sdk.Record) { r.Alert.State = "invalid" },
		func(r *sdk.Record) { r.Alert.Key = "" },
		func(r *sdk.Record) { r.Alert.Key = strings.Repeat("a", 1025) },
		func(r *sdk.Record) { r.Alert.Occurrences = 0 },
		func(r *sdk.Record) { r.ObservedAt = "" },
		func(r *sdk.Record) { r.Alert.AcknowledgedAt = "bad" },
		func(r *sdk.Record) { r.Alert.SnoozedUntil = "bad" },
	} {
		state := persistedValidationFixture()
		for id, record := range state.Records {
			record.Record.Kind = "alert"
			record.Record.Task = nil
			record.Record.Alert = &sdk.Alert{Key: "stable", State: "firing", Occurrences: 1}
			record.Record.ObservedAt = record.Record.CreatedAt
			if err := validatePersistedRecord(id, record, state.Revision); err != nil {
				t.Fatal(err)
			}
			mutate(&record.Record)
			if err := validatePersistedRecord(id, record, state.Revision); err == nil {
				t.Fatal("accepted invalid alert")
			}
		}
	}
}

func TestValidatePersistedStateLiveBounds(t *testing.T) {
	for _, tt := range []struct {
		name       string
		count      int
		alert      bool
		distribute bool
		want       string
	}{
		{"active tasks", maxActiveTasksPerProducer + 1, false, false, "active task limit"},
		{"unknown alerts", maxUnresolvedAlertsPerProducer + 1, true, false, "unresolved alert limit"},
		{"global nonterminal", maxNonterminalActivities + 1, false, true, "nonterminal limit"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			state := persistedValidationFixture()
			var template storedRecord
			for _, record := range state.Records {
				template = record
			}
			clear(state.Records)
			state.Revision = uint64(tt.count)
			for i := range tt.count {
				record := template
				id := fmt.Sprintf("%032x", i)
				pluginID := "alpha"
				if tt.distribute {
					pluginID = fmt.Sprintf("plugin-%d", i/maxActiveTasksPerProducer)
				}
				// Different generations must still share the same logical quota.
				record.Owner = fmt.Sprintf("plugin:%s:generation-%d", pluginID, i)
				record.Record.ID = id
				record.Record.Revision = uint64(i + 1)
				record.Record.Source.PluginID = pluginID
				if tt.alert {
					record.Record.Kind = "alert"
					record.Record.Task = nil
					record.Record.ObservedAt = record.Record.CreatedAt
					record.Record.Alert = &sdk.Alert{Key: id, State: "unknown", Occurrences: 1}
				}
				state.Records[id] = record
			}
			if err := validatePersistedState(state); err == nil || !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("want %q error, got %v", tt.want, err)
			}
		})
	}
}

func TestValidatePersistedStateRejectsDuplicateRevisions(t *testing.T) {
	state := persistedValidationFixture()
	for _, record := range state.Records {
		record.Record.ID = strings.Repeat("b", 32)
		state.Records[record.Record.ID] = record
		break
	}
	if err := validatePersistedState(state); err == nil || !strings.Contains(err.Error(), "duplicate record revision") {
		t.Fatalf("want duplicate revision error, got %v", err)
	}
}
