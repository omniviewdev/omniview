package devoutputs

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/google/uuid"
)

// observeEntry performs the same full admission used by Validate. Its returned
// image is valid only as a proposed Before image in this locked call, never as
// authority for a later rename or deletion. Pending/Cleanup retain their own
// persisted images and are validated without replacing them.
func observeEntry(ctx context.Context, entry *outputEntry, allowRecovery bool) (snapshot, error) {
	if len(entry.Live) > 0 {
		return nil, fmt.Errorf("repository output still has an active or interrupted writer")
	}
	if entry.Pending != nil {
		if !allowRecovery {
			return nil, fmt.Errorf("repository publication requires recovery")
		}
		return nil, validatePending(ctx, entry)
	}
	if entry.Cleanup != nil {
		if !allowRecovery {
			return nil, fmt.Errorf("repository cleanup requires recovery")
		}
		return nil, validateCleanup(ctx, entry)
	}
	actual, err := snapshotPath(entry.Spec, entry.Exclude)
	if err != nil {
		return nil, err
	}
	if entry.Spec.Kind == modules || entry.Spec.Kind == viteCache || entry.Spec.Kind == loaderCache || entry.Spec.Kind == typeCache {
		if !sameSnapshot(actual, physical(entry.Expected)) {
			return nil, fmt.Errorf("owned generated tree changed: %s", entry.Spec.Target)
		}
		return actual, nil
	}
	baseline, err := tracked(ctx, entry.Spec)
	if err != nil {
		return nil, err
	}
	if err = matchesOwnedOrCommitted(actual, entry.Expected, baselineSnapshot(baseline)); err != nil {
		return nil, err
	}
	return actual, nil
}

func observeRestorationEntries(ctx context.Context, j *journal) (map[string]snapshot, error) {
	observations := make(map[string]snapshot, len(j.Entries))
	for _, key := range sortedEntries(j) {
		entry := j.Entries[key]
		actual, err := observeEntry(ctx, entry, true)
		if err != nil {
			return nil, err
		}
		if entry.Pending == nil && entry.Cleanup == nil {
			observations[key] = actual
		}
	}
	return observations, nil
}

// Allocate metadata only. One complete intent checkpoint precedes every stage
// mkdir and source mutation. The existing phase names and paths are unchanged;
// interrupted records are never replaced by a new plan.
func prepareRestorationIntents(ctx context.Context, s scope, j *journal, observations map[string]snapshot) error {
	changed := !j.Restoring
	for _, key := range sortedEntries(j) {
		if err := ctx.Err(); err != nil {
			return err
		}
		entry := j.Entries[key]
		if entry.Pending != nil || entry.Cleanup != nil {
			continue
		}
		current, ok := observations[key]
		if !ok {
			return fmt.Errorf("restoration intent has no post-recovery validated image")
		}
		head, err := specHead(ctx, entry.Spec)
		if err != nil {
			return err
		}
		files, err := tracked(ctx, entry.Spec)
		if err != nil {
			return err
		}
		if entry.Spec.Mode == "filter" {
			baseline := baselineSnapshot(files)
			retained, remove := snapshot{}, snapshot{}
			for path, value := range current {
				if path == "." {
					retained[path] = value
					continue
				}
				if committed, ok := baseline[path]; ok {
					if !equalCommitted(value, true, committed, true) {
						return fmt.Errorf("committed loader source differs; refusing source undo")
					}
					retained[path] = value
				} else {
					remove[path] = value
				}
			}
			entry.Cleanup = &cleanup{Remove: remove, Retain: retained, Head: head}
		} else {
			parent := filepath.Dir(entry.Spec.Target)
			identity, err := directoryIdentity(parent)
			if err != nil {
				return err
			}
			token := uuid.NewString()
			entry.Pending = &publication{Token: token, Directory: filepath.Join(parent, ".omniview-output-"+token), ParentIdentity: identity, Head: head, Backup: filepath.Join(backupDirectory(entry.Spec), ".omniview-before-"+token), Before: current}
			entry.Pending.setState(restoreAllocating)
			if len(files) == 0 {
				entry.Pending.After = snapshot{}
				entry.Pending.setState(removalCaptured)
			}
		}
		changed = true
	}
	j.Restoring = true
	if changed {
		return save(s, j)
	}
	return nil
}

func restoreOutputJournal(ctx context.Context, s scope, j *journal) error {
	// A producer recovery can mutate an output. Refuse foreign changes anywhere
	// before allowing that recovery, and never carry its preflight images across
	// it. With no recoverable producer this pass cannot mutate anything.
	recoveringProducer := false
	for _, entry := range j.Entries {
		if entry.Pending == nil {
			continue
		}
		state, err := entry.Pending.state()
		if err != nil {
			return err
		}
		if state.operation() == produceOutput && state != producerWriting {
			recoveringProducer = true
		}
	}
	if recoveringProducer {
		for _, entry := range j.Entries {
			if err := validateEntry(ctx, entry, true); err != nil {
				return err
			}
		}
	}
	if err := recoverPublications(ctx, s, j); err != nil {
		return err
	}
	observations, err := observeRestorationEntries(ctx, j)
	if err != nil {
		return err
	}
	if err = prepareRestorationIntents(ctx, s, j, observations); err != nil {
		return err
	}
	for _, key := range sortedEntries(j) {
		entry := j.Entries[key]
		if entry.Pending == nil {
			continue
		}
		state, err := entry.Pending.state()
		if err != nil {
			return err
		}
		if state != restoreAllocating && state != restorePreparing {
			continue
		}
		inspection, err := inspectPublication(ctx, entry)
		if err != nil {
			return err
		}
		if inspection.action == resumeRestoreAllocation {
			if err = os.Mkdir(entry.Pending.Directory, 0700); err != nil {
				return err
			}
			entry.Pending.ContainerIdentity, err = directoryIdentity(entry.Pending.Directory)
			if err != nil {
				return err
			}
			entry.Pending.setState(restorePreparing)
			// The created directory identity must be durable immediately, not
			// deferred into another batch or inferred after a restart.
			if err = save(s, j); err != nil {
				return err
			}
		}
		if inspection.action == prepareRestoration || inspection.action == resumeRestoreAllocation {
			if err = finishRestoringStage(ctx, s, j, entry); err != nil {
				return err
			}
		}
	}
	// Fresh complete-workspace refusal before the first source rename/delete.
	// Intent observations above are not admission for this or any later step.
	for _, entry := range j.Entries {
		if err = validateEntry(ctx, entry, true); err != nil {
			return err
		}
	}
	keys, err := batchRestorationOrder(j)
	if err != nil {
		return err
	}
	for _, key := range keys {
		entry := j.Entries[key]
		if entry == nil {
			continue
		}
		if entry.Cleanup != nil {
			if err = finishCleanup(ctx, s, j, key); err != nil {
				return err
			}
		} else if entry.Pending != nil {
			// Canonical execution reinspects every mutation and hashes every
			// removal leaf. Keep cache child forgetEntry/exclusion updates here.
			if err = completePublication(ctx, s, j, key); err != nil {
				return err
			}
		}
	}
	j.Restoring = false
	return retireJournal(s, j)
}

// Children must retire before parents, regardless of image size. Among ready
// independent outputs, retire the largest images first so subsequent durable
// checkpoints do not repeatedly serialize an unrelated aggregate modules tree.
func batchRestorationOrder(j *journal) ([]string, error) {
	keys := sortedEntries(j)
	children := make([]int, len(keys))
	parents := make([][]int, len(keys))
	weights := make([]int, len(keys))
	retired := make([]bool, len(keys))
	for i, key := range keys {
		entry := j.Entries[key]
		weights[i] = len(entry.Expected) + len(entry.Original)
		if entry.Pending != nil {
			weights[i] += len(entry.Pending.Before) + len(entry.Pending.After) + len(entry.Pending.Container)
		}
		if entry.Cleanup != nil {
			weights[i] += len(entry.Cleanup.Remove) + len(entry.Cleanup.Retain)
		}
		for k, child := range keys {
			if i == k {
				continue
			}
			target, nested := entry.Spec.Target, j.Entries[child].Spec.Target
			if target == nested && k < i || target != nested && contains(target, nested) {
				children[i]++
				parents[k] = append(parents[k], i)
			}
		}
	}
	order := make([]string, 0, len(keys))
	for len(order) < len(keys) {
		best := -1
		for i := range keys {
			if retired[i] || children[i] != 0 {
				continue
			}
			if best == -1 || weights[i] > weights[best] {
				best = i
			}
		}
		if best == -1 {
			return nil, fmt.Errorf("repository output containment has no safe retirement order")
		}
		retired[best] = true
		order = append(order, keys[best])
		for _, parent := range parents[best] {
			children[parent]--
		}
	}
	return order, nil
}
