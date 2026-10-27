package devworkspace

import (
	"context"
	"debug/buildinfo"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/omniviewdev/omniview/internal/devcompose"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"
	"github.com/omniviewdev/omniview/internal/devsource"
	"github.com/omniviewdev/omniview/internal/instance"
)

// BuildNode is one serial output owner. Consumers may inspect this list, but
// must not execute nodes concurrently with Bootstrap or Watch.
type BuildNode struct {
	ID           string   `json:"id"`
	Directory    string   `json:"directory"`
	PNPMVersion  string   `json:"pnpmVersion,omitempty"`
	Dependencies []string `json:"dependencies,omitempty"`
	PluginID     string   `json:"pluginID,omitempty"`
	Kind         string   `json:"kind"`
}

type HostBuildRequest struct {
	Workspace           Workspace
	SDKDirectory        string
	ExpectedSDKRevision string
	SDKSource           devsource.Identity
	// Generated bindings, JS exports and frontend assets are already built.
	// The callback builds the actual selected host binary, without another
	// bindings/frontend writer. A native/server target is an orchestrator choice.
}

type BuildEvent struct {
	Node  string `json:"node"`
	Phase string `json:"phase"` // building, ready, error, invalidated
	Error string `json:"error,omitempty"`
}

type BuildOptions struct {
	// The current owned supervisor generation authorizes generated build outputs.
	Generation string
	// An already-owned UUID profile runtime cache, never a source-tree cache.
	GoBuildCacheDirectory string
	// Must be independently supplied by the reviewed SDK barrier, not BaseCommit.
	ExpectedSDKRevision string
	// Required trusted local-source verifier; normally devsource.Verify, or an
	// explicit per-workspace VerifyWithOptions adapter for isolation-core work.
	VerifySDKSource func(context.Context, string, string) (devsource.Identity, error)
	// HostBuild must compile the selected host (including native/module flags).
	HostBuild func(context.Context, HostBuildRequest) error
	// Optional real Task adapter. Output must remain exclusively in outputDirectory.
	// An adapter may add explicit host GO_MODFILE/BUILD_FLAGS task variables.
	Bindings func(ctx context.Context, hostDirectory, outputDirectory string) error
	Output   io.Writer
	OnEvent  func(BuildEvent)
}

type BuildGraph struct {
	Nodes       []BuildNode `json:"nodes"`
	workspace   Workspace
	plan        linkPlan
	options     BuildOptions
	manager     *Manager
	name        string
	run         func(context.Context, string, string, ...string) ([]byte, error)
	runProducer func(context.Context, string, []string, string, ...string) ([]byte, error)
	mu          sync.Mutex
	toolchainMu sync.Mutex
	toolchains  map[string]pnpmToolchain

	// Only the owned supervisor selects embedded assets rather than live Vite.
	// Its watch transaction must rebuild the host after publishing frontend dist.
	rebuildEmbeddedFrontend bool
}

// NewBuildGraph accepts an applied, successfully installed link overlay even if
// dist exports do not exist yet. Bootstrap resolves exports only after building;
// it never mistakes a failed installer or peer check for a missing-dist issue.
func (m *Manager) NewBuildGraph(ctx context.Context, name string, opts BuildOptions) (*BuildGraph, error) {
	w, err := m.Inspect(ctx, name)
	if err != nil {
		return nil, err
	}
	profile, err := profileFor(w, m.options.Home, opts.Generation)
	if err != nil {
		return nil, err
	}
	if opts.GoBuildCacheDirectory != filepath.Join(profile.RuntimeRoot, "go-build") {
		return nil, fmt.Errorf("build cache must be the selected UUID profile runtime cache")
	}
	if err = devcontract.ValidateDefaultProfileOwnership(m.options.Home, w.Manifest.WorkspaceID); err != nil {
		return nil, err
	}
	j, err := loadLinkJournal(w)
	if err != nil {
		return nil, err
	}
	if j.Phase != "linked" || !sameManifest(j.Manifest, w.Manifest) {
		return nil, devcontract.Fail(3, "build_links_not_applied", "apply the selected dependency overlay successfully before building")
	}
	if err = j.Evidence.validateRoots(j.Plan.Roots); err != nil {
		return nil, err
	}
	if err = checkLinkFiles(w.Root, j); err != nil {
		return nil, err
	}
	if j.Plan.Composition == nil {
		return nil, fmt.Errorf("selected dependency composition is absent")
	}
	if err = devcompose.CheckInputs(*j.Plan.Composition); err != nil {
		return nil, err
	}
	g, err := compileBuildGraph(w, j.Plan, opts)
	if err != nil {
		return nil, err
	}
	g.manager = m
	g.name = name
	return g, nil
}

var reviewedSDKRevision = regexp.MustCompile(`^[0-9a-f]{40}([0-9a-f]{24})?$`)

func compileBuildGraph(w Workspace, p linkPlan, opts BuildOptions) (*BuildGraph, error) {
	if opts.Generation == "" {
		return nil, fmt.Errorf("the current owned build generation is required")
	}
	cache, err := devcontract.CanonicalPath(opts.GoBuildCacheDirectory)
	if err != nil || !filepath.IsAbs(opts.GoBuildCacheDirectory) || cache != filepath.Clean(opts.GoBuildCacheDirectory) || cache == w.Root || inside(w.Root, cache) {
		return nil, fmt.Errorf("a canonical UUID runtime Go build cache outside source trees is required")
	}
	info, err := os.Lstat(cache)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return nil, fmt.Errorf("owned Go build cache must already exist")
	}
	if opts.HostBuild == nil {
		return nil, fmt.Errorf("a real selected-host build callback is required")
	}
	if opts.VerifySDKSource == nil {
		return nil, fmt.Errorf("a real selected SDK source verifier is required")
	}
	if !reviewedSDKRevision.MatchString(opts.ExpectedSDKRevision) {
		return nil, fmt.Errorf("an independently reviewed full SDK commit is required")
	}
	if p.SDK == "" {
		return nil, fmt.Errorf("a selected local SDK source is required for trusted builds")
	}
	g := &BuildGraph{workspace: w, plan: p, options: opts}
	g.run = g.command
	g.runProducer = g.commandWithEnvironment
	nodes, err := planBuildNodes(w)
	if err != nil {
		return nil, err
	}
	g.Nodes = nodes
	return g, nil
}

// Both native bootstrap and build-only profiling use the same dependency order.
func planBuildNodes(w Workspace) ([]BuildNode, error) {
	var nodes []BuildNode
	host := ""
	repos := map[string]string{}
	for _, r := range w.Manifest.Repositories {
		repos[r.ID] = filepath.Join(w.Root, r.Directory)
		if r.ID == "omniview" {
			host = repos[r.ID]
		}
	}
	if host == "" {
		return nil, fmt.Errorf("selected host source is missing")
	}
	version, err := pinnedLinkVersion(host)
	if err != nil {
		return nil, err
	}
	add := func(id, dir, pin, kind string, deps ...string) {
		nodes = append(nodes, BuildNode{ID: id, Directory: dir, PNPMVersion: pin, Kind: kind, Dependencies: append([]string(nil), deps...)})
	}
	add("bindings", host, "", "bindings")
	uiDeps := []string{}
	if w.Manifest.Links.UIRepositoryID != nil {
		ui := repos[*w.Manifest.Links.UIRepositoryID]
		pin, e := pinnedLinkVersion(ui)
		if e != nil {
			return nil, e
		}
		add("base-ui", filepath.Join(ui, "packages/base-ui"), pin, "javascript")
		add("ai-ui", filepath.Join(ui, "packages/ai-ui"), pin, "javascript", "base-ui")
		add("editors", filepath.Join(ui, "packages/editors"), pin, "javascript", "base-ui")
		uiDeps = []string{"base-ui", "ai-ui", "editors"}
	}
	packageDeps := append([]string(nil), uiDeps...)
	if w.Manifest.Links.HostPackages {
		add("providers", filepath.Join(host, "packages/omniviewdev-providers"), version, "javascript")
		runtimeDeps := append([]string{"bindings", "providers"}, uiDeps...)
		add("runtime", filepath.Join(host, "packages/omniviewdev-runtime"), version, "javascript", runtimeDeps...)
		add("vite-plugin", filepath.Join(host, "packages/omniviewdev-vite-plugin"), version, "javascript", "runtime")
		packageDeps = append(packageDeps, "providers", "runtime", "vite-plugin")
	}
	frontendDeps := append([]string(nil), packageDeps...)
	for _, plugin := range w.Manifest.Plugins {
		source := repos[plugin.RepositoryID]
		if source == "" {
			return nil, fmt.Errorf("plugin %s has no selected source", plugin.ID)
		}
		frontend := source
		if _, e := os.Stat(filepath.Join(source, "ui/package.json")); e == nil {
			frontend = filepath.Join(source, "ui")
		}
		if _, e := os.Stat(filepath.Join(frontend, "package.json")); e == nil {
			pin, e := pinnedLinkVersion(frontend)
			if e != nil {
				return nil, e
			}
			id := "plugin-ui:" + plugin.ID
			add(id, frontend, pin, "javascript", packageDeps...)
			frontendDeps = append(frontendDeps, id)
		} else if !os.IsNotExist(e) {
			return nil, e
		}
		if _, e := os.Stat(filepath.Join(source, "go.mod")); e == nil {
			add("plugin-backend:"+plugin.ID, source, "", "plugin-backend")
			nodes[len(nodes)-1].PluginID = plugin.ID
		} else if !os.IsNotExist(e) {
			return nil, e
		}
	}
	add("host-frontend", host, version, "javascript", frontendDeps...)
	add("host-backend", host, "", "host-backend", "host-frontend")
	return nodes, nil
}

func (g *BuildGraph) emit(id, phase string, err error) {
	if g.options.OnEvent == nil {
		return
	}
	event := BuildEvent{Node: id, Phase: phase}
	if err != nil {
		event.Error = safeCompilerDiagnostic(err.Error(), g.workspace.Root)
	}
	g.options.OnEvent(event)
}

func (g *BuildGraph) command(ctx context.Context, dir, program string, args ...string) ([]byte, error) {
	return g.commandWithEnvironment(ctx, dir, nil, program, args...)
}

func (g *BuildGraph) commandWithEnvironment(ctx context.Context, dir string, environment []string, program string, args ...string) ([]byte, error) {
	if program == "pnpm" {
		selectedProgram, selectedArgs, err := g.PNPMCommand(ctx, devcompose.Version, args...)
		if err != nil {
			return nil, err
		}
		program, args = selectedProgram, selectedArgs
	}
	cmd := exec.Command(program, args...)
	cmd.Dir = dir
	// Module selection belongs to the selected actual go.mod, not ambient flags.
	// Host-only native modfiles are supplied explicitly by the host callback.
	for _, entry := range os.Environ() {
		key, _, _ := strings.Cut(entry, "=")
		if strings.EqualFold(key, "pnpm_config_pm_on_fail") || workspaceRootEnvironment(key) {
			continue
		}
		switch key {
		case "GOWORK", "GOFLAGS", "GOROOT", "GOCACHE", "NODE_PATH", "GO_MODFILE", "OMNIVIEW_PNPM_NODE_PATH",
			"OMNIVIEW_BUILD_OUTPUT_DIRECTORY", "OMNIVIEW_SHIMS_OUTPUT_DIRECTORY", "OMNIVIEW_SHIMS_SOURCE_DIRECTORY",
			"OMNIVIEW_YAML_WORKER_OUTPUT_FILE", "OMNIVIEW_VITE_CACHE_DIRECTORY":
			continue
		}
		cmd.Env = append(cmd.Env, entry)
	}
	cmd.Env = append(cmd.Env, "GOWORK=off", "GOFLAGS=", "OMNIVIEW_PNPM_NODE_PATH=")
	if g.options.GoBuildCacheDirectory != "" {
		cmd.Env = append(cmd.Env, "GOCACHE="+g.options.GoBuildCacheDirectory)
	}
	cmd.Env = append(cmd.Env, environment...)
	var output strings.Builder
	cmd.Stdout = &output
	stderr := &childOutput{output: g.options.Output}
	cmd.Stderr = stderr
	err := RunRepositoryCommand(ctx, cmd, devsession.ProcessOwner{WorkspaceID: g.workspace.Manifest.WorkspaceID, Generation: g.options.Generation, Role: "build-command", Source: dir})
	if g.options.Output != nil && output.Len() > 0 {
		_, _ = io.WriteString(g.options.Output, output.String())
	}
	if err != nil {
		return nil, errors.Join(err, fmt.Errorf("%s failed in selected checkout:\n%s", program, safeCompilerDiagnostic(output.String()+"\n"+stderr.text, g.workspace.Root)))
	}
	return []byte(output.String()), nil
}

// verifySDK resolves the actual consumer module graph, then binds its exact
// live source to the independently reviewed fixed-capability baseline.
func (g *BuildGraph) verifySDK(ctx context.Context, consumer string) (devsource.Identity, error) {
	var identity devsource.Identity
	raw, err := g.run(ctx, consumer, "go", "list", "-m", "-json", linkedSDK)
	if err != nil {
		return identity, err
	}
	var module struct {
		Path, Dir string
		Replace   *struct{ Dir, Version string }
	}
	if err = json.Unmarshal(raw, &module); err != nil {
		return identity, err
	}
	dir := module.Dir
	if module.Replace != nil {
		dir = module.Replace.Dir
		if module.Replace.Version != "" {
			return identity, fmt.Errorf("SDK replacement must be selected local source")
		}
	}
	actual, err := devcontract.CanonicalPath(dir)
	if err != nil {
		return identity, err
	}
	selected, err := devcontract.CanonicalPath(g.plan.SDK)
	if err != nil {
		return identity, err
	}
	if module.Path != linkedSDK || dir == "" || actual != selected {
		return identity, fmt.Errorf("effective SDK source differs from selected feature source")
	}
	identity, err = g.options.VerifySDKSource(ctx, selected, g.options.ExpectedSDKRevision)
	if err != nil {
		return identity, err
	}
	if identity.Directory != selected || identity.ReviewedRevision != g.options.ExpectedSDKRevision || !sourceDigestPattern.MatchString(identity.SourceDigest) {
		return devsource.Identity{}, fmt.Errorf("SDK verifier returned a different or incomplete selected source identity")
	}
	return identity, nil
}

var sourceDigestPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)

func (g *BuildGraph) verifyUnchangedSDK(ctx context.Context, consumer string, before devsource.Identity) error {
	after, err := g.verifySDK(ctx, consumer)
	if err != nil {
		return err
	}
	if after != before {
		return fmt.Errorf("selected SDK source changed during build; artifact was not attested")
	}
	return nil
}

func (g *BuildGraph) buildNode(ctx context.Context, n BuildNode) error {
	switch n.Kind {
	case "bindings":
		return g.buildBindings(ctx, n)
	case "javascript":
		return g.buildJavaScript(ctx, n)
	case "plugin-backend":
		before, err := g.verifySDK(ctx, n.Directory)
		if err != nil {
			return err
		}
		prepared, err := PrepareGeneratedTree(g.workspace, "build/"+n.PluginID, g.options.Generation)
		if err != nil {
			return err
		}
		stagedBinary := filepath.Join(prepared.Directory, "plugin")
		_, buildErr := g.run(ctx, n.Directory, "go", "build", "-o", stagedBinary, "./pkg")
		if errors.Is(buildErr, errOwnedCommandUncertain) {
			return errors.Join(buildErr, prepared.stageFile.Close())
		}
		// Proven terminal failures may leave real controlled partial output.
		// Unknown descendant lifetimes above retain the durable writing intent.
		if err = errors.Join(buildErr, RecordGeneratedTree(prepared)); err != nil {
			return err
		}
		binary := filepath.Join(prepared.Destination, "plugin")
		if err := g.verifyUnchangedSDK(ctx, n.Directory, before); err != nil {
			return err
		}
		info, err := buildinfo.ReadFile(binary)
		if err != nil {
			return fmt.Errorf("built plugin has no inspectable Go module identity: %w", err)
		}
		includesSDK := false
		for _, dependency := range info.Deps {
			if dependency.Path == linkedSDK {
				includesSDK = true
				break
			}
		}
		if !includesSDK {
			return fmt.Errorf("built plugin does not include the selected SDK dependency")
		}
		// Trusted local rebuild binds binary bytes to the exact dirty source snapshot.
		return instance.RecordBuiltArtifactSource(g.workspace.ResolvedWorkspace, n.PluginID, binary, before.ReviewedRevision, before.SourceDigest)
	case "host-backend":
		before, err := g.verifySDK(ctx, n.Directory)
		if err != nil {
			return err
		}
		if err := g.options.HostBuild(ctx, HostBuildRequest{Workspace: g.workspace, SDKDirectory: g.plan.SDK, ExpectedSDKRevision: g.options.ExpectedSDKRevision, SDKSource: before}); err != nil {
			return err
		}
		return g.verifyUnchangedSDK(ctx, n.Directory, before)
	default:
		return fmt.Errorf("unknown build node kind %q", n.Kind)
	}
}

func (g *BuildGraph) withBuildLock(ctx context.Context, fn func() error) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	lockPath, err := GeneratedLockPath(g.workspace, "buildgraph")
	if err != nil {
		return err
	}
	lockCtx, cancel := context.WithTimeout(ctx, 100*time.Millisecond)
	lock, err := devsession.AcquirePrivateLock(lockCtx, filepath.Dir(lockPath), filepath.Base(lockPath))
	cancel()
	if err != nil {
		return fmt.Errorf("cannot acquire owned workspace build lock: %w", err)
	}
	defer lock.Close()
	if err = ctx.Err(); err != nil {
		return err
	}
	return fn()
}

func (g *BuildGraph) execute(ctx context.Context, nodes []BuildNode) error {
	for _, n := range nodes {
		if err := ctx.Err(); err != nil {
			return err
		}
		g.emit(n.ID, "building", nil)
		if err := g.buildNode(ctx, n); err != nil {
			g.emit(n.ID, "error", err)
			return err
		}
		g.emit(n.ID, "ready", nil)
	}
	return nil
}

// Bootstrap audits the complete installed composition before any producer.
// It never reinstalls dependencies under live consumers.
func (g *BuildGraph) Bootstrap(ctx context.Context) error {
	return g.withBuildLock(ctx, func() error {
		if err := g.auditComposition(ctx); err != nil {
			return err
		}
		if err := g.execute(ctx, g.Nodes); err != nil {
			return err
		}
		if g.manager == nil {
			return fmt.Errorf("build graph has no selected workspace manager")
		}
		report, err := g.manager.InspectLinks(ctx, g.name)
		if err != nil {
			return err
		}
		if report.Phase != "linked" {
			return fmt.Errorf("dependency overlay is not linked")
		}
		for _, r := range report.Resolutions {
			if r.Problem != "" {
				return fmt.Errorf("effective dependency unresolved for %s in %s: %s", r.Package, r.Consumer, r.Problem)
			}
		}
		return g.auditComposition(ctx)
	})
}

func (g *BuildGraph) auditComposition(ctx context.Context) error {
	if g.plan.Composition == nil {
		return fmt.Errorf("selected dependency composition is absent; stop and reconfigure")
	}
	p := *g.plan.Composition
	if err := devcompose.Validate(g.workspace.ResolvedWorkspace, p); err != nil {
		return err
	}
	j, err := loadLinkJournal(g.workspace)
	if err != nil {
		return err
	}
	if j.Phase != "linked" || !sameManifest(j.Manifest, g.workspace.Manifest) {
		return fmt.Errorf("dependency composition is not linked; stop and reconfigure")
	}
	if err := checkLinkFiles(g.workspace.Root, j); err != nil {
		return err
	}
	// Check peers even when a source edit would be hidden by pnpm install's
	// warm/up-to-date fast path. Never mutate modules to repair a running graph.
	_, peerErr := g.run(ctx, p.Root, "pnpm", "-r", "peers", "check", "--json", "--lockfile-only")
	inputErr := devcompose.CheckInputs(p)
	fileErr := checkLinkFiles(g.workspace.Root, j)
	if peerErr != nil || inputErr != nil || fileErr != nil {
		return errors.Join(peerErr, inputErr, fileErr, fmt.Errorf("dependency composition changed or peer audit failed; stop and explicitly reconfigure/link/bootstrap"))
	}
	return nil
}

// ViteEnvironment provides only selected absolute repository roots. Consumers
// must pass this to both host and plugin Vite children before their first launch.
func (g *BuildGraph) ViteEnvironment() ([]string, error) {
	roots := make([]string, 0, len(g.workspace.Manifest.Repositories))
	for _, r := range g.workspace.Manifest.Repositories {
		p, err := devcontract.CanonicalPath(filepath.Join(g.workspace.Root, r.Directory))
		if err != nil {
			return nil, err
		}
		roots = append(roots, p)
	}
	raw, err := json.Marshal(roots)
	if err != nil {
		return nil, err
	}
	return []string{"OMNIVIEW_VITE_ALLOWED_ROOTS=" + string(raw)}, nil
}
