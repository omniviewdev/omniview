package devoutputs

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"

	"github.com/google/uuid"
	"github.com/omniviewdev/omniview/internal/devcompose"
	"github.com/omniviewdev/omniview/internal/devcontract"
)

// Writer is a real process-lifetime capability. Finish is legal only after the
// actual command and its owned descendants have stopped, never on transport loss.
type Writer struct {
	Environment                 []string
	s                           scope
	keys                        []string
	immutable                   []string
	composition                 *devcompose.Plan
	token                       string
	checks                      map[string]string
	allocated                   map[string]snapshot
	mu                          sync.Mutex
	registered, ready, finished bool
}

func sourceHash(path string) (string, error) {
	info, err := os.Lstat(path)
	if os.IsNotExist(err) {
		return "absent", nil
	}
	if err != nil {
		return "", err
	}
	var raw []byte
	if info.Mode()&os.ModeSymlink != 0 {
		target, e := os.Readlink(path)
		if e != nil {
			return "", e
		}
		raw = []byte("link:" + target)
	} else {
		raw, err = os.ReadFile(path)
		if err != nil {
			return "", err
		}
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:]), nil
}
func newWriter(s scope) *Writer {
	return &Writer{s: s, token: uuid.NewString(), checks: map[string]string{}, allocated: map[string]snapshot{}}
}

func BeginInstall(ctx context.Context, w devcontract.ResolvedWorkspace, consumerRoot string) (*Writer, error) {
	s, err := newScope(w)
	if err != nil {
		return nil, err
	}
	if _, _, err = s.repository(consumerRoot); err != nil {
		return nil, err
	}
	roots, err := packageRoots(consumerRoot)
	if err != nil {
		return nil, err
	}
	specs := make([]specification, 0, len(roots))
	for _, root := range roots {
		spec, err := s.spec(root, modules)
		if err != nil {
			return nil, err
		}
		specs = append(specs, spec)
	}
	return beginInstall(ctx, s, specs, nil, false)
}

// BeginCompositionInstall reserves only the fixed feature modules directory and
// actual packages selected by the validated composition. The returned capability
// must outlive the install command and all its descendants; uncertain disposal
// must retain it without calling Finish.
func BeginCompositionInstall(ctx context.Context, w devcontract.ResolvedWorkspace, p devcompose.Plan) (*Writer, error) {
	if err := devcompose.Validate(w, p); err != nil {
		return nil, err
	}
	if err := devcompose.CheckInputs(p); err != nil {
		return nil, err
	}
	s, err := newScope(w)
	if err != nil {
		return nil, err
	}
	specs := make([]specification, 0, len(p.Packages)+1)
	aggregate, err := s.spec(w.Root, modules)
	if err != nil {
		return nil, err
	}
	specs = append(specs, aggregate)
	for _, pkg := range p.Packages {
		spec, err := s.spec(pkg.Path, modules)
		if err != nil {
			return nil, err
		}
		specs = append(specs, spec)
	}
	inputs := make([]string, 0, len(p.SourceHashes))
	for relative := range p.SourceHashes {
		path := filepath.Join(p.Root, filepath.FromSlash(relative))
		if !contains(p.Root, path) || path == p.Root {
			return nil, fmt.Errorf("composition source input escapes feature root")
		}
		inputs = append(inputs, path)
	}
	return beginInstall(ctx, s, specs, inputs, true)
}

func beginInstall(ctx context.Context, s scope, specs []specification, inputs []string, composition bool) (*Writer, error) {
	writer := newWriter(s)
	for _, spec := range specs {
		for _, name := range []string{"package.json", "pnpm-workspace.yaml", ".npmrc"} {
			inputs = append(inputs, filepath.Join(spec.Consumer, name))
		}
	}
	for _, path := range inputs {
		hash, err := sourceHash(path)
		if err != nil {
			return nil, err
		}
		writer.checks[path] = hash
	}
	err := locked(ctx, s, func(j *journal) error {
		if j.Restoring {
			return fmt.Errorf("repository restoration must finish before installation")
		}
		if !composition {
			aggregate, err := s.spec(s.workspace.Root, modules)
			if err != nil {
				return err
			}
			if j.Entries[keyOf(aggregate)] != nil {
				return fmt.Errorf("composed modules require aggregate composition installation")
			}
		}
		if composition {
			for _, entry := range j.Entries {
				if entry.Pending != nil || entry.Cleanup != nil || len(entry.Live) > 0 {
					return fmt.Errorf("composition installer overlaps an unfinished consumer writer")
				}
				selected := false
				for _, spec := range specs {
					if entry.Spec.Consumer == spec.Consumer {
						selected = true
						break
					}
				}
				if !selected {
					continue
				}
				switch entry.Spec.Kind {
				case loaderCache, typeCache, viteCache, loaderFiles:
					if err := validateEntry(ctx, entry, false); err != nil {
						return err
					}
				}
			}
		}
		childKeys := []string{}
		// Validate all immutable modules and independent caches before allocating
		// any producer-visible directory or registering an install token.
		for _, spec := range specs {
			for _, other := range j.Entries {
				if other.Pending == nil && other.Cleanup == nil && len(other.Live) == 0 {
					continue
				}
				// Loader stamps are a filename-filtered view of the consumer
				// directory, not a writer of all descendants (including modules).
				if other.Spec.Kind == loaderFiles {
					continue
				}
				if contains(spec.Target, other.Spec.Target) || contains(other.Spec.Target, spec.Target) {
					return fmt.Errorf("installer overlaps an unfinished repository writer: %s", other.Spec.Target)
				}
			}
			current, err := snapshotPath(spec, nil)
			if err != nil {
				return err
			}
			entry := j.Entries[keyOf(spec)]
			if entry == nil {
				if len(current) > 0 {
					return fmt.Errorf("preexisting node_modules is not independently journal-owned: %s", spec.Target)
				}
			} else {
				if entry.Pending != nil || entry.Cleanup != nil || len(entry.Live) > 0 {
					return fmt.Errorf("node_modules has an unfinished writer")
				}
				actual, err := snapshotPath(spec, entry.Exclude)
				if err != nil {
					return err
				}
				if !sameSnapshot(actual, physical(entry.Expected)) {
					return fmt.Errorf("owned node_modules was changed before installation")
				}
				// A stopped cache subtree may not be silently swallowed by an installer.
				for _, excluded := range entry.Exclude {
					childKey := filepath.Join(spec.Target, excluded) + "|" + string(cacheKind(excluded))
					child := j.Entries[childKey]
					if child == nil || len(child.Live) > 0 {
						return fmt.Errorf("installer overlaps an unfinished cache writer")
					}
					actual, err := snapshotPath(child.Spec, nil)
					if err != nil {
						return err
					}
					if !sameSnapshot(actual, physical(child.Expected)) {
						return fmt.Errorf("stopped cache changed before installer")
					}
					childKeys = append(childKeys, childKey)
				}
			}
		}
		if composition {
			j.RootIdentity = s.rootIdentity
		}
		for _, spec := range specs {
			key := keyOf(spec)
			entry := j.Entries[key]
			if entry == nil {
				entry = &outputEntry{Spec: spec, Expected: snapshot{}, Original: snapshot{}, Live: map[string]bool{}}
				j.Entries[key] = entry
			}
			if entry.Live == nil {
				entry.Live = map[string]bool{}
			}
			entry.Live[writer.token] = true
			writer.keys = append(writer.keys, key)
		}
		writer.keys = append(writer.keys, childKeys...)
		for _, key := range childKeys {
			entry := j.Entries[key]
			if entry.Live == nil {
				entry.Live = map[string]bool{}
			}
			entry.Live[writer.token] = true
		}
		if err := save(s, j); err != nil {
			return err
		}
		writer.registered = true
		for _, key := range writer.keys {
			entry := j.Entries[key]
			if len(physical(entry.Expected)) == 0 {
				mode := os.FileMode(0700)
				if entry.Spec.Kind == modules {
					mode = 0755
				}
				if err := os.Mkdir(entry.Spec.Target, mode); err != nil {
					return err
				}
				snapshot, err := snapshotPath(entry.Spec, entry.Exclude)
				if err != nil {
					return err
				}
				entry.Expected = snapshot
				writer.allocated[key] = entry.Expected
				if err := save(s, j); err != nil {
					return err
				}
			}
		}
		return nil
	})
	if err != nil {
		if writer.registered {
			err = errors.Join(err, writer.Finish(context.WithoutCancel(ctx)))
		}
		return nil, err
	}
	writer.ready = true
	return writer, nil
}

func cacheKind(name string) Producer {
	if name == ".vite-temp" {
		return loaderCache
	}
	return typeCache
}

// Another authorized producer may be replacing any cache payload right now.
// Its stable root identity, not an intermediate content hash, is the lifetime gate.
func validateLiveCacheRoot(entry *outputEntry) error {
	switch entry.Spec.Kind {
	case loaderCache, typeCache, viteCache, loaderFiles:
	default:
		return fmt.Errorf("non-cache output cannot have shared process writers")
	}
	original := entry.Expected["."]
	if original.Kind != "directory" || original.Identity == "" {
		return fmt.Errorf("live cache has no verified root identity")
	}
	if _, err := cleanPath(entry.Spec.Target); err != nil {
		return err
	}
	info, err := os.Lstat(entry.Spec.Target)
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("live cache directory was replaced")
	}
	identity, err := directoryIdentity(entry.Spec.Target)
	if err != nil {
		return err
	}
	if identity != original.Identity {
		return fmt.Errorf("live cache directory was replaced")
	}
	return nil
}

type viteBuildConsumer struct {
	modulesKey  string
	environment string
}

// ViteBuild owns one finite ordered canonical build, not reusable validation.
// Finish requires every actual producer and descendant to have joined.
type ViteBuild struct {
	writer    *Writer
	consumers map[string]viteBuildConsumer
}

func BeginViteBuild(ctx context.Context, w devcontract.ResolvedWorkspace, plan devcompose.Plan, consumers []string) (*ViteBuild, error) {
	if len(consumers) == 0 {
		return nil, fmt.Errorf("finite Vite build requires selected consumers")
	}
	if err := devcompose.Validate(w, plan); err != nil {
		return nil, err
	}
	if err := devcompose.CheckInputs(plan); err != nil {
		return nil, err
	}
	s, err := newScope(w)
	if err != nil {
		return nil, err
	}
	build := &ViteBuild{writer: newWriter(s), consumers: make(map[string]viteBuildConsumer, len(consumers))}
	for _, consumer := range consumers {
		if !filepath.IsAbs(consumer) || filepath.Clean(consumer) != consumer {
			return nil, fmt.Errorf("build consumer must be canonical")
		}
		canonical, err := cleanPath(consumer)
		if err != nil || canonical != consumer {
			return nil, fmt.Errorf("build consumer was redirected")
		}
		if _, duplicate := build.consumers[consumer]; duplicate {
			return nil, fmt.Errorf("duplicate build consumer")
		}
		selected := false
		for _, pkg := range plan.Packages {
			if pkg.Path == consumer {
				selected = true
				break
			}
		}
		if !selected {
			return nil, fmt.Errorf("build consumer is not a selected composition package")
		}
		repository, _, err := s.repository(consumer)
		if err != nil {
			return nil, err
		}
		if _, err = head(ctx, repository); err != nil {
			return nil, err
		}
		spec, err := s.spec(consumer, modules)
		if err != nil {
			return nil, err
		}
		build.consumers[consumer] = viteBuildConsumer{modulesKey: keyOf(spec)}
	}
	writer := build.writer
	writer.composition = &plan
	err = locked(ctx, s, func(j *journal) error {
		if j.Restoring {
			return fmt.Errorf("repository restoration must finish before build")
		}
		for _, entry := range j.Entries {
			if entry.Pending != nil || entry.Cleanup != nil || len(entry.Live) != 0 {
				return fmt.Errorf("finite build overlaps an unfinished repository writer")
			}
		}
		aggregateSpec, err := s.spec(w.Root, modules)
		if err != nil {
			return err
		}
		aggregateKey := keyOf(aggregateSpec)
		aggregate := j.Entries[aggregateKey]
		if aggregate == nil || aggregate.Expected["."].Kind != "directory" {
			return fmt.Errorf("finite build requires an owned installed aggregate")
		}
		// The entire immutable store is byte-validated at both transaction
		// boundaries. Its durable reservation blocks install/restore in between.
		if err = validateEntry(ctx, aggregate, false); err != nil {
			return err
		}
		for _, consumer := range consumers {
			entry := j.Entries[build.consumers[consumer].modulesKey]
			if entry == nil || entry.Expected["."].Kind != "directory" {
				return fmt.Errorf("build consumer modules are not independently owned")
			}
			if err = validateEntry(ctx, entry, false); err != nil {
				return err
			}
		}
		for _, consumer := range consumers {
			if err = writer.beginViteConsumer(ctx, j, consumer); err != nil {
				return err
			}
			selected := build.consumers[consumer]
			selected.environment = writer.Environment[0]
			build.consumers[consumer] = selected
			writer.Environment = writer.Environment[:0]
		}
		writer.immutable = make([]string, 0, len(consumers)+1)
		writer.immutable = append(writer.immutable, aggregateKey)
		for _, consumer := range consumers {
			writer.immutable = append(writer.immutable, build.consumers[consumer].modulesKey)
		}
		for _, key := range writer.immutable {
			entry := j.Entries[key]
			if entry.Live == nil {
				entry.Live = map[string]bool{}
			}
			entry.Live[writer.token] = true
		}
		writer.registered = true
		return save(s, j)
	})
	if err != nil {
		if writer.registered && ctx.Err() == nil {
			err = errors.Join(err, writer.Finish(context.WithoutCancel(ctx)))
		}
		return nil, err
	}
	writer.ready = true
	return build, nil
}

func (writer *Writer) validateBuildInputs() error {
	if err := devcompose.Validate(writer.s.workspace, *writer.composition); err != nil {
		return err
	}
	return devcompose.CheckInputs(*writer.composition)
}

func (writer *Writer) reservedModules(j *journal, key string) (*outputEntry, error) {
	entry := j.Entries[key]
	if entry == nil || entry.Spec.Kind != modules || entry.Pending != nil || entry.Cleanup != nil || len(entry.Live) != 1 || !entry.Live[writer.token] {
		return nil, fmt.Errorf("finite build reservation changed")
	}
	return entry, nil
}

// Environment checks each actual consumer immediately before its producer.
// Immutable aggregate content is never accepted from an intermediate image.
func (build *ViteBuild) Environment(ctx context.Context, consumerRoot string) (string, error) {
	selected, ok := build.consumers[consumerRoot]
	if !ok {
		return "", fmt.Errorf("consumer is outside this finite build")
	}
	writer := build.writer
	writer.mu.Lock()
	defer writer.mu.Unlock()
	if writer.finished {
		return "", fmt.Errorf("finite build already finished")
	}
	err := locked(ctx, writer.s, func(j *journal) error {
		for _, key := range writer.immutable {
			entry, err := writer.reservedModules(j, key)
			if err != nil {
				return err
			}
			expected := entry.Expected["."]
			info, err := os.Lstat(entry.Spec.Target)
			if err != nil {
				return err
			}
			if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm() != expected.Mode {
				return fmt.Errorf("reserved build modules root changed")
			}
			identity, err := directoryIdentity(entry.Spec.Target)
			if err != nil || identity != expected.Identity {
				return fmt.Errorf("reserved build modules root was replaced")
			}
		}
		entry, err := writer.reservedModules(j, selected.modulesKey)
		if err != nil {
			return err
		}
		actual, err := snapshotPath(entry.Spec, entry.Exclude)
		if err != nil {
			return err
		}
		if !sameSnapshot(actual, physical(entry.Expected)) {
			return fmt.Errorf("consumer modules changed before build")
		}
		for _, kind := range []Producer{loaderCache, typeCache, viteCache} {
			spec, err := writer.s.spec(consumerRoot, kind)
			if err != nil {
				return err
			}
			cache := j.Entries[keyOf(spec)]
			if cache == nil || cache.Pending != nil || cache.Cleanup != nil || len(cache.Live) != 1 || !cache.Live[writer.token] {
				return fmt.Errorf("finite build cache reservation changed")
			}
			if err = validateLiveCacheRoot(cache); err != nil {
				return err
			}
		}
		return writer.validateBuildInputs()
	})
	return selected.environment, err
}

func (build *ViteBuild) Finish(ctx context.Context) error {
	return build.writer.Finish(ctx)
}

func BeginVite(ctx context.Context, w devcontract.ResolvedWorkspace, consumerRoot string) (*Writer, error) {
	s, err := newScope(w)
	if err != nil {
		return nil, err
	}
	consumerRoot, err = cleanPath(consumerRoot)
	if err != nil {
		return nil, err
	}
	repository, _, err := s.repository(consumerRoot)
	if err != nil {
		return nil, err
	}
	if _, err = head(ctx, repository); err != nil {
		return nil, err
	}
	writer := newWriter(s)
	err = locked(ctx, s, func(j *journal) error {
		if j.Restoring {
			return fmt.Errorf("repository restoration must finish before Vite start")
		}
		// Package-local caches are independent mutable outputs. The composed
		// virtual store is immutable and never becomes a Vite cache exclusion.
		aggregateSpec, err := s.spec(s.workspace.Root, modules)
		if err != nil {
			return err
		}
		if aggregate := j.Entries[keyOf(aggregateSpec)]; aggregate != nil {
			if err := validateEntry(ctx, aggregate, false); err != nil {
				return err
			}
		}
		if err := writer.beginViteConsumer(ctx, j, consumerRoot); err != nil {
			return err
		}
		return save(s, j)
	})
	if err != nil {
		if writer.registered {
			err = errors.Join(err, writer.Finish(context.WithoutCancel(ctx)))
		}
		return nil, err
	}
	writer.ready = true
	return writer, nil
}

func (writer *Writer) beginViteConsumer(ctx context.Context, j *journal, consumerRoot string) error {
	s := writer.s
	moduleSpec, err := s.spec(consumerRoot, modules)
	if err != nil {
		return err
	}
	moduleKey := keyOf(moduleSpec)
	parent := j.Entries[moduleKey]
	if parent == nil {
		return fmt.Errorf("Vite requires independently owned node_modules; run controlled workspace linking first")
	}
	if parent.Pending != nil || parent.Cleanup != nil || len(parent.Live) > 0 {
		return fmt.Errorf("Vite cannot start during a modules writer")
	}
	current, err := snapshotPath(parent.Spec, parent.Exclude)
	if err != nil {
		return err
	}
	if !sameSnapshot(current, physical(parent.Expected)) {
		return fmt.Errorf("node_modules changed before Vite start")
	}
	if len(current) == 0 {
		return fmt.Errorf("controlled node_modules is missing; reinstall before starting Vite")
	}
	// Managed Vite uses the independently owned, preallocated node_modules
	// loader directory. Root-level timestamp files are not managed outputs.
	for _, kind := range []Producer{loaderCache, typeCache, viteCache} {
		spec, err := s.spec(consumerRoot, kind)
		if err != nil {
			return err
		}
		key := keyOf(spec)
		entry := j.Entries[key]
		if entry == nil {
			actual, err := snapshotPath(spec, nil)
			if err != nil {
				return err
			}
			switch kind {
			case loaderCache, typeCache:
				relative, _ := filepath.Rel(parent.Spec.Target, spec.Target)
				inherited := snapshot{}
				for path, value := range parent.Expected {
					if path == relative {
						inherited["."] = value
					} else if contains(relative, path) && path != relative {
						suffix, _ := filepath.Rel(relative, path)
						inherited[suffix] = value
					}
				}
				if !sameSnapshot(actual, inherited) {
					return fmt.Errorf("cache subtree contains unowned files")
				}
				filtered := snapshot{}
				for path, value := range parent.Expected {
					if path != relative && !contains(relative, path) {
						filtered[path] = value
					}
				}
				parent.Expected = filtered
				parent.Exclude = append(parent.Exclude, relative)
			case viteCache:
				if len(actual) > 0 {
					return fmt.Errorf("preexisting optimizer cache is not owned")
				}
			}
			entry = &outputEntry{Spec: spec, Expected: actual, Original: snapshot{}, Live: map[string]bool{}}
			j.Entries[key] = entry
		} else {
			if entry.Pending != nil || entry.Cleanup != nil {
				return fmt.Errorf("cache has unfinished publication")
			}
			if len(entry.Live) > 0 {
				if err := validateLiveCacheRoot(entry); err != nil {
					return err
				}
			} else {
				actual, err := snapshotPath(entry.Spec, nil)
				if err != nil {
					return err
				}
				if !sameSnapshot(actual, physical(entry.Expected)) {
					return fmt.Errorf("owned cache changed while stopped")
				}
			}
		}
		if entry.Live == nil {
			entry.Live = map[string]bool{}
		}
		entry.Live[writer.token] = true
		writer.keys = append(writer.keys, key)
		// Save allocation intent before any producer-visible root is created.
		if err = save(s, j); err != nil {
			return err
		}
		writer.registered = true
		expectedRoot := entry.Expected["."]
		if expectedRoot.Kind == "" || expectedRoot.Kind == "absent" {
			if kind == viteCache {
				if err = ensureMetadataDirectory(s, filepath.Dir(spec.Target)); err != nil {
					return err
				}
			}
			if err = os.Mkdir(spec.Target, 0700); err != nil {
				return err
			}
			entry.Expected, err = snapshotPath(spec, nil)
			if err != nil {
				return err
			}
			writer.allocated[key] = entry.Expected
			if err = save(s, j); err != nil {
				return err
			}
		}
		if kind == viteCache {
			writer.Environment = append(writer.Environment, "OMNIVIEW_VITE_CACHE_DIRECTORY="+spec.Target)
		}
	}
	return nil
}

func (writer *Writer) Finish(ctx context.Context) error {
	if writer == nil {
		return nil
	}
	writer.mu.Lock()
	defer writer.mu.Unlock()
	if writer.finished {
		return nil
	}
	if len(writer.immutable) > 0 && ctx.Err() != nil {
		return ctx.Err()
	}
	var sourceErr error
	err := locked(ctx, writer.s, func(j *journal) error {
		for _, key := range writer.immutable {
			entry, err := writer.reservedModules(j, key)
			if err != nil {
				return err
			}
			actual, err := snapshotPath(entry.Spec, entry.Exclude)
			if err != nil {
				return err
			}
			if !sameSnapshot(actual, physical(entry.Expected)) {
				return fmt.Errorf("immutable modules changed during finite build")
			}
		}
		// First validate identities for all capability roots, before recording any.
		snapshots := map[string]snapshot{}
		for _, key := range writer.keys {
			entry := j.Entries[key]
			if entry == nil || !entry.Live[writer.token] {
				if !writer.ready && writer.allocated[key] == nil {
					continue
				}
				return fmt.Errorf("process output writer capability is stale")
			}
			if len(entry.Live) > 1 {
				if err := validateLiveCacheRoot(entry); err != nil {
					return err
				}
				// A nil snapshot marks validated lifetime-only progress. The
				// surviving writer owns content until its actual terminal Finish.
				snapshots[key] = nil
				continue
			}
			actual, err := snapshotPath(entry.Spec, entry.Exclude)
			if err != nil {
				return err
			}
			original := entry.Expected["."]
			originalExists := original.Kind != "" && original.Kind != "absent"
			if len(actual) > 0 && !originalExists && !sameSnapshot(actual, writer.allocated[key]) {
				return fmt.Errorf("unverified producer root appeared during allocation")
			}
			if len(actual) > 0 && originalExists && (actual["."].Kind != "directory" || actual["."].Identity != original.Identity) {
				return fmt.Errorf("controlled writer output root was replaced")
			}
			snapshots[key] = actual
		}
		for path, expected := range writer.checks {
			actual, err := sourceHash(path)
			if err != nil {
				return err
			}
			if actual != expected {
				sourceErr = fmt.Errorf("package source configuration changed while installer was running: %s", path)
			}
		}
		if len(writer.immutable) > 0 {
			if err := writer.validateBuildInputs(); err != nil {
				return err
			}
			if err := errors.Join(ctx.Err(), sourceErr); err != nil {
				return err
			}
		}
		for key, actual := range snapshots {
			entry := j.Entries[key]
			delete(entry.Live, writer.token)
			if len(entry.Live) == 0 {
				entry.Expected = actual
			}
		}
		for _, key := range writer.immutable {
			delete(j.Entries[key].Live, writer.token)
		}
		if err := save(writer.s, j); err != nil {
			return err
		}
		writer.finished = true
		return nil
	})
	if err != nil {
		return err
	}
	return sourceErr
}

func sortedEntries(j *journal) []string {
	keys := make([]string, 0, len(j.Entries))
	for key := range j.Entries {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}
