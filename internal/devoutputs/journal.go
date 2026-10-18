package devoutputs

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"

	"github.com/google/uuid"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"
)

type journal struct {
	Version              int
	WorkspaceID, Root    string
	RootIdentity         string
	Repositories         map[string]string
	RepositoryIdentities map[string]string
	Entries              map[string]*outputEntry
	Restoring            bool
}
type outputEntry struct {
	Spec     specification
	Expected snapshot
	Original snapshot
	Exclude  []string
	Live     map[string]bool
	Pending  *publication
	Cleanup  *cleanup
}
type publication struct {
	Token, Directory, ContainerIdentity, ParentIdentity, Head, Backup, Phase string
	Before, After, Container                                                 snapshot
	Restore                                                                  bool
	Remove                                                                   bool
}

type Stage struct {
	Directory  string
	s          scope
	key, token string
	mu         sync.Mutex
	closed     bool
}

// Metadata parents must already be private or be exclusively created here.
// Check the complete canonical boundary before any chmod-capable helper or lock.
func ensureMetadataDirectory(s scope, directory string) error {
	if directory != s.directory && directory != filepath.Join(s.directory, "cache") {
		return fmt.Errorf("unknown repository-output metadata directory")
	}
	if _, err := cleanPath(directory); err != nil {
		return err
	}
	paths := []string{filepath.Dir(filepath.Dir(s.directory)), filepath.Dir(s.directory), s.directory}
	if directory != s.directory {
		paths = append(paths, directory)
	}
	for _, path := range paths {
		if err := devsession.ValidatePrivateDirectory(path); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	for _, path := range paths {
		err := os.Mkdir(path, 0700)
		if err != nil && !os.IsExist(err) {
			return err
		}
		if err == nil {
			// Only a directory this invocation exclusively created may have its
			// initial permissions/Windows ACL established, never an existing leaf.
			if _, err = cleanPath(path); err != nil {
				return err
			}
			canonical, err := devsession.EnsurePrivateDirectory(path)
			if err != nil {
				return err
			}
			if canonical != path {
				return fmt.Errorf("repository-output metadata directory was redirected")
			}
		}
		if err = devsession.ValidatePrivateDirectory(path); err != nil {
			return err
		}
	}
	return nil
}

func locked(ctx context.Context, s scope, action func(*journal) error) error {
	if err := ensureMetadataDirectory(s, s.directory); err != nil {
		return err
	}
	lock, err := devsession.AcquirePrivateLock(ctx, s.directory, "journal.lock")
	if err != nil {
		return err
	}
	defer lock.Close()
	j, err := readJournal(s)
	if err != nil {
		return err
	}
	return action(&j)
}
func save(s scope, j *journal) error  { return devsession.WritePrivateJSON(s.path, j) }
func keyOf(spec specification) string { return spec.Target + "|" + string(spec.Kind) }
func physical(expected snapshot) snapshot {
	result := snapshot{}
	for path, value := range expected {
		if value.Kind != "absent" {
			result[path] = value
		}
	}
	return result
}
func applied(before, after snapshot) snapshot {
	result := snapshot{}
	for path, value := range after {
		result[path] = value
	}
	for path := range before {
		if _, ok := after[path]; !ok {
			result[path] = item{Kind: "absent"}
		}
	}
	return result
}

func Prepare(ctx context.Context, w devcontract.ResolvedWorkspace, consumer string, kind Producer) (*Stage, error) {
	if kind != Distribution && kind != Bindings && kind != Shims && kind != YAMLWorker {
		return nil, fmt.Errorf("producer is not a staged repository output")
	}
	s, err := newScope(w)
	if err != nil {
		return nil, err
	}
	spec, err := s.spec(consumer, kind)
	if err != nil {
		return nil, err
	}
	var prepared *Stage
	err = locked(ctx, s, func(j *journal) error {
		if j.Restoring {
			return fmt.Errorf("repository restoration must finish before a producer starts")
		}
		if err := recoverPublications(ctx, s, j); err != nil {
			return err
		}
		key := keyOf(spec)
		entry := j.Entries[key]
		current, err := snapshotPath(spec, nil)
		if err != nil {
			return err
		}
		baselineFiles, err := tracked(ctx, spec)
		if err != nil {
			return err
		}
		baseline := baselineSnapshot(baselineFiles)
		if entry == nil {
			if err = requireBaseline(current, baseline); err != nil {
				return err
			}
			entry = &outputEntry{Spec: spec, Expected: current, Original: current, Live: map[string]bool{}}
			j.Entries[key] = entry
		} else {
			if entry.Pending != nil || len(entry.Live) > 0 {
				return fmt.Errorf("repository producer already has an unfinished writer")
			}
			if err = matchesOwnedOrCommitted(current, entry.Expected, baseline); err != nil {
				return err
			}
		}
		sourceHead, err := head(ctx, spec.Repository)
		if err != nil {
			return err
		}
		if err = allocatePublication(s, j, entry, sourceHead, current, false); err != nil {
			return err
		}
		prepared = &Stage{Directory: entry.Pending.Directory, s: s, key: key, token: entry.Pending.Token}
		return nil
	})
	return prepared, err
}

func stageSpec(entry *outputEntry) specification {
	spec := entry.Spec
	spec.Target = entry.Pending.Directory
	if entry.Spec.Mode == "file" {
		spec.Target = filepath.Join(spec.Target, filepath.Base(entry.Spec.Target))
	}
	return spec
}
func checkStage(entry *outputEntry) error {
	p := entry.Pending
	if p == nil {
		return fmt.Errorf("no prepared producer stage")
	}
	if filepath.Dir(p.Directory) != filepath.Dir(entry.Spec.Target) || filepath.Base(p.Directory) == "." || len(filepath.Base(p.Directory)) < len(".omniview-output-") || filepath.Base(p.Directory)[:len(".omniview-output-")] != ".omniview-output-" {
		return fmt.Errorf("producer staging path differs from its selected sibling boundary")
	}
	identity, err := directoryIdentity(p.Directory)
	if err != nil {
		return err
	}
	if identity != p.ContainerIdentity {
		return fmt.Errorf("producer staging directory was replaced")
	}
	parent, err := directoryIdentity(filepath.Dir(entry.Spec.Target))
	if err != nil {
		return err
	}
	if parent != p.ParentIdentity {
		return fmt.Errorf("producer destination parent was replaced")
	}
	return nil
}

// Publish preflights every supplied destination before any source publication.
// Captured after-images and rename progress survive interruption for exact retry.
func Publish(ctx context.Context, stages ...*Stage) error {
	if len(stages) == 0 {
		return nil
	}
	ordered := append([]*Stage(nil), stages...)
	for _, stage := range ordered {
		if stage == nil {
			return fmt.Errorf("nil producer capability")
		}
	}
	sort.Slice(ordered, func(i, k int) bool { return ordered[i].key < ordered[k].key })
	for i, stage := range ordered {
		if i > 0 && ordered[i-1].key == stage.key {
			return fmt.Errorf("duplicate producer capability")
		}
	}
	for _, stage := range ordered {
		stage.mu.Lock()
	}
	defer func() {
		for i := len(ordered) - 1; i >= 0; i-- {
			ordered[i].mu.Unlock()
		}
	}()
	first := stages[0]
	if first == nil {
		return fmt.Errorf("nil producer capability")
	}
	return locked(ctx, first.s, func(j *journal) error {
		for _, stage := range stages {
			if stage == nil || stage.s.path != first.s.path || stage.closed {
				return fmt.Errorf("producer capabilities have different or closed ownership")
			}
			entry := j.Entries[stage.key]
			if entry == nil || entry.Pending == nil || entry.Pending.Token != stage.token || entry.Pending.Phase != "writing" {
				return fmt.Errorf("producer stage capability is stale")
			}
			if err := checkStage(entry); err != nil {
				return err
			}
			current, err := snapshotPath(entry.Spec, entry.Exclude)
			if err != nil {
				return err
			}
			if !sameSnapshot(current, entry.Pending.Before) {
				return fmt.Errorf("producer source/destination changed during generation")
			}
			currentHead, err := head(ctx, entry.Spec.Repository)
			if err != nil {
				return err
			}
			if currentHead != entry.Pending.Head {
				return fmt.Errorf("source commit changed during generation")
			}
			after, err := snapshotPath(stageSpec(entry), nil)
			if err != nil {
				return err
			}
			if entry.Spec.Mode == "file" && len(after) != 1 {
				return fmt.Errorf("producer did not create its selected output file")
			}
			entry.Pending.After = after
			container := entry.Spec
			container.Mode = "tree"
			container.Target = entry.Pending.Directory
			entry.Pending.Container, err = snapshotPath(container, nil)
			if err != nil {
				return err
			}
			if entry.Spec.Mode == "file" && len(entry.Pending.Container) != 2 {
				return fmt.Errorf("single-file producer wrote additional paths")
			}
		}
		// Persist every exact after-image before the first rename.
		for _, stage := range stages {
			j.Entries[stage.key].Pending.Phase = "captured"
		}
		if err := save(first.s, j); err != nil {
			return err
		}
		for _, stage := range stages {
			if err := completePublication(ctx, first.s, j, stage.key); err != nil {
				return err
			}
			stage.closed = true
		}
		return nil
	})
}

func completePublication(ctx context.Context, s scope, j *journal, key string) error {
	entry := j.Entries[key]
	if entry == nil || entry.Pending == nil {
		return nil
	}
	p := entry.Pending
	if p.Phase == "writing" {
		return fmt.Errorf("interrupted producer has no authenticated after-image")
	}
	if p.Phase == "allocating" {
		if _, err := os.Lstat(p.Directory); !os.IsNotExist(err) {
			return fmt.Errorf("interrupted producer allocation has unverified output")
		}
		current, err := snapshotPath(entry.Spec, entry.Exclude)
		if err != nil {
			return err
		}
		if !sameSnapshot(current, p.Before) {
			return fmt.Errorf("producer allocation destination changed")
		}
		entry.Pending = nil
		return save(s, j)
	}
	if p.Phase == "aborting" {
		spec := entry.Spec
		spec.Mode = "tree"
		spec.Target = p.Directory
		if err := removeSnapshot(spec, p.After); err != nil {
			return err
		}
		entry.Pending = nil
		return save(s, j)
	}
	current, err := snapshotPath(entry.Spec, entry.Exclude)
	if err != nil {
		return err
	}
	after := p.After
	already := sameSnapshot(current, after)
	if p.Remove {
		already = len(current) == 0
	}
	if already {
		if err := validateRetiredStage(entry); err != nil {
			return err
		}
	}
	if !already {
		sourceHead, err := specHead(ctx, entry.Spec)
		if err != nil {
			return err
		}
		if sourceHead != p.Head {
			return fmt.Errorf("source commit changed before producer publication")
		}
		parent, err := directoryIdentity(filepath.Dir(entry.Spec.Target))
		if err != nil {
			return err
		}
		if parent != p.ParentIdentity {
			return fmt.Errorf("publication destination parent was replaced")
		}
		if !p.Remove {
			if err = validateCapturedStage(entry); err != nil {
				return err
			}
		} else if err = validateRetiredStage(entry); err != nil {
			return err
		}
		backupSpec := entry.Spec
		backupSpec.Target = p.Backup
		backup, err := snapshotPath(backupSpec, nil)
		if err != nil {
			return err
		}
		if len(current) > 0 {
			if !sameSnapshot(current, p.Before) || len(backup) > 0 {
				return fmt.Errorf("publication destination contains foreign changes")
			}
			if err = os.Rename(entry.Spec.Target, p.Backup); err != nil {
				return err
			}
			p.Phase = "backed-up"
			if err = save(s, j); err != nil {
				return err
			}
		} else if len(p.Before) > 0 && !sameSnapshot(backup, p.Before) {
			return fmt.Errorf("publication lost its exact original backup")
		}
		if !p.Remove {
			if err = validateCapturedStage(entry); err != nil {
				return err
			}
			source := p.Directory
			if entry.Spec.Mode == "file" {
				source = filepath.Join(source, filepath.Base(entry.Spec.Target))
			}
			if err = os.Rename(source, entry.Spec.Target); err != nil {
				return err
			}
		}
		p.Phase = "published"
		if err = save(s, j); err != nil {
			return err
		}
	}
	// Retire only exact known before-images, never a broad recursive deletion.
	backupSpec := entry.Spec
	backupSpec.Target = p.Backup
	backup, err := snapshotPath(backupSpec, nil)
	if err != nil {
		return err
	}
	if len(backup) > 0 {
		for path, value := range backup {
			if p.Before[path] != value {
				return fmt.Errorf("publication backup was edited")
			}
		}
		if err = removeSnapshot(backupSpec, p.Before); err != nil {
			return err
		}
	}
	if entry.Spec.Mode == "file" || p.Remove {
		if info, statErr := os.Lstat(p.Directory); statErr == nil {
			identity, idErr := directoryIdentity(p.Directory)
			if idErr != nil || !info.IsDir() || identity != p.ContainerIdentity {
				return fmt.Errorf("producer stage container changed")
			}
			container := entry.Spec
			container.Mode = "tree"
			container.Target = p.Directory
			if err = removeSnapshot(container, p.Container); err != nil {
				return err
			}
		} else if !os.IsNotExist(statErr) {
			return statErr
		}
	}
	if p.Restore {
		forgetEntry(j, key)
	} else {
		known := snapshot{}
		for path, value := range entry.Expected {
			known[path] = value
		}
		for path, value := range p.Before {
			known[path] = value
		}
		entry.Expected = applied(known, p.After)
		entry.Pending = nil
	}
	return save(s, j)
}
func recoverPublications(ctx context.Context, s scope, j *journal) error {
	keys := make([]string, 0, len(j.Entries))
	for key, entry := range j.Entries {
		if entry.Pending != nil && !entry.Pending.Restore && entry.Pending.Phase != "writing" {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	for _, key := range keys {
		if err := completePublication(ctx, s, j, key); err != nil {
			return err
		}
	}
	return nil
}

// Abort records the controlled failed producer's exact stage before removing
// only that stage. It never rewinds user source or an in-progress publication.
func (stage *Stage) Abort(ctx context.Context) error {
	if stage == nil {
		return nil
	}
	stage.mu.Lock()
	defer stage.mu.Unlock()
	if stage.closed {
		return nil
	}
	return locked(ctx, stage.s, func(j *journal) error {
		entry := j.Entries[stage.key]
		if entry == nil || entry.Pending == nil || entry.Pending.Token != stage.token || entry.Pending.Phase != "writing" {
			return fmt.Errorf("cannot abort a stale or partially published producer")
		}
		if err := checkStage(entry); err != nil {
			return err
		}
		spec := entry.Spec
		spec.Mode = "tree"
		spec.Target = entry.Pending.Directory
		contents, err := snapshotPath(spec, nil)
		if err != nil {
			return err
		}
		// The exact authenticated failed-output snapshot is durable before cleanup.
		entry.Pending.After = contents
		entry.Pending.Phase = "aborting"
		if err = save(stage.s, j); err != nil {
			return err
		}
		if err = removeSnapshot(spec, contents); err != nil {
			return err
		}
		entry.Pending = nil
		stage.closed = true
		return save(stage.s, j)
	})
}

func allocatePublication(s scope, j *journal, entry *outputEntry, sourceHead string, before snapshot, restore bool) error {
	parent := filepath.Dir(entry.Spec.Target)
	parentID, err := directoryIdentity(parent)
	if err != nil {
		return err
	}
	token := uuid.NewString()
	phase := "allocating"
	if restore {
		phase = "restore-allocating"
	}
	entry.Pending = &publication{Token: token, Directory: filepath.Join(parent, ".omniview-output-"+token), ParentIdentity: parentID, Head: sourceHead, Backup: filepath.Join(backupDirectory(entry.Spec), ".omniview-before-"+token), Phase: phase, Before: before, Restore: restore}
	if err = save(s, j); err != nil {
		return err
	}
	if err = os.Mkdir(entry.Pending.Directory, 0700); err != nil {
		return err
	}
	entry.Pending.ContainerIdentity, err = directoryIdentity(entry.Pending.Directory)
	if err != nil {
		return err
	}
	entry.Pending.Phase = "writing"
	if restore {
		entry.Pending.Phase = "restoring"
	}
	return save(s, j)
}

func forgetEntry(j *journal, key string) {
	entry := j.Entries[key]
	if entry != nil && (entry.Spec.Kind == loaderCache || entry.Spec.Kind == typeCache) {
		parentKey := filepath.Join(entry.Spec.Consumer, "node_modules") + "|" + string(modules)
		if parent := j.Entries[parentKey]; parent != nil {
			relative, _ := filepath.Rel(parent.Spec.Target, entry.Spec.Target)
			kept := parent.Exclude[:0]
			for _, path := range parent.Exclude {
				if path != relative {
					kept = append(kept, path)
				}
			}
			parent.Exclude = kept
		}
	}
	delete(j.Entries, key)
}

func backupDirectory(spec specification) string {
	if spec.Kind == loaderCache || spec.Kind == typeCache {
		return spec.Consumer
	}
	return filepath.Dir(spec.Target)
}

func allocateRemoval(s scope, j *journal, entry *outputEntry, sourceHead string, before snapshot) error {
	parent := filepath.Dir(entry.Spec.Target)
	parentID, err := directoryIdentity(parent)
	if err != nil {
		return err
	}
	token := uuid.NewString()
	entry.Pending = &publication{Token: token, Directory: filepath.Join(parent, ".omniview-output-"+token), ParentIdentity: parentID, Head: sourceHead, Backup: filepath.Join(backupDirectory(entry.Spec), ".omniview-before-"+token), Phase: "captured", Before: before, After: snapshot{}, Restore: true, Remove: true}
	return save(s, j)
}

func validateCapturedStage(entry *outputEntry) error {
	if err := checkStage(entry); err != nil {
		return err
	}
	actual, err := snapshotPath(stageSpec(entry), nil)
	if err != nil {
		return err
	}
	if !sameSnapshot(actual, entry.Pending.After) {
		return fmt.Errorf("captured producer stage changed before publication")
	}
	container := entry.Spec
	container.Mode = "tree"
	container.Target = entry.Pending.Directory
	all, err := snapshotPath(container, nil)
	if err != nil {
		return err
	}
	if !sameSnapshot(all, entry.Pending.Container) {
		return fmt.Errorf("producer stage contains unknown extra paths")
	}
	return nil
}

func validateRetiredStage(entry *outputEntry) error {
	p := entry.Pending
	if _, err := os.Lstat(p.Directory); os.IsNotExist(err) {
		return nil
	} else if err != nil {
		return err
	}
	if entry.Spec.Mode == "tree" && !p.Remove || p.ContainerIdentity == "" {
		return fmt.Errorf("retired producer stage path was replaced by foreign data")
	}
	id, err := directoryIdentity(p.Directory)
	if err != nil {
		return err
	}
	if id != p.ContainerIdentity {
		return fmt.Errorf("retired producer stage container was replaced")
	}
	spec := entry.Spec
	spec.Mode = "tree"
	spec.Target = p.Directory
	actual, err := snapshotPath(spec, nil)
	if err != nil {
		return err
	}
	for path, value := range actual {
		if p.Container[path] != value {
			return fmt.Errorf("producer stage cleanup contains user changes")
		}
	}
	return nil
}

func retireJournal(s scope, j *journal) error {
	if len(j.Entries) != 0 || j.Restoring {
		return fmt.Errorf("repository output journal still owns resources")
	}
	if err := save(s, j); err != nil {
		return err
	}
	expected, err := json.Marshal(j)
	if err != nil {
		return err
	}
	expected = append(expected, '\n')
	if err = devsession.ValidatePrivateFile(s.path); err != nil {
		return err
	}
	before, err := os.Lstat(s.path)
	if err != nil {
		return err
	}
	actual, err := os.ReadFile(s.path)
	if err != nil {
		return err
	}
	after, err := os.Lstat(s.path)
	if err != nil {
		return err
	}
	if !os.SameFile(before, after) || !bytes.Equal(actual, expected) {
		return fmt.Errorf("completed repository journal changed before retirement")
	}
	return os.Remove(s.path)
}
