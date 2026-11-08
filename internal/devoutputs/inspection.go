package devoutputs

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"sort"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"
)

// Request selects a producer using the same boundaries as writer admission.
// Modules requests include the aggregate root and all selected package roots.
type Request struct {
	Consumer string
	Producer Producer
}

// ModuleRequest selects immutable dependency ownership, not a cache exemption.
func ModuleRequest(consumer string) Request { return Request{Consumer: consumer, Producer: modules} }

type OwnershipEntry struct {
	Producer  Producer  `json:"producer"`
	Consumer  string    `json:"consumer"`
	Target    string    `json:"target"`
	Ownership string    `json:"ownership"`
	Phase     string    `json:"phase"`
	Conflict  *Conflict `json:"conflict,omitempty"`
}

type Inspection struct {
	Ready             bool             `json:"ready"`
	Scope             string           `json:"scope"`
	MetadataPath      string           `json:"metadataPath"`
	MetadataDirectory string           `json:"metadataDirectory"`
	Restoring         bool             `json:"restoring"`
	LifecyclePhase    string           `json:"lifecyclePhase,omitempty"`
	ReentryGuidance   string           `json:"reentryGuidance,omitempty"`
	Entries           []OwnershipEntry `json:"entries"`
}

// Inspect observes all recorded producers plus requested admission boundaries.
// It creates no directories, lock files, journals, or writer capabilities. The
// result is a point-in-time observation, never authorization for later mutation.
func Inspect(ctx context.Context, w devcontract.ResolvedWorkspace, requests []Request) (Inspection, error) {
	report := Inspection{Ready: true, Scope: "repository producer and dependency ownership only; not source trust, link proof, runtime or process readiness", Entries: []OwnershipEntry{}}
	if err := ctx.Err(); err != nil {
		return report, err
	}
	s, err := newScope(w)
	if err != nil {
		return report, err
	}
	report.MetadataPath, report.MetadataDirectory = s.path, s.directory
	if err = devsession.ValidatePrivateDirectory(s.directory); err != nil && !os.IsNotExist(err) {
		return report, err
	}
	before, err := readJournalBytes(s.path)
	if err != nil && !os.IsNotExist(err) {
		return report, err
	}
	var j journal
	if err == nil {
		// Parse the exact bytes covered by the before/after consistency check.
		j, err = decodeJournal(s, before, true)
		if err != nil {
			return report, err
		}
	} else {
		j = emptyJournal(s)
	}
	report.Restoring = j.Restoring
	if j.Restoring {
		report.Ready = false
	}
	specs := map[string]specification{}
	for key, entry := range j.Entries {
		specs[key] = entry.Spec
	}
	for _, request := range requests {
		spec, e := s.spec(request.Consumer, request.Producer)
		var substitution *pathConflict
		if e != nil && (spec.Target == "" || !errors.As(e, &substitution)) {
			return report, e
		}
		specs[keyOf(spec)] = spec
	}
	keys := make([]string, 0, len(specs))
	for key := range specs {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		if err = ctx.Err(); err != nil {
			return report, err
		}
		spec := specs[key]
		item := OwnershipEntry{Producer: spec.Kind, Consumer: spec.Consumer, Target: spec.Target, Ownership: "unowned", Phase: "admission"}
		entry := j.Entries[key]
		if entry != nil {
			item.Ownership, item.Phase = "owned", "stopped"
			if len(entry.Live) > 0 {
				item.Phase = "active-or-interrupted"
			}
			if entry.Pending != nil {
				item.Phase = "publication:" + entry.Pending.Phase
			}
			if entry.Cleanup != nil {
				item.Phase = "cleanup"
			}
		}
		if _, e := cleanPath(spec.Target); e != nil {
			var substitution *pathConflict
			if !errors.As(e, &substitution) {
				return report, e
			}
			item.Conflict = conflict(spec, item.Ownership, item.Phase, nil, nil, e)
		} else if entry != nil {
			_, e := observeEntry(ctx, entry, true)
			if e == nil && (entry.Pending != nil || entry.Cleanup != nil) {
				e = entryConflict(entry, item.Phase, nil, fmt.Errorf("producer publication or cleanup is incomplete"))
			}
			if e != nil {
				if !inspectionBoundaryConflict(e) {
					return report, e
				}
				var c *Conflict
				if errors.As(e, &c) {
					item.Conflict = c
				} else {
					item.Conflict = entryConflict(entry, item.Phase, nil, e)
				}
			}
		} else {
			actual, e := snapshotPath(spec, nil)
			if e != nil {
				var substitution *pathConflict
				if !errors.As(e, &substitution) {
					return report, e
				}
				item.Conflict = conflict(spec, "unowned", "admission", nil, nil, e)
			} else if spec.Kind == modules {
				if len(actual) > 0 {
					item.Conflict = conflict(spec, "unowned", "admission", actual, nil, fmt.Errorf("preexisting dependency root has no ownership receipt"))
				} else {
					item.Ownership = "absent"
				}
			} else {
				files, e := tracked(ctx, spec)
				if e != nil {
					return report, e
				}
				baseline := baselineSnapshot(files)
				if e = requireBaseline(actual, baseline); e != nil {
					item.Conflict = conflict(spec, "unowned", "admission", actual, baseline, e)
				} else {
					item.Ownership = "clean-tracked-baseline"
				}
			}
		}
		if item.Conflict != nil {
			item.Conflict.MetadataPath = s.path
			report.Ready = false
		}
		report.Entries = append(report.Entries, item)
	}
	after, err := readJournalBytes(s.path)
	if err != nil && !os.IsNotExist(err) {
		return report, err
	}
	if !bytes.Equal(before, after) {
		return report, fmt.Errorf("ownership metadata changed during inspection; retry read-only inspection")
	}
	return report, nil
}

func inspectionBoundaryConflict(err error) bool {
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return false
	}
	var ioFailure *os.PathError
	if errors.As(err, &ioFailure) {
		return false
	}
	var substitution *pathConflict
	var ownership *Conflict
	return errors.As(err, &substitution) || errors.As(err, &ownership)
}
