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
	p := entry.Pending
	if p == nil {
		return nil
	}
	if p.Restore {
		revision, err := specHead(ctx, entry.Spec)
		if err != nil {
			return err
		}
		if revision != p.Head {
			return fmt.Errorf("committed source advanced during pending restoration; refusing historical source publication")
		}
	}
	if p.Phase == "writing" {
		return fmt.Errorf("repository producer was interrupted before authenticated completion")
	}
	if p.Phase == "allocating" || p.Phase == "restore-allocating" {
		if _, err := os.Lstat(p.Directory); err == nil {
			return fmt.Errorf("interrupted allocation has no authenticated directory identity")
		} else if !os.IsNotExist(err) {
			return err
		}
		current, err := snapshotPath(entry.Spec, entry.Exclude)
		if err != nil {
			return err
		}
		if !sameSnapshot(current, p.Before) {
			return fmt.Errorf("allocation destination changed")
		}
		return nil
	}
	if p.Phase == "restoring" {
		return validateRestoringStage(ctx, entry)
	}
	if p.Phase == "aborting" {
		spec := entry.Spec
		spec.Mode = "tree"
		spec.Target = p.Directory
		current, err := snapshotPath(spec, nil)
		if err != nil {
			return err
		}
		for path, value := range current {
			if p.After[path] != value {
				return fmt.Errorf("interrupted stage cleanup has foreign bytes")
			}
		}
		return nil
	}
	current, err := snapshotPath(entry.Spec, entry.Exclude)
	if err != nil {
		return err
	}
	backupSpec := entry.Spec
	backupSpec.Target = p.Backup
	backup, err := snapshotPath(backupSpec, nil)
	if err != nil {
		return err
	}
	for path, value := range backup {
		if p.Before[path] != value {
			return fmt.Errorf("publication backup contains foreign bytes")
		}
	}
	if sameSnapshot(current, p.After) || p.Remove && len(current) == 0 {
		return validateRetiredStage(entry)
	}
	if len(current) > 0 && !sameSnapshot(current, p.Before) {
		return fmt.Errorf("interrupted publication destination changed")
	}
	if !p.Remove {
		if err = validateCapturedStage(entry); err != nil {
			return err
		}
	} else if err = validateRetiredStage(entry); err != nil {
		return err
	}
	if len(current) == 0 && len(p.Before) > 0 {
		backup := entry.Spec
		backup.Target = p.Backup
		actual, err := snapshotPath(backup, nil)
		if err != nil {
			return err
		}
		if !sameSnapshot(actual, p.Before) {
			return fmt.Errorf("interrupted publication original bytes are unavailable")
		}
	}
	sourceHead, err := specHead(ctx, entry.Spec)
	if err != nil {
		return err
	}
	if sourceHead != p.Head {
		return fmt.Errorf("source commit changed during interrupted publication")
	}
	return nil
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
	if len(entry.Live) > 0 {
		return fmt.Errorf("repository output still has an active or interrupted writer")
	}
	if entry.Pending != nil {
		if !allowRecovery {
			return fmt.Errorf("repository publication requires recovery")
		}
		return validatePending(ctx, entry)
	}
	if entry.Cleanup != nil {
		if !allowRecovery {
			return fmt.Errorf("repository cleanup requires recovery")
		}
		return validateCleanup(ctx, entry)
	}
	actual, err := snapshotPath(entry.Spec, entry.Exclude)
	if err != nil {
		return err
	}
	if entry.Spec.Kind == modules || entry.Spec.Kind == viteCache || entry.Spec.Kind == loaderCache || entry.Spec.Kind == typeCache {
		if !sameSnapshot(actual, physical(entry.Expected)) {
			return fmt.Errorf("owned generated tree changed: %s", entry.Spec.Target)
		}
		return nil
	}
	baseline, err := tracked(ctx, entry.Spec)
	if err != nil {
		return err
	}
	return matchesOwnedOrCommitted(actual, entry.Expected, baselineSnapshot(baseline))
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
	for _, relative := range paths {
		path := filepath.Join(entry.Spec.Target, relative)
		info, err := os.Lstat(path)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return err
		}
		value, err := snapshotItem(path, info, false)
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
		// Refuse all unknown/user changes before recovering or retiring any output.
		for _, entry := range j.Entries {
			if err := validateEntry(ctx, entry, true); err != nil {
				return err
			}
		}
		if err := recoverPublications(ctx, s, j); err != nil {
			return err
		}
		if !j.Restoring {
			for _, entry := range j.Entries {
				if err := validateEntry(ctx, entry, false); err != nil {
					return err
				}
			}
			j.Restoring = true
			if err = save(s, j); err != nil {
				return err
			}
		}
		keys := sortedEntries(j)
		// Each plan and stage allocation is durable before its first mutation.
		for _, key := range keys {
			entry := j.Entries[key]
			if entry.Cleanup != nil {
				continue
			}
			if entry.Pending == nil {
				current, err := snapshotPath(entry.Spec, entry.Exclude)
				if err != nil {
					return err
				}
				sourceHead, err := specHead(ctx, entry.Spec)
				if err != nil {
					return err
				}
				if entry.Spec.Mode == "filter" {
					files, err := tracked(ctx, entry.Spec)
					if err != nil {
						return err
					}
					baseline := baselineSnapshot(files)
					retained := snapshot{}
					remove := snapshot{}
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
					entry.Cleanup = &cleanup{Remove: remove, Retain: retained, Head: sourceHead}
					if err = save(s, j); err != nil {
						return err
					}
					continue
				}
				files, err := tracked(ctx, entry.Spec)
				if err != nil {
					return err
				}
				if len(files) == 0 {
					if err = allocateRemoval(s, j, entry, sourceHead, current); err != nil {
						return err
					}
					continue
				}
				if err = allocatePublication(s, j, entry, sourceHead, current, true); err != nil {
					return err
				}
			}
			if entry.Pending.Phase == "restore-allocating" {
				if _, err := os.Lstat(entry.Pending.Directory); !os.IsNotExist(err) {
					return fmt.Errorf("unverified interrupted restoration directory")
				}
				if err = os.Mkdir(entry.Pending.Directory, 0700); err != nil {
					return err
				}
				entry.Pending.ContainerIdentity, err = directoryIdentity(entry.Pending.Directory)
				if err != nil {
					return err
				}
				entry.Pending.Phase = "restoring"
				if err = save(s, j); err != nil {
					return err
				}
			}
			if entry.Pending.Phase == "restoring" {
				if err = finishRestoringStage(ctx, s, j, entry); err != nil {
					return err
				}
			}
		}
		// Preflight the complete durable plan before its first source rename.
		for _, entry := range j.Entries {
			if err = validateEntry(ctx, entry, true); err != nil {
				return err
			}
		}
		keys = sortedEntries(j)
		sort.Slice(keys, func(i, k int) bool {
			left, right := j.Entries[keys[i]].Spec.Target, j.Entries[keys[k]].Spec.Target
			if len(left) == len(right) {
				return keys[i] < keys[k]
			}
			return len(left) > len(right)
		})
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
				if err = completePublication(ctx, s, j, key); err != nil {
					return err
				}
			}
		}
		j.Restoring = false
		return retireJournal(s, j)
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
	if err := validateRestoringStage(ctx, entry); err != nil {
		return err
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
	entry.Pending.Remove = len(files) == 0
	if entry.Pending.Remove {
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
	entry.Pending.Phase = "captured"
	return save(s, j)
}
