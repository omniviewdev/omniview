package devworkspace

import (
	"context"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/omniviewdev/omniview/internal/devoutputs"
	"github.com/omniviewdev/omniview/internal/devsession"
)

// ManagedBuildHooks deliberately excludes Start/Stop; A08 owns plugin processes
// and source watchers. Adapters must resolve the currently active generation.
type ManagedBuildHooks interface {
	SetDependencyWatching(string, string, bool) error
	RebuildPluginGeneration(context.Context, string, string) error
}

type WatchChange struct {
	Paths          []string
	Nodes          []string
	SDKChanged     bool
	RuntimeChanged bool
}

type WatchHooks struct {
	Managed ManagedBuildHooks
	// Generations returns the currently owned managed backend generations. It
	// must not return an installation's stale generation after a host restart.
	Generations func(context.Context) (map[string]string, error)
	// WaitPluginReady must call A08 WaitReady for the supplied exact generation;
	// compilation, PID presence and log text alone do not satisfy readiness.
	WaitPluginReady func(context.Context, string, string) error
	// HostRebuildAndWait builds/restarts the intended host through its owned
	// supervisor and waits for actual host readiness. It returns IDs of plugins
	// already rebuilt AND ready by that restart, preventing duplicate rebuilds.
	HostRebuildAndWait func(context.Context, HostBuildRequest) (map[string]bool, error)
	// RefreshConsumers restarts affected Vite/shim consumers when necessary and
	// waits for their actual ready endpoints. CommitFeedback publishes the
	// deliberate browser reload only after this completes successfully.
	RefreshConsumers func(context.Context, WatchChange) error
	// BeginFeedback fences browser feedback before any affected producer runs.
	// CommitFeedback releases only the successfully completed transaction.
	BeginFeedback  func(context.Context, WatchChange) error
	CommitFeedback func(context.Context, WatchChange) error
	Debounce       time.Duration
}

func ignoredBuildDirectory(name string) bool {
	switch name {
	case "node_modules", "dist", "shims", "build", "bin", "vendor", "coverage", "storybook-static":
		return true
	}
	return strings.HasPrefix(name, ".")
}

func (g *BuildGraph) generatedSourceOutput(path string) bool {
	for _, n := range g.Nodes {
		if n.Kind == "javascript" && filepath.Dir(path) == n.Directory && devoutputs.IsViteConfigTemporaryFile(filepath.Base(path)) {
			return true
		}
		if n.ID == "bindings" {
			root := filepath.Join(n.Directory, "packages", "omniviewdev-runtime", "src", "bindings")
			if path == root || inside(root, path) {
				return true
			}
		}
		if n.ID == "host-frontend" && path == filepath.Join(n.Directory, "ui", "providers", "monaco", "yaml.worker.bundle.js") {
			return true
		}
	}
	return false
}

func sourceManifest(path string) bool {
	switch filepath.Base(path) {
	case "workspace.json", "plugin.yaml", "package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml", ".npmrc", ".pnpmfile.cjs", ".pnpmfile.mjs", "pnpmfile.cjs", "go.mod", "go.sum":
		return true
	}
	return false
}

// affected preserves topological order. CSS/JS changes exclude Go compilation
// unless the owned supervisor serves embedded frontend assets. Package/module
// manifests invalidate selection rather than changing running dependencies.
func (g *BuildGraph) affected(paths []string) ([]BuildNode, error) {
	selected := map[string]bool{}
	host := ""
	for _, n := range g.Nodes {
		if n.ID == "host-backend" {
			host = n.Directory
		}
	}
	for _, path := range paths {
		path = filepath.Clean(path)
		if sourceManifest(path) {
			return nil, fmt.Errorf("dependency graph invalidated by %s; stop and explicitly reconcile/link/bootstrap the selected graph", path)
		}
		if inside(g.plan.SDK, path) || path == g.plan.SDK {
			selected["bindings"] = true
			selected["host-backend"] = true
			continue
		}
		matched := false
		// Pick the most-specific package first, not the encompassing host root.
		for _, n := range g.Nodes {
			if n.Kind != "javascript" || n.ID == "host-frontend" {
				continue
			}
			if inside(n.Directory, path) || path == n.Directory {
				selected[n.ID] = true
				matched = true
			}
		}
		if matched {
			continue
		}
		if inside(host, path) {
			if strings.HasSuffix(path, ".go") {
				selected["bindings"] = true
				selected["host-backend"] = true
			} else {
				selected["host-frontend"] = true
			}
		}
	}
	for _, n := range g.Nodes {
		if n.Kind != "javascript" {
			continue
		}
		for _, dep := range n.Dependencies {
			if selected[dep] {
				selected[n.ID] = true
				break
			}
		}
	}
	if g.rebuildEmbeddedFrontend && selected["host-frontend"] {
		selected["host-backend"] = true
	}
	nodes := []BuildNode{}
	for _, n := range g.Nodes {
		if selected[n.ID] {
			nodes = append(nodes, n)
		}
	}
	return nodes, nil
}

func (g *BuildGraph) watchRoots() []string {
	// Include every selected JavaScript input so plugin peer/config changes
	// invalidate the composition even though A08 retains backend build ownership.
	roots := []string{g.plan.SDK}
	for _, r := range g.workspace.Manifest.Repositories {
		path := filepath.Join(g.workspace.Root, r.Directory)
		if path != g.plan.SDK {
			roots = append(roots, path)
		}
	}
	return roots
}

func (g *BuildGraph) addWatchTree(w *fsnotify.Watcher, root string) error {
	return filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return nil
		}
		if !entry.IsDir() {
			return nil
		}
		// Filtering events is too late: publication renames and removes generated
		// trees, which can invalidate their watches before queued events drain.
		if g.generatedSourceOutput(path) || path != root && ignoredBuildDirectory(entry.Name()) {
			return filepath.SkipDir
		}
		return w.Add(path)
	})
}

func (g *BuildGraph) disableManagedDependencies(ctx context.Context, h WatchHooks) (map[string]string, error) {
	generations, err := h.Generations(ctx)
	if err != nil {
		return nil, err
	}
	for id, generation := range generations {
		if err = h.Managed.SetDependencyWatching(id, generation, false); err != nil {
			return nil, err
		}
	}
	return generations, nil
}

func (g *BuildGraph) rebuildChange(ctx context.Context, paths []string, h WatchHooks) error {
	for _, path := range paths {
		if sourceManifest(path) {
			if err := g.auditComposition(ctx); err != nil {
				g.emit("graph", "invalidated", err)
				return err
			}
		}
	}
	nodes, err := g.affected(paths)
	if err != nil {
		g.emit("graph", "invalidated", err)
		return err
	}
	if len(nodes) == 0 {
		return nil
	}
	change := WatchChange{Paths: append([]string(nil), paths...)}
	hostChanged := false
	for _, path := range paths {
		if inside(g.plan.SDK, path) || path == g.plan.SDK {
			change.SDKChanged = true
		}
	}
	javascript := []BuildNode{}
	for _, n := range nodes {
		change.Nodes = append(change.Nodes, n.ID)
		if n.ID == "runtime" || n.ID == "vite-plugin" {
			change.RuntimeChanged = true
		}
		if n.Kind == "host-backend" {
			hostChanged = true
			continue
		}
		javascript = append(javascript, n)
	}
	return g.withBuildLock(ctx, func() error {
		if err := g.auditComposition(ctx); err != nil {
			return err
		}
		if err := h.BeginFeedback(ctx, change); err != nil {
			return err
		}
		// Ordinary dirty SDK APIs are trusted local development input, bound to the
		// reviewed isolation baseline and exact source identity on both build sides.
		if change.SDKChanged {
			for _, consumer := range g.plan.GoRoots {
				if _, err := g.verifySDK(ctx, consumer); err != nil {
					return err
				}
			}
		}
		if err := g.execute(ctx, javascript); err != nil {
			return err
		}
		alreadyReady := map[string]bool{}
		if hostChanged {
			host := ""
			for _, n := range g.Nodes {
				if n.ID == "host-backend" {
					host = n.Directory
				}
			}
			before, err := g.verifySDK(ctx, host)
			if err != nil {
				return err
			}
			g.emit("host-restart", "building", nil)
			ready, err := h.HostRebuildAndWait(ctx, HostBuildRequest{Workspace: g.workspace, SDKDirectory: g.plan.SDK, ExpectedSDKRevision: g.options.ExpectedSDKRevision, SDKSource: before})
			if err != nil {
				g.emit("host-restart", "error", err)
				return err
			}
			alreadyReady = ready
			// The native callback must also verify any explicit alternate module graph.
			if err = g.verifyUnchangedSDK(ctx, host, before); err != nil {
				return err
			}
			g.emit("host-restart", "ready", nil)
		}
		generations, err := g.disableManagedDependencies(ctx, h)
		if err != nil {
			return err
		}
		if change.SDKChanged {
			ids := make([]string, 0, len(generations))
			for id := range generations {
				ids = append(ids, id)
			}
			sort.Strings(ids)
			for _, id := range ids {
				generation := generations[id]
				if alreadyReady[id] {
					if err = h.WaitPluginReady(ctx, id, generation); err != nil {
						return err
					}
					continue
				}
				g.emit("plugin-rebuild:"+id, "building", nil)
				if err = h.Managed.RebuildPluginGeneration(ctx, id, generation); err == nil {
					err = h.WaitPluginReady(ctx, id, generation)
				}
				if err != nil {
					g.emit("plugin-rebuild:"+id, "error", err)
					return err
				}
				g.emit("plugin-rebuild:"+id, "ready", nil)
			}
		}
		if err := g.auditComposition(ctx); err != nil {
			return err
		}
		if err := h.RefreshConsumers(ctx, change); err != nil {
			return err
		}
		return h.CommitFeedback(ctx, change)
	})
}

// Watch is blocking and cancellation-owned. One workspace watcher owns output
// writes, while A08 retains plugin source watchers. Build failures are emitted
// and recover on the next edit; invalidated manifests and watcher I/O failures
// return to the supervisor for explicit reconfiguration, never auto-install.
func (g *BuildGraph) Watch(ctx context.Context, h WatchHooks) error {
	if h.Managed == nil || h.Generations == nil || h.WaitPluginReady == nil || h.HostRebuildAndWait == nil || h.RefreshConsumers == nil || h.BeginFeedback == nil || h.CommitFeedback == nil {
		return fmt.Errorf("managed generation, host supervisor, actual consumer readiness and paired feedback hooks are required")
	}
	lockPath, err := GeneratedLockPath(g.workspace, "watchgraph")
	if err != nil {
		return err
	}
	lockCtx, cancel := context.WithTimeout(ctx, 100*time.Millisecond)
	lock, err := devsession.AcquirePrivateLock(lockCtx, filepath.Dir(lockPath), filepath.Base(lockPath))
	cancel()
	if err != nil {
		return fmt.Errorf("cannot acquire owned workspace dependency watch lock: %w", err)
	}
	defer lock.Close()
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return err
	}
	defer w.Close()
	for _, root := range g.watchRoots() {
		if err = g.addWatchTree(w, root); err != nil {
			return err
		}
	}
	// Plugin module/metadata edits invalidate the graph; plugin Go source is not
	// recursively watched here and remains solely A08-owned.
	for _, plugin := range g.workspace.Manifest.Plugins {
		for _, r := range g.workspace.Manifest.Repositories {
			if r.ID != plugin.RepositoryID {
				continue
			}
			root := filepath.Join(g.workspace.Root, r.Directory)
			if err = w.Add(root); err != nil {
				return err
			}
			if _, statErr := os.Stat(filepath.Join(root, "ui")); statErr == nil {
				if err = w.Add(filepath.Join(root, "ui")); err != nil {
					return err
				}
			}
		}
	}
	if err = w.Add(g.workspace.Root); err != nil {
		return err
	}
	if _, err = g.disableManagedDependencies(ctx, h); err != nil {
		return err
	}
	// Restore the canonical watcher only if this generation still exists. Stop
	// and stale-generation errors cannot justify touching another process.
	defer func() {
		generations, e := h.Generations(context.WithoutCancel(ctx))
		if e == nil {
			for id, generation := range generations {
				_ = h.Managed.SetDependencyWatching(id, generation, true)
			}
		}
	}()
	delay := h.Debounce
	if delay <= 0 {
		delay = 350 * time.Millisecond
	}
	timer := time.NewTimer(delay)
	if !timer.Stop() {
		<-timer.C
	}
	defer timer.Stop()
	pending := map[string]bool{}
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case err, open := <-w.Errors:
			if !open {
				return fmt.Errorf("dependency watcher closed unexpectedly")
			}
			return err
		case event, open := <-w.Events:
			if !open {
				return fmt.Errorf("dependency watcher closed unexpectedly")
			}
			if event.Op&fsnotify.Chmod != 0 && event.Op&^fsnotify.Chmod == 0 {
				continue
			}
			name := event.Name
			if g.generatedSourceOutput(name) {
				continue
			}
			if event.Op&fsnotify.Create != 0 {
				if info, e := os.Lstat(name); e == nil && info.IsDir() {
					if ignoredBuildDirectory(filepath.Base(name)) {
						continue
					}
					if err = g.addWatchTree(w, name); err != nil {
						return err
					}
				}
			}
			// All selected source-policy inputs participate in composition freshness.
			relevant := sourceManifest(name)
			for _, root := range g.watchRoots() {
				if inside(root, name) || name == root {
					relevant = true
					break
				}
			}
			if !relevant {
				continue
			}
			relIgnored := false
			for _, root := range g.watchRoots() {
				if inside(root, name) {
					rel, _ := filepath.Rel(root, name)
					parts := strings.Split(filepath.ToSlash(rel), "/")
					for index, part := range parts {
						if ignoredBuildDirectory(part) && !(index == len(parts)-1 && sourceManifest(name)) {
							relIgnored = true
							break
						}
					}
				}
			}
			if relIgnored {
				continue
			}
			pending[name] = true
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
			timer.Reset(delay)
		case <-timer.C:
			paths := make([]string, 0, len(pending))
			for path := range pending {
				paths = append(paths, path)
			}
			sort.Strings(paths)
			if err = g.rebuildChange(ctx, paths, h); err != nil {
				if ctx.Err() != nil {
					return ctx.Err()
				}
				g.emit("graph", "error", err)
				for _, path := range paths {
					if sourceManifest(path) {
						return err
					}
				}
			} else {
				pending = map[string]bool{}
				g.emit("graph", "ready", nil)
			}
		}
	}
}
