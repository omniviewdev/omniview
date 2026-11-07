package activity

import (
	"fmt"
	"math"
	"strings"
	"time"

	sdk "github.com/omniviewdev/plugin-sdk/pkg/activity"
)

const (
	maxActivityFileBytes = 16 << 20
	// Retain bounded history plus active tasks and unresolved alerts.
	maxPersistedActivities = 2500
)

// validatePersistedState checks untrusted disk data before recovery mutates it.
func validatePersistedState(state diskState) error {
	if state.Version != 1 {
		return fmt.Errorf("unsupported activity schema version %d", state.Version)
	}
	if state.Records == nil {
		return fmt.Errorf("activity records must be an object")
	}
	if state.Revision == math.MaxUint64 {
		return fmt.Errorf("snapshot revision exhausted")
	}
	if len(state.Records) > maxPersistedActivities {
		return fmt.Errorf("persisted activity count exceeds %d", maxPersistedActivities)
	}
	revisions := make(map[uint64]struct{}, len(state.Records))
	tasks := make(map[string]int)
	alerts := make(map[string]int)
	nonterminal := 0
	for id, stored := range state.Records {
		if err := validatePersistedRecord(id, stored, state.Revision); err != nil {
			return fmt.Errorf("activity %q: %w", id, err)
		}
		r := stored.Record
		if _, duplicate := revisions[r.Revision]; duplicate {
			return fmt.Errorf("activity %q: duplicate record revision %d", id, r.Revision)
		}
		revisions[r.Revision] = struct{}{}
		owner := producer(stored.Owner)
		if active(r) {
			tasks[owner]++
			nonterminal++
			if tasks[owner] > maxActiveTasksPerProducer {
				return fmt.Errorf("producer %q exceeds active task limit", owner)
			}
		}
		if r.Alert != nil && r.Alert.State != "resolved" {
			alerts[owner]++
			nonterminal++
			if alerts[owner] > maxUnresolvedAlertsPerProducer {
				return fmt.Errorf("producer %q exceeds unresolved alert limit", owner)
			}
		}
		if nonterminal > maxNonterminalActivities {
			return fmt.Errorf("persisted activities exceed nonterminal limit")
		}
	}
	// Recovery may advance every retained record's revision.
	if uint64(len(state.Records)) > math.MaxUint64-state.Revision {
		return fmt.Errorf("snapshot revision lacks recovery headroom")
	}
	return nil
}

func validatePersistedRecord(id string, stored storedRecord, revision uint64) error {
	r := stored.Record
	if !persistedActivityID(id) || r.ID != id {
		return fmt.Errorf("invalid record ID or map key mismatch")
	}
	if r.ParentID != "" && (!persistedActivityID(r.ParentID) || r.ParentID == id) {
		return fmt.Errorf("invalid parent ID")
	}
	if r.Revision == 0 || r.Revision > revision {
		return fmt.Errorf("record revision must be positive and not exceed snapshot")
	}
	pluginID, err := persistedOwnerPlugin(stored.Owner)
	if err != nil {
		return err
	}
	if strings.HasPrefix(stored.Owner, "ui") {
		if r.Source.PluginID != "" || r.Source.Resource != nil {
			return fmt.Errorf("frontend record claims plugin provenance")
		}
	} else if strings.HasPrefix(stored.Owner, "plugin:") {
		if r.Source.PluginID != pluginID {
			return fmt.Errorf("plugin source provenance mismatch")
		}
	} else if r.Source.PluginID != "" && r.Source.PluginID != pluginID {
		return fmt.Errorf("native source provenance mismatch")
	}
	if r.Source.Resource != nil {
		if r.Source.Resource.PluginID != pluginID || r.Source.PluginID != pluginID {
			return fmt.Errorf("resource source provenance mismatch")
		}
		if r.Source.ConnectionID != r.Source.Resource.Route.Connection {
			return fmt.Errorf("resource source connection mismatch")
		}
	}
	if r.Severity == "" {
		return fmt.Errorf("missing canonical severity")
	}
	if err := validateSpec(sdk.Spec{Source: &r.Source, Severity: r.Severity, ParentID: r.ParentID, Presentation: r.Presentation}, stored.Owner); err != nil {
		return fmt.Errorf("invalid specification: %w", err)
	}
	created, err := persistedTimestamp("createdAt", r.CreatedAt, true)
	if err != nil {
		return err
	}
	updated, err := persistedTimestamp("updatedAt", r.UpdatedAt, true)
	if err != nil {
		return err
	}
	if updated.Before(created) {
		return fmt.Errorf("updatedAt precedes createdAt")
	}
	if _, err := persistedTimestamp("observedAt", r.ObservedAt, r.Kind == "alert"); err != nil {
		return err
	}
	switch r.Kind {
	case "message":
		if r.Task != nil || r.Alert != nil {
			return fmt.Errorf("message contains task or alert state")
		}
	case "task":
		if r.Task == nil || r.Alert != nil {
			return fmt.Errorf("task requires exclusive task state")
		}
		switch r.Task.State {
		case "starting", "running", "paused", "succeeded", "failed", "cancelled", "unknown":
		default:
			return fmt.Errorf("invalid task state")
		}
		switch r.Task.Cancellation {
		case "unsupported", "available", "requested", "acknowledged":
		default:
			return fmt.Errorf("invalid cancellation state")
		}
		if r.Task.UnknownReason != "" {
			if r.Task.State != "unknown" {
				return fmt.Errorf("unknown reason requires unknown task state")
			}
			switch r.Task.UnknownReason {
			case "host-restarted", "producer-lost", "host-stopped":
			default:
				return fmt.Errorf("invalid task unknown reason")
			}
		}
	case "alert":
		if r.Alert == nil || r.Task != nil {
			return fmt.Errorf("alert requires exclusive alert state")
		}
		switch r.Alert.State {
		case "firing", "resolved", "unknown":
		default:
			return fmt.Errorf("invalid alert state")
		}
		if r.Alert.Key == "" || len(r.Alert.Key) > 1024 || r.Alert.Occurrences == 0 {
			return fmt.Errorf("invalid alert identity or occurrences")
		}
		if _, err := persistedTimestamp("acknowledgedAt", r.Alert.AcknowledgedAt, false); err != nil {
			return err
		}
		if _, err := persistedTimestamp("snoozedUntil", r.Alert.SnoozedUntil, false); err != nil {
			return err
		}
	default:
		return fmt.Errorf("invalid activity kind")
	}
	return nil
}

func persistedActivityID(id string) bool {
	if len(id) != 32 {
		return false
	}
	for _, c := range id {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return false
		}
	}
	return true
}

func persistedOwnerPlugin(owner string) (string, error) {
	parts := strings.Split(owner, ":")
	if owner == "ui" || len(parts) == 2 && parts[0] == "ui" && persistedActivityID(parts[1]) {
		return "", nil
	}
	if len(parts) == 2 && parts[0] == "native" && persistedOwnerToken(parts[1]) {
		return parts[1], nil
	}
	if len(parts) == 3 && parts[0] == "plugin" && persistedOwnerToken(parts[1]) && persistedOwnerToken(parts[2]) {
		return parts[1], nil
	}
	return "", fmt.Errorf("invalid producer owner")
}

func persistedOwnerToken(token string) bool {
	if token == "" || len(token) > 256 {
		return false
	}
	for _, c := range token {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-' || c == '_' || c == '.') {
			return false
		}
	}
	return true
}

func persistedTimestamp(field, value string, required bool) (time.Time, error) {
	if value == "" && !required {
		return time.Time{}, nil
	}
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil || parsed.IsZero() {
		return time.Time{}, fmt.Errorf("invalid %s timestamp", field)
	}
	return parsed, nil
}
