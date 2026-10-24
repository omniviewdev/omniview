//go:build e2eapplication

package devworkspace

// A test-only adapter, not another supervisor implementation. The application
// fixture reuses exactly the retained handles, identity capture, descendant
// disposal and retry semantics used by the canonical workspace supervisor.
import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/omniviewdev/omniview/internal/devcompose"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devoutputs"
	"github.com/omniviewdev/omniview/internal/devsession"
	"github.com/omniviewdev/omniview/internal/devsource"
)

type ApplicationFixtureCommand struct {
	Directory        string                  `json:"directory"`
	Program          string                  `json:"program"`
	Args             []string                `json:"args"`
	Owner            devsession.ProcessOwner `json:"owner"`
	IdentityFile     string                  `json:"identityFile"`
	StoppedFile      string                  `json:"stoppedFile"`
	Environment      []string                `json:"-"`
	OutputWorkspace  string                  `json:"outputWorkspace,omitempty"`
	ProfileWorkspace string                  `json:"profileWorkspace,omitempty"`
}

type ApplicationFixtureStopped struct {
	Process       devcontract.ProcessIdentity `json:"process"`
	ChildrenEmpty bool                        `json:"childrenEmpty"`
}

func RunApplicationFixtureCommand(options ApplicationFixtureCommand, shutdown <-chan os.Signal) error {
	var writer *devoutputs.Writer
	if options.OutputWorkspace != "" {
		manager, err := Open(filepath.Dir(filepath.Dir(options.OutputWorkspace)), Options{Stopped: RequireStopped})
		if err != nil {
			return err
		}
		w, err := manager.Inspect(context.Background(), filepath.Base(options.OutputWorkspace))
		if err != nil {
			return err
		}
		host, err := w.RepositoryPath("omniview")
		if err != nil {
			return err
		}
		if w.Root != options.OutputWorkspace || host != options.Directory {
			return fmt.Errorf("Vite output owner differs from the actual selected host")
		}
		if err = RequireStopped(context.Background(), w.ResolvedWorkspace); err != nil {
			return err
		}
		writer, err = devoutputs.BeginVite(context.Background(), w.ResolvedWorkspace, host)
		if err != nil {
			return err
		}
		// The browser fixture already supplies a private per-profile Vite cache.
		// This capability additionally owns source-local config-loader outputs.
	}
	var supervisor *applicationFixtureSupervisor
	var startErr error
	if options.ProfileWorkspace != "" {
		supervisor, options.Environment, startErr = startApplicationFixtureSupervisor(options)
	}
	var child *ownedChild
	if startErr == nil {
		child, startErr = startOwnedChild(context.Background(), options.Directory, options.Environment, os.Stdout, options.Owner, nil, options.Program, options.Args...)
		if child != nil {
			supervisor.capture(child)
		}
	}
	if startErr == nil {
		startErr = devsession.WritePrivateJSON(options.IdentityFile, child.identity)
	}
	unexpectedExit := false
	if startErr == nil {
		var bridgeDone <-chan error
		if supervisor != nil {
			bridgeDone = supervisor.done
		}
		select {
		case <-shutdown:
		case <-child.done:
			unexpectedExit = true
		case err := <-bridgeDone:
			startErr = errors.Join(err, fmt.Errorf("actual application process bridge stopped unexpectedly"))
		}
	}
	for {
		if err := supervisor.stop(child); err != nil {
			// Do not exit and lose the actual retained handle on disposal failure.
			// The parent retains its private arena and can request another stop.
			fmt.Fprintln(os.Stderr, "application fixture retains an unproved owned child")
			<-shutdown
			continue
		}
		if err := writer.Finish(context.Background()); err != nil {
			return errors.Join(startErr, err)
		}
		if child == nil {
			return startErr
		}
		proofErr := devsession.WritePrivateJSON(options.StoppedFile, ApplicationFixtureStopped{Process: child.identity, ChildrenEmpty: true})
		if unexpectedExit {
			return errors.Join(startErr, proofErr, child.failure())
		}
		return errors.Join(startErr, proofErr)
	}
}

type ApplicationFixturePackages struct {
	Paths   WorkspacePaths `json:"paths"`
	Nodes   []BuildNode    `json:"nodes"`
	Program string         `json:"program"`
	Args    []string       `json:"args"`
}

// Return the canonical installed aggregate's actual launcher and producer order.
// This does not install aliases, invent versions, or duplicate the linker.
func (m *Manager) ApplicationFixturePackageCommands(ctx context.Context, target string) (ApplicationFixturePackages, error) {
	var result ApplicationFixturePackages
	scoped, err := m.linkCommandContext(ctx, target)
	if err != nil {
		return result, err
	}
	graph := scoped.Value(linkToolchainKey{}).(*BuildGraph)
	w := graph.workspace
	if w.Manifest.Links.UIRepositoryID == nil || !w.Manifest.Links.HostPackages {
		return result, fmt.Errorf("application cohort must select actual UI and host package outputs")
	}
	host, err := w.RepositoryPath("omniview")
	if err != nil {
		return result, err
	}
	if _, err = devcompose.Installed(w.ResolvedWorkspace, host); err != nil {
		return result, err
	}
	result.Program, result.Args, err = graph.PNPMCommand(scoped, devcompose.Version)
	if err != nil {
		return result, err
	}
	result.Paths, err = m.Paths(ctx, target)
	if err != nil {
		return result, err
	}
	result.Nodes, err = planBuildNodes(w)
	return result, err
}

// Build one actual planned producer without reuse/cache admission. The fixture
// calls each producer once; repository outputs still use canonical capabilities,
// so Unlink restores committed source instead of deleting ignored files.
func (m *Manager) BuildApplicationFixtureProducer(ctx context.Context, target, id, artifacts, revision string) error {
	scoped, err := m.linkCommandContext(ctx, target)
	if err != nil {
		return err
	}
	g := scoped.Value(linkToolchainKey{}).(*BuildGraph)
	if err = RequireStopped(scoped, g.workspace.ResolvedWorkspace); err != nil {
		return err
	}
	canonical, err := devcontract.CanonicalPath(artifacts)
	if err != nil || canonical != artifacts || !filepath.IsAbs(artifacts) || inside(g.workspace.Root, artifacts) {
		return fmt.Errorf("application artifacts must be a canonical invocation directory outside source")
	}
	info, err := os.Lstat(artifacts)
	if err != nil || !info.IsDir() || info.Mode().Perm()&0077 != 0 {
		return fmt.Errorf("application artifact directory must be private")
	}
	g.options.GoBuildCacheDirectory = scoped.Value(linkBuildCacheKey{}).(string)
	g.options.ExpectedSDKRevision = revision
	g.options.VerifySDKSource = devsource.Verify
	g.options.Output = os.Stderr
	// linkCommandContext constructs a toolchain-only graph. Bind its existing
	// production runners before SDK verification or any actual producer call.
	g.run = g.command
	g.runProducer = g.commandWithEnvironment
	nodes, err := planBuildNodes(g.workspace)
	if err != nil {
		return err
	}
	for _, node := range nodes {
		if node.ID != id {
			continue
		}
		return g.withBuildLock(scoped, func() error {
			switch node.Kind {
			case "bindings":
				return g.applicationFixtureBindings(scoped, node, artifacts)
			case "javascript":
				return g.applicationFixtureJavaScript(scoped, node)
			case "host-backend":
				return g.applicationFixtureServer(scoped, node, artifacts)
			default:
				return fmt.Errorf("producer %s uses an invocation-owned external binary output", id)
			}
		})
	}
	return fmt.Errorf("unknown application producer %s", id)
}

func (g *BuildGraph) applicationFixtureBindings(ctx context.Context, node BuildNode, artifacts string) (resultErr error) {
	before, err := g.verifySDK(ctx, node.Directory)
	if err != nil {
		return err
	}
	stage, err := devoutputs.Prepare(ctx, g.workspace.ResolvedWorkspace, node.Directory, devoutputs.Bindings)
	if err != nil {
		return err
	}
	published := false
	defer func() {
		if !published && !errors.Is(resultErr, errOwnedCommandUncertain) {
			resultErr = errors.Join(resultErr, stage.Abort(context.WithoutCancel(ctx)))
		}
	}()
	_, err = g.run(ctx, node.Directory, "task", "bindings", "DEV=true", "SERVER=true", "EXTRA_TAGS=devcontrol,e2eapplication", "SDK_SOURCE="+g.plan.SDK, "BINDINGS_OUTPUT_DIRECTORY="+stage.Directory, "HOST_MOD_OUTPUT_DIRECTORY="+filepath.Join(artifacts, "hostmod"), "GO_BUILD_CACHE_DIRECTORY="+g.options.GoBuildCacheDirectory)
	if err != nil {
		return err
	}
	if err = requireProducerFiles(stage.Directory); err != nil {
		return err
	}
	if err = g.verifyUnchangedSDK(ctx, node.Directory, before); err != nil {
		return err
	}
	if err = devoutputs.Publish(ctx, stage); err != nil {
		return err
	}
	published = true
	return nil
}

func (g *BuildGraph) applicationFixtureJavaScript(ctx context.Context, node BuildNode) (resultErr error) {
	if g.plan.Composition == nil {
		return fmt.Errorf("selected dependency composition is absent")
	}
	if err := devcompose.CheckInputs(*g.plan.Composition); err != nil {
		return err
	}
	pkg, err := readLinkPackage(node.Directory)
	if err != nil {
		return err
	}
	writer, err := devoutputs.BeginVite(ctx, g.workspace.ResolvedWorkspace, node.Directory)
	if err != nil {
		return err
	}
	defer func() {
		if !errors.Is(resultErr, errOwnedCommandUncertain) {
			resultErr = errors.Join(resultErr, writer.Finish(context.WithoutCancel(ctx)))
		}
	}()
	var stages []*devoutputs.Stage
	published := false
	defer func() {
		if !published && !errors.Is(resultErr, errOwnedCommandUncertain) {
			resultErr = errors.Join(resultErr, abortRepositoryStages(ctx, stages))
		}
	}()
	prepare := func(kind devoutputs.Producer) (*devoutputs.Stage, error) {
		stage, err := devoutputs.Prepare(ctx, g.workspace.ResolvedWorkspace, node.Directory, kind)
		if err == nil {
			stages = append(stages, stage)
		}
		return stage, err
	}
	dist, err := prepare(devoutputs.Distribution)
	if err != nil {
		return err
	}
	environment := append(append([]string{}, writer.Environment...), "OMNIVIEW_BUILD_OUTPUT_DIRECTORY="+dist.Directory)
	var shims, worker *devoutputs.Stage
	if node.ID == "vite-plugin" {
		shims, err = prepare(devoutputs.Shims)
		if err != nil {
			return err
		}
		environment = append(environment, "OMNIVIEW_SHIMS_OUTPUT_DIRECTORY="+shims.Directory, "OMNIVIEW_SHIMS_SOURCE_DIRECTORY="+filepath.Join(node.Directory, "shims"))
	}
	script := "build"
	if node.ID == "host-frontend" {
		worker, err = prepare(devoutputs.YAMLWorker)
		if err != nil {
			return err
		}
		environment = append(environment, "OMNIVIEW_YAML_WORKER_OUTPUT_FILE="+filepath.Join(worker.Directory, "yaml.worker.bundle.js"), "PRODUCTION=false")
		// Canonical linking deliberately ignores install scripts. Run the real
		// worker producer once, then Task build:server's DEV frontend recipe.
		if _, err = g.runProducer(ctx, node.Directory, environment, "pnpm", "run", "bundle:yaml-worker"); err != nil {
			return err
		}
		script = "build:dev"
	}
	if _, err = g.runProducer(ctx, node.Directory, environment, "pnpm", "run", script); err != nil {
		return err
	}
	if err = validateDistribution(pkg, dist.Directory, node.ID == "host-frontend"); err != nil {
		return err
	}
	if shims != nil {
		if err = requireProducerFiles(shims.Directory); err != nil {
			return err
		}
	}
	if worker != nil {
		if err = requireProducerFile(filepath.Join(worker.Directory, "yaml.worker.bundle.js")); err != nil {
			return err
		}
	}
	if err = devcompose.CheckInputs(*g.plan.Composition); err != nil {
		return err
	}
	if err = devoutputs.Publish(ctx, stages...); err != nil {
		return err
	}
	published = true
	return nil
}

func (g *BuildGraph) applicationFixtureServer(ctx context.Context, node BuildNode, artifacts string) error {
	before, err := g.verifySDK(ctx, node.Directory)
	if err != nil {
		return err
	}
	modfile, err := g.run(ctx, node.Directory, "task", "--silent", "host:prepare", "SDK_SOURCE="+g.plan.SDK, "HOST_MOD_OUTPUT_DIRECTORY="+filepath.Join(artifacts, "hostmod"), "GO_BUILD_CACHE_DIRECTORY="+g.options.GoBuildCacheDirectory)
	if err != nil {
		return err
	}
	path := strings.TrimSpace(string(modfile))
	if !filepath.IsAbs(path) || !inside(filepath.Join(artifacts, "hostmod"), path) {
		return fmt.Errorf("Task did not return an invocation-owned host modfile")
	}
	// Task build:server's DEV=true backend recipe, after staged bindings and
	// frontend publication. Do not call the aggregate target and rebuild them.
	_, err = g.run(ctx, node.Directory, "go", "build", "-tags", "server,devcontrol,e2eapplication", "-buildvcs=false", "-gcflags=all=-l", "-modfile="+path, "-o", filepath.Join(artifacts, "bin", "Omniview-server"), ".")
	if err != nil {
		return err
	}
	return g.verifyUnchangedSDK(ctx, node.Directory, before)
}
