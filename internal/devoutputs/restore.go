package devoutputs

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

type cleanup struct {
	Remove, Retain snapshot
	Head           string
}

func validatePending(ctx context.Context, entry *outputEntry) error {
	if entry.Pending == nil {
		return nil
	}
	_, err := inspectPublication(ctx, entry)
	return err
}
func validateCleanup(ctx context.Context, entry *outputEntry) error {
	current, err := snapshotPath(entry.Spec, nil)
	if err != nil {
		return err
	}
	for path, value := range current {
		expected, remove := entry.Cleanup.Remove[path]
		if remove && expected == value {
			continue
		}
		if entry.Cleanup.Retain[path] != value {
			return fmt.Errorf("interrupted cleanup has unknown or user-edited bytes")
		}
	}
	for path, value := range entry.Cleanup.Retain {
		if current[path] != value {
			return fmt.Errorf("retained committed source changed during cleanup")
		}
	}
	sourceHead, err := specHead(ctx, entry.Spec)
	if err != nil {
		return err
	}
	if sourceHead != entry.Cleanup.Head {
		return fmt.Errorf("source commit changed during cleanup")
	}
	return nil
}
func validateEntry(ctx context.Context, entry *outputEntry, allowRecovery bool) error {
	_, err := observeEntry(ctx, entry, allowRecovery)
	return err
}

func Validate(ctx context.Context, w devcontract.ResolvedWorkspace) error {
	s, err := newScope(w)
	if err != nil {
		return err
	}
	return locked(ctx, s, func(j *journal) error {
		if j.Restoring {
			return fmt.Errorf("repository output restoration is incomplete")
		}
		for _, entry := range j.Entries {
			if err := validateEntry(ctx, entry, false); err != nil {
				return err
			}
		}
		return nil
	})
}

func finishCleanup(ctx context.Context, s scope, j *journal, key string) error {
	entry := j.Entries[key]
	if entry == nil || entry.Cleanup == nil {
		return nil
	}
	if err := validateCleanup(ctx, entry); err != nil {
		return err
	}
	paths := make([]string, 0, len(entry.Cleanup.Remove))
	for path := range entry.Cleanup.Remove {
		if path != "." {
			paths = append(paths, path)
		}
	}
	sort.Slice(paths, func(i, j int) bool { return len(paths[i]) > len(paths[j]) })
	var reader snapshotReader
	for _, relative := range paths {
		path := filepath.Join(entry.Spec.Target, relative)
		info, err := os.Lstat(path)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return err
		}
		value, err := reader.item(path, info, false)
		if err != nil {
			return err
		}
		if value != entry.Cleanup.Remove[relative] {
			return fmt.Errorf("cleanup path changed before removal")
		}
		if err = os.Remove(path); err != nil {
			return err
		}
	}
	delete(j.Entries, key)
	return save(s, j)
}

func Restore(ctx context.Context, w devcontract.ResolvedWorkspace) error {
	s, err := newScope(w)
	if err != nil {
		return err
	}
	return locked(ctx, s, func(j *journal) error {
		return restoreOutputJournal(ctx, s, j)
	})
}

func restorationFiles(ctx context.Context, entry *outputEntry) (map[string]committedFile, error) {
	files, err := tracked(ctx, entry.Spec)
	if err != nil {
		return nil, err
	}
	baseline := baselineSnapshot(files)
	for relative, file := range files {
		if current, ok := entry.Pending.Before[relative]; ok && equalCommitted(current, true, baseline[relative], true) {
			file.Mode = current.Mode
		} else if original, ok := entry.Original[relative]; ok && original.Kind == "file" && (original.Mode&0111 != 0) == (file.Mode&0111 != 0) {
			file.Mode = original.Mode
		}
		files[relative] = file
	}
	return files, nil
}

func validateRestoringStage(ctx context.Context, entry *outputEntry) error {
	if err := checkStage(entry); err != nil {
		return err
	}
	sourceHead, err := specHead(ctx, entry.Spec)
	if err != nil {
		return err
	}
	if sourceHead != entry.Pending.Head {
		return fmt.Errorf("source commit changed during restoration preparation")
	}
	current, err := snapshotPath(entry.Spec, entry.Exclude)
	if err != nil {
		return err
	}
	if !sameSnapshot(current, entry.Pending.Before) {
		return fmt.Errorf("restoration destination changed during preparation")
	}
	files, err := restorationFiles(ctx, entry)
	if err != nil {
		return err
	}
	desired := baselineSnapshot(files)
	actual, err := snapshotPath(stageSpec(entry), nil)
	if err != nil {
		return err
	}
	for path, value := range actual {
		if path == "." && value.Kind == "directory" && entry.Spec.Mode != "file" {
			continue
		}
		wanted, exists := desired[path]
		if !equalCommitted(value, true, wanted, exists) {
			return fmt.Errorf("restoration stage contains unknown or changed bytes")
		}
	}
	return nil
}

func finishRestoringStage(ctx context.Context, s scope, j *journal, entry *outputEntry) error {
	inspection, err := inspectPublication(ctx, entry)
	if err != nil {
		return err
	}
	if inspection.action != prepareRestoration {
		return fmt.Errorf("restoration stage is not ready for preparation")
	}
	files, err := restorationFiles(ctx, entry)
	if err != nil {
		return err
	}
	desired := baselineSnapshot(files)
	for relative, file := range files {
		target := entry.Pending.Directory
		if entry.Spec.Mode == "file" {
			target = filepath.Join(target, filepath.Base(entry.Spec.Target))
		} else if relative != "." {
			target = filepath.Join(target, relative)
		}
		if err = os.MkdirAll(filepath.Dir(target), 0700); err != nil {
			return err
		}
		if _, statErr := os.Lstat(target); os.IsNotExist(statErr) {
			stream, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, file.Mode)
			if err != nil {
				return err
			}
			_, writeErr := stream.Write(file.Data)
			closeErr := stream.Close()
			if writeErr != nil {
				return writeErr
			}
			if closeErr != nil {
				return closeErr
			}
		} else if statErr != nil {
			return statErr
		}
		if err = os.Chmod(target, file.Mode); err != nil {
			return err
		}
	}
	if entry.Spec.Mode != "file" {
		for relative, value := range desired {
			if value.Kind != "directory" {
				continue
			}
			mode := os.FileMode(0755)
			if original, ok := entry.Original[relative]; ok && original.Kind == "directory" {
				mode = original.Mode
			} else if current, ok := entry.Pending.Before[relative]; ok && current.Kind == "directory" {
				mode = current.Mode
			}
			target := entry.Pending.Directory
			if relative != "." {
				target = filepath.Join(target, relative)
			}
			if err = os.Chmod(target, mode); err != nil {
				return err
			}
		}
	}
	remove := len(files) == 0
	if remove {
		entry.Pending.After = snapshot{}
	} else {
		entry.Pending.After, err = snapshotPath(stageSpec(entry), nil)
		if err != nil {
			return err
		}
	}
	container := entry.Spec
	container.Mode = "tree"
	container.Target = entry.Pending.Directory
	entry.Pending.Container, err = snapshotPath(container, nil)
	if err != nil {
		return err
	}
	state := restoreCaptured
	if remove {
		state = removalCaptured
	}
	entry.Pending.setState(state)
	return save(s, j)
}
