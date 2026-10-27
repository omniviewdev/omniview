package devoutputs

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
)

type publicationAction uint8

const (
	discardAllocation publicationAction = iota
	resumeRestoreAllocation
	prepareRestoration
	discardAbortedStage
	backupDestination
	publishCapturedStage
	recordPublication
	retirePublication
)

// publicationInspection authorizes just one next action, with the snapshots
// that justify it. It is not a capability to mutate later: execution repeats
// this read-only inspection immediately before every action, including after
// persisting a rename. Both full-workspace preflight and execution use it.
type publicationInspection struct {
	state           publicationState
	action          publicationAction
	current, backup snapshot
}

func inspectPublication(ctx context.Context, entry *outputEntry) (publicationInspection, error) {
	p := entry.Pending
	state, err := p.state()
	if err != nil {
		return publicationInspection{}, err
	}
	inspection := publicationInspection{state: state}
	if state.operation() != produceOutput {
		revision, err := specHead(ctx, entry.Spec)
		if err != nil {
			return inspection, err
		}
		if revision != p.Head {
			return inspection, fmt.Errorf("committed source advanced during pending restoration; refusing historical source publication")
		}
	}
	switch state {
	case producerWriting:
		return inspection, fmt.Errorf("repository producer was interrupted before authenticated completion")
	case producerAllocating, restoreAllocating:
		if _, err := os.Lstat(p.Directory); err == nil {
			return inspection, fmt.Errorf("interrupted allocation has no authenticated directory identity")
		} else if !os.IsNotExist(err) {
			return inspection, err
		}
		inspection.current, err = snapshotPath(entry.Spec, entry.Exclude)
		if err != nil {
			return inspection, err
		}
		if !sameSnapshot(inspection.current, p.Before) {
			return inspection, fmt.Errorf("allocation destination changed")
		}
		inspection.action = discardAllocation
		if state == restoreAllocating {
			inspection.action = resumeRestoreAllocation
		}
		return inspection, nil
	case restorePreparing:
		inspection.action = prepareRestoration
		return inspection, validateRestoringStage(ctx, entry)
	case producerAborting:
		spec := entry.Spec
		spec.Mode = "tree"
		spec.Target = p.Directory
		actual, err := snapshotPath(spec, nil)
		if err != nil {
			return inspection, err
		}
		for path, value := range actual {
			if p.After[path] != value {
				return inspection, fmt.Errorf("interrupted stage cleanup has foreign bytes")
			}
		}
		inspection.action = discardAbortedStage
		return inspection, nil
	}
	inspection.current, err = snapshotPath(entry.Spec, entry.Exclude)
	if err != nil {
		return inspection, err
	}
	backupSpec := entry.Spec
	backupSpec.Target = p.Backup
	inspection.backup, err = snapshotPath(backupSpec, nil)
	if err != nil {
		return inspection, err
	}
	for path, value := range inspection.backup {
		if p.Before[path] != value {
			return inspection, fmt.Errorf("publication backup contains foreign bytes")
		}
	}
	removed := state.operation() == removeOutput
	if sameSnapshot(inspection.current, p.After) || removed && len(inspection.current) == 0 {
		inspection.action = retirePublication
		// A removal publishes no stage: its durable intent/rename already
		// permits exact retirement, including recovery of partial cleanup.
		if !removed && state != state.operation().published() {
			inspection.action = recordPublication
		}
		return inspection, validateRetiredStage(entry)
	}
	sourceHead, err := specHead(ctx, entry.Spec)
	if err != nil {
		return inspection, err
	}
	if sourceHead != p.Head {
		return inspection, fmt.Errorf("source commit changed before producer publication")
	}
	parent, err := directoryIdentity(filepath.Dir(entry.Spec.Target))
	if err != nil {
		return inspection, err
	}
	if parent != p.ParentIdentity {
		return inspection, fmt.Errorf("publication destination parent was replaced")
	}
	if removed {
		err = validateRetiredStage(entry)
	} else {
		err = validateCapturedStage(entry)
	}
	if err != nil {
		return inspection, err
	}
	if len(inspection.current) > 0 {
		if !sameSnapshot(inspection.current, p.Before) || len(inspection.backup) > 0 {
			return inspection, fmt.Errorf("publication destination contains foreign changes or an occupied backup")
		}
		inspection.action = backupDestination
		return inspection, nil
	}
	if len(p.Before) > 0 && !sameSnapshot(inspection.backup, p.Before) {
		return inspection, fmt.Errorf("publication lost its exact original backup")
	}
	inspection.action = publishCapturedStage
	return inspection, nil
}
