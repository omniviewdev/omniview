package devoutputs

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/google/uuid"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"
)

type preservation struct {
	Path           string
	ParentIdentity string
	Before         snapshot
	Head           string
}

type Reconciliation struct {
	Target           string `json:"target"`
	PreservedAt      string `json:"preservedAt"`
	RestoredBaseline bool   `json:"restoredBaseline"`
}

// Reconcile preserves one stopped, journal-owned staged producer by renaming it
// to an explicitly selected new external path. It never deletes or adopts the
// preserved tree. The caller must hold lifecycle, profile and stopped guards.
// A durable intent makes an interrupted preservation retryable with exact args.
func Reconcile(ctx context.Context, w devcontract.ResolvedWorkspace, consumer, producer, preserveAt string) (Reconciliation, error) {
	report := Reconciliation{PreservedAt: preserveAt}
	kind, err := producerKind(producer)
	if err != nil {
		return report, err
	}
	s, err := newScope(w)
	if err != nil {
		return report, err
	}
	spec, err := s.spec(consumer, kind)
	if err != nil {
		return report, err
	}
	report.Target = spec.Target
	preserveAt, err = cleanPath(preserveAt)
	if err != nil {
		return report, err
	}
	collection := filepath.Dir(filepath.Dir(w.Root))
	if contains(collection, preserveAt) || contains(preserveAt, collection) || w.StateRoot != "" && (contains(w.StateRoot, preserveAt) || contains(preserveAt, w.StateRoot)) {
		return report, fmt.Errorf("preservation path must be outside the collection and profile")
	}
	parent := filepath.Dir(preserveAt)
	if err = devsession.ValidatePrivateDirectory(parent); err != nil {
		return report, err
	}
	parentIdentity, err := directoryIdentity(parent)
	if err != nil {
		return report, err
	}
	err = locked(ctx, s, func(j *journal) error {
		entry := j.Entries[keyOf(spec)]
		if entry == nil {
			return fmt.Errorf("reconciliation requires an existing producer receipt; unowned roots must be preserved separately")
		}
		if j.Restoring || len(entry.Live) > 0 || entry.Cleanup != nil {
			return entryConflict(entry, "reconciliation", nil, fmt.Errorf("finish existing producer/restoration work first"))
		}
		if entry.Preservation == nil {
			if entry.Pending != nil {
				return entryConflict(entry, "reconciliation", nil, fmt.Errorf("pending producer publication must be resolved first"))
			}
			if _, e := os.Lstat(preserveAt); !os.IsNotExist(e) {
				return fmt.Errorf("preservation destination must not exist: %s", preserveAt)
			}
			current, e := snapshotPath(spec, nil)
			if e != nil {
				return e
			}
			if len(current) == 0 {
				return fmt.Errorf("producer output is absent; nothing to preserve")
			}
			revision, e := head(ctx, spec.Repository)
			if e != nil {
				return e
			}
			entry.Preservation = &preservation{Path: preserveAt, ParentIdentity: parentIdentity, Before: current, Head: revision}
			if e = save(s, j); e != nil {
				return e
			}
		}
		p := entry.Preservation
		if p.Path != preserveAt || p.ParentIdentity != parentIdentity {
			return fmt.Errorf("retry reconciliation with the original exact preservation path and parent")
		}
		revision, e := head(ctx, spec.Repository)
		if e != nil {
			return e
		}
		if revision != p.Head {
			return fmt.Errorf("source changed during reconciliation; preserve bytes and inspect before continuing")
		}
		preservedSpec := spec
		preservedSpec.Target = preserveAt
		preserved, e := snapshotPath(preservedSpec, nil)
		if e != nil {
			return e
		}
		if len(preserved) == 0 {
			actual, e := snapshotPath(spec, nil)
			if e != nil {
				return e
			}
			if !sameSnapshot(actual, p.Before) {
				return entryConflict(entry, "preservation", actual, fmt.Errorf("producer changed after preservation intent"))
			}
			// Atomic exclusion refuses even an empty foreign destination directory.
			if e = preserveRename(spec.Target, preserveAt); e != nil {
				return e
			}
			preserved, e = snapshotPath(preservedSpec, nil)
			if e != nil {
				return e
			}
		}
		if !sameSnapshot(preserved, p.Before) {
			return fmt.Errorf("preserved output changed; refusing reconciliation")
		}
		if entry.Pending == nil {
			actual, e := snapshotPath(spec, nil)
			if e != nil {
				return e
			}
			if len(actual) != 0 {
				return entryConflict(entry, "preservation", actual, fmt.Errorf("producer target reappeared after preservation"))
			}
			identity, e := directoryIdentity(filepath.Dir(spec.Target))
			if e != nil {
				return e
			}
			token := uuid.NewString()
			entry.Pending = &publication{Token: token, Directory: filepath.Join(filepath.Dir(spec.Target), ".omniview-output-"+token), ParentIdentity: identity, Head: revision, Backup: filepath.Join(backupDirectory(spec), ".omniview-before-"+token), Before: snapshot{}}
			entry.Pending.setState(restoreAllocating)
			files, e := tracked(ctx, spec)
			if e != nil {
				return e
			}
			if len(files) == 0 {
				entry.Pending.After = snapshot{}
				entry.Pending.setState(removalCaptured)
			}
			if e = save(s, j); e != nil {
				return e
			}
		}
		inspection, e := inspectPublication(ctx, entry)
		if e != nil {
			return e
		}
		if inspection.action == resumeRestoreAllocation {
			if e = os.Mkdir(entry.Pending.Directory, 0700); e != nil {
				return e
			}
			entry.Pending.ContainerIdentity, e = directoryIdentity(entry.Pending.Directory)
			if e != nil {
				return e
			}
			entry.Pending.setState(restorePreparing)
			if e = save(s, j); e != nil {
				return e
			}
		}
		if inspection.action == prepareRestoration || inspection.action == resumeRestoreAllocation {
			if e = finishRestoringStage(ctx, s, j, entry); e != nil {
				return e
			}
		}
		// Complete only this explicit producer, never unrelated pending outputs.
		if e = completePublication(ctx, s, j, keyOf(spec)); e != nil {
			return e
		}
		report.RestoredBaseline = true
		return nil
	})
	return report, err
}
