//go:build e2eapplication && (darwin || linux)

package devworkspace

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devoutputs"
	"github.com/omniviewdev/omniview/internal/devsession"
	"github.com/omniviewdev/omniview/internal/instance"
)

func TestApplicationFixtureCommandUsesOwnedChildDrain(t *testing.T) {
	root := t.TempDir()
	owner := devsession.ProcessOwner{WorkspaceID: "f14566c4-5130-4e3f-aa09-3e49c63b29a6", Generation: NewGeneration(), Role: "host", Source: root}
	options := ApplicationFixtureCommand{Directory: root, Program: os.Args[0], Args: []string{"-test.run=^TestOwnedChildProcessFixture$"}, Owner: owner, IdentityFile: filepath.Join(root, "identity.json"), StoppedFile: filepath.Join(root, "stopped.json"), Environment: append(os.Environ(), "GOWORK=off", "OMNIVIEW_OWNED_CHILD_FIXTURE=descendant")}
	shutdown := make(chan os.Signal, 2)
	done := make(chan error, 1)
	go func() { done <- RunApplicationFixtureCommand(options, shutdown); close(done) }()
	t.Cleanup(func() {
		select {
		case shutdown <- os.Interrupt:
		default:
		}
		select {
		case <-done:
		case <-time.After(10 * time.Second):
			t.Error("owned adapter did not drain")
		}
	})
	var identity devcontract.ProcessIdentity
	deadline := time.NewTimer(10 * time.Second)
	defer deadline.Stop()
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		if err := devsession.ReadPrivateJSON(options.IdentityFile, &identity); err == nil {
			break
		}
		select {
		case <-ticker.C:
		case <-deadline.C:
			t.Fatal("actual child identity was not published")
		}
	}
	if err := devsession.VerifyOwnedProcess(identity, owner); err != nil {
		t.Fatal(err)
	}
	shutdown <- os.Interrupt
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-deadline.C:
		t.Fatal("actual owned child did not stop")
	}
	var stopped ApplicationFixtureStopped
	if err := devsession.ReadPrivateJSON(options.StoppedFile, &stopped); err != nil {
		t.Fatal(err)
	}
	if !stopped.ChildrenEmpty || stopped.Process != identity {
		t.Fatal("stopped proof lost actual captured process identity")
	}
	if err := devsession.VerifyOwnedProcess(identity, owner); !errors.Is(err, devsession.ErrProcessGone) {
		t.Fatalf("child exit not proven: %v", err)
	}
}

// This is a harness ownership contract, not a replacement for the selected-source
// application smoke. Use the existing compiler fixture to exercise real output
// capabilities and canonical restoration without building another application.
func TestApplicationFixtureProducerOutputsRestoreCanonicalSource(t *testing.T) {
	ctx := context.Background()
	g := graphFixture(t)
	install, err := devoutputs.BeginCompositionInstall(ctx, g.workspace.ResolvedWorkspace, *g.plan.Composition)
	if err != nil {
		t.Fatal(err)
	}
	writeGraphFixture(t, filepath.Join(g.workspace.Root, "node_modules", "fixture"), "aggregate\n")
	for _, pkg := range g.plan.Composition.Packages {
		writeGraphFixture(t, filepath.Join(pkg.Path, "node_modules", "fixture"), "consumer\n")
	}
	if err = install.Finish(ctx); err != nil {
		t.Fatal(err)
	}
	fixtureCompiler := g.runProducer
	g.runProducer = func(ctx context.Context, directory string, environment []string, program string, args ...string) ([]byte, error) {
		if len(args) > 0 && args[len(args)-1] == "build:dev" {
			args = append([]string{}, args...)
			args[len(args)-1] = "build"
		}
		return fixtureCompiler(ctx, directory, environment, program, args...)
	}
	g.run = func(_ context.Context, _ string, program string, args ...string) ([]byte, error) {
		if program == "go" {
			return json.Marshal(map[string]any{"Path": linkedSDK, "Dir": g.plan.SDK})
		}
		if program == "task" {
			for _, arg := range args {
				if path, ok := strings.CutPrefix(arg, "BINDINGS_OUTPUT_DIRECTORY="); ok {
					writeGraphFixture(t, filepath.Join(path, "index.ts"), "export const generated = true;\n")
					return nil, nil
				}
			}
		}
		return nil, os.ErrInvalid
	}
	for _, node := range g.Nodes {
		if node.Kind == "bindings" {
			if err = g.applicationFixtureBindings(ctx, node, t.TempDir()); err != nil {
				t.Fatal(err)
			}
		}
	}
	var consumers []string
	for _, node := range g.Nodes {
		if node.Kind == "javascript" {
			consumers = append(consumers, node.Directory)
		}
	}
	writer, err := devoutputs.BeginViteBuild(ctx, g.workspace.ResolvedWorkspace, *g.plan.Composition, consumers)
	if err != nil {
		t.Fatal(err)
	}
	var built []BuildNode
	for _, node := range g.Nodes {
		if node.Kind != "javascript" {
			continue
		}
		if err = g.applicationFixtureJavaScript(ctx, node, writer); err != nil {
			t.Fatalf("%s: %v", node.ID, err)
		}
		built = append(built, node)
		if _, err = os.Stat(filepath.Join(node.Directory, "dist")); err != nil {
			t.Fatal(err)
		}
	}
	if len(built) != 8 {
		t.Fatalf("missing selected producer coverage: %d", len(built))
	}
	if err = writer.Finish(ctx); err != nil {
		t.Fatal(err)
	}
	if err = RestoreRepositoryOutputs(ctx, g.workspace); err != nil {
		t.Fatal(err)
	}
	for _, node := range built {
		if _, err = os.Stat(filepath.Join(node.Directory, "dist")); !os.IsNotExist(err) {
			t.Fatalf("%s left unowned dist: %v", node.ID, err)
		}
	}
	host, _ := g.workspace.RepositoryPath("omniview")
	for relative, original := range map[string]string{
		"packages/omniviewdev-runtime/src/bindings/index.ts": "export const original = true;\n",
		"packages/omniviewdev-vite-plugin/shims/runtime.mjs": "export const original = true;\n",
		"ui/providers/monaco/yaml.worker.bundle.js":          "self.original = true;\n",
	} {
		data, readErr := os.ReadFile(filepath.Join(host, relative))
		if readErr != nil || string(data) != original {
			t.Fatalf("canonical source not restored for %s: %q %v", relative, data, readErr)
		}
	}
}

func TestApplicationFixtureProducerRetainsUncertainOutputWriter(t *testing.T) {
	ctx := context.Background()
	g := graphFixture(t)
	install, err := devoutputs.BeginCompositionInstall(ctx, g.workspace.ResolvedWorkspace, *g.plan.Composition)
	if err != nil {
		t.Fatal(err)
	}
	writeGraphFixture(t, filepath.Join(g.workspace.Root, "node_modules", "fixture"), "aggregate\n")
	for _, pkg := range g.plan.Composition.Packages {
		writeGraphFixture(t, filepath.Join(pkg.Path, "node_modules", "fixture"), "consumer\n")
	}
	if err = install.Finish(ctx); err != nil {
		t.Fatal(err)
	}
	g.runProducer = func(context.Context, string, []string, string, ...string) ([]byte, error) {
		return nil, errors.Join(errOwnedCommandUncertain, context.Canceled)
	}
	for _, node := range g.Nodes {
		if node.ID != "base-ui" {
			continue
		}
		err = g.buildApplicationFixture(ctx, []BuildNode{node}, t.TempDir(), func(_ string, run func() error) error { return run() })
		if !errors.Is(err, errOwnedCommandUncertain) {
			t.Fatal(err)
		}
	}
	if err = RestoreRepositoryOutputs(ctx, g.workspace); err == nil {
		t.Fatal("uncertain producer ownership was released")
	}
}

type applicationFixtureTransportEvidence struct {
	Socket                         string `json:"socket"`
	TemporaryDirectory             string `json:"temporaryDirectory"`
	BridgeRejectedUnselectedSource bool   `json:"bridgeRejectedUnselectedSource"`
}

func TestApplicationFixtureHostOwnsShortSocketAndRealBridge(t *testing.T) {
	arena, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"TMPDIR", "TMP", "TEMP", "OMNIVIEW_STARTUP_REPORT"} {
		t.Setenv(key, os.Getenv(key))
	}
	home := filepath.Join(arena, strings.Repeat("long-home-", 14))
	root := filepath.Join(arena, "profile")
	for _, path := range []string{home, filepath.Join(root, "artifact")} {
		if err = os.MkdirAll(path, 0700); err != nil {
			t.Fatal(err)
		}
	}
	id, generation := NewGeneration(), NewGeneration()
	manifest := devcontract.WorkspaceManifest{SchemaVersion: devcontract.SchemaVersion, WorkspaceID: id, Slug: "profile-a", DisplayName: "profile-a", Repositories: []devcontract.Repository{{ID: "omniview", Directory: "artifact", BaseRef: strings.Repeat("a", 40), BaseCommit: strings.Repeat("a", 40), Branch: "fixture"}}, Profile: devcontract.Profile{Kind: "development"}, Ports: devcontract.PortPolicy{Policy: "sticky"}}
	manifestPath := filepath.Join(root, "workspace.json")
	if err = devsession.WritePrivateJSON(manifestPath, manifest); err != nil {
		t.Fatal(err)
	}
	if err = devcontract.EnsureDefaultProfileOwnership(home, id); err != nil {
		t.Fatal(err)
	}
	evidenceFile := filepath.Join(arena, "transport.json")
	owner := devsession.ProcessOwner{WorkspaceID: id, Generation: generation, Role: "host", Source: filepath.Join(root, "artifact")}
	options := ApplicationFixtureCommand{Directory: root, Program: os.Args[0], Args: []string{"-test.run=^TestApplicationFixtureHostTransportChild$"}, Owner: owner, IdentityFile: filepath.Join(arena, "identity.json"), StoppedFile: filepath.Join(arena, "stopped.json"), ProfileWorkspace: manifestPath, Environment: []string{"PATH=" + os.Getenv("PATH"), "HOME=" + home, "GOWORK=off", devcontract.WorkspaceEnvironment + "=" + manifestPath, "OMNIVIEW_GENERATION=" + generation, "OMNIVIEW_APPLICATION_TRANSPORT_CHILD=" + evidenceFile}}
	shutdown := make(chan os.Signal, 2)
	done := make(chan error, 1)
	go func() { done <- RunApplicationFixtureCommand(options, shutdown); close(done) }()
	t.Cleanup(func() {
		select {
		case shutdown <- os.Interrupt:
		default:
		}
		select {
		case <-done:
		case <-time.After(10 * time.Second):
			t.Error("actual transport owner did not drain")
		}
	})
	var evidence applicationFixtureTransportEvidence
	deadline := time.NewTimer(10 * time.Second)
	defer deadline.Stop()
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		if err = devsession.ReadPrivateJSON(evidenceFile, &evidence); err == nil {
			break
		}
		select {
		case <-ticker.C:
		case <-deadline.C:
			t.Fatalf("actual host transport did not start: %v", err)
		}
	}
	expectedTMP := filepath.Join(home, ".omniview-dev", "profiles", id, "runtime", "tmp")
	if evidence.TemporaryDirectory != expectedTMP || !evidence.BridgeRejectedUnselectedSource {
		t.Fatalf("transport bypassed actual profile/bridge policy: %+v", evidence)
	}
	if len(evidence.Socket) > 103 || strings.HasPrefix(evidence.Socket, expectedTMP) {
		t.Fatalf("socket still depends on long general temporary root: %s", evidence.Socket)
	}
	connection, err := net.DialTimeout("unix", evidence.Socket, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	_ = connection.SetDeadline(time.Now().Add(time.Second))
	buffer := make([]byte, len("actual-owned-transport"))
	n, readErr := io.ReadFull(connection, buffer)
	connection.Close()
	if readErr != nil || string(buffer[:n]) != "actual-owned-transport" {
		t.Fatalf("real Unix socket exchange failed: %q %v", buffer[:n], readErr)
	}
	shutdown <- os.Interrupt
	select {
	case err = <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-deadline.C:
		t.Fatal("actual transport owner failed to stop")
	}
	var stopped ApplicationFixtureStopped
	if err = devsession.ReadPrivateJSON(options.StoppedFile, &stopped); err != nil || !stopped.ChildrenEmpty {
		t.Fatalf("real stopped proof missing: %v", err)
	}
	if err = devsession.ValidateUnixSocketDirectoriesRemoved(filepath.Dir(expectedTMP)); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(filepath.Dir(evidence.Socket)); !os.IsNotExist(err) {
		t.Fatalf("owned external socket namespace survived disposal: %v", err)
	}
}

// Real subprocess transport/ownership boundary, not a fake SDK/plugin service.
func TestApplicationFixtureHostTransportChild(t *testing.T) {
	evidenceFile := os.Getenv("OMNIVIEW_APPLICATION_TRANSPORT_CHILD")
	if evidenceFile == "" {
		return
	}
	profile, err := instance.Resolve(instance.Options{EnvironmentManifest: os.Getenv(devcontract.WorkspaceEnvironment), Generation: os.Getenv("OMNIVIEW_GENERATION"), Channel: "local"})
	if err != nil {
		t.Fatal(err)
	}
	if err = profile.PrepareRuntime(); err != nil {
		t.Fatal(err)
	}
	if err = os.MkdirAll(profile.Descriptor.StateRoot, 0700); err != nil {
		t.Fatal(err)
	}
	environment, err := instance.PluginEnvironment(profile.Descriptor.StateRoot, "workspace-probe", os.Environ())
	if err != nil {
		t.Fatal(err)
	}
	socketRoot := ""
	for _, entry := range environment {
		if value, ok := strings.CutPrefix(entry, "PLUGIN_UNIX_SOCKET_DIR="); ok {
			socketRoot = value
		}
	}
	if socketRoot == "" {
		t.Fatal("actual managed socket capability was not injected")
	}
	source, err := profile.Workspace.RepositoryPath("omniview")
	if err != nil {
		t.Fatal(err)
	}
	host, err := devsession.CaptureProcess(os.Getpid(), devsession.ProcessOwner{WorkspaceID: profile.Descriptor.WorkspaceID, Generation: profile.Descriptor.Generation, Role: "host", Source: source})
	if err != nil {
		t.Fatal(err)
	}
	client, err := devsession.NewProcessBridgeClient(devsession.ProcessBridgeConfig{Endpoint: os.Getenv("OMNIVIEW_PROCESS_BRIDGE_ENDPOINT"), TokenFile: os.Getenv("OMNIVIEW_PROCESS_BRIDGE_TOKEN_FILE"), WorkspaceFile: profile.Workspace.ManifestPath, WorkspaceID: profile.Descriptor.WorkspaceID, Generation: profile.Descriptor.Generation, Host: host})
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	_, bridgeErr := client.Start(ctx, devsession.ProcessStart{PluginID: "not-selected", PluginGeneration: NewGeneration(), Kind: "dev", Source: source})
	cancel()
	var typed *devcontract.Error
	if !errors.As(bridgeErr, &typed) || typed.Code != "invalid_process_source" {
		t.Fatalf("real bridge authentication/host capture/source admission failed: %v", bridgeErr)
	}
	path := filepath.Join(socketRoot, "plugin4294967295")
	listener, err := net.Listen("unix", path)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	go func() {
		connection, acceptErr := listener.Accept()
		if acceptErr == nil {
			_, _ = connection.Write([]byte("actual-owned-transport"))
			connection.Close()
		}
	}()
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(signals)
	if err = devsession.WritePrivateJSON(evidenceFile, applicationFixtureTransportEvidence{Socket: path, TemporaryDirectory: os.Getenv("TMPDIR"), BridgeRejectedUnselectedSource: true}); err != nil {
		t.Fatal(err)
	}
	<-signals
}

type applicationDeadlineEvidence struct {
	Producer, Descendant int
	Cache, Stage         string
}

func TestApplicationFixtureDeadlineProducerProcess(t *testing.T) {
	if os.Getenv("OMNIVIEW_APPLICATION_DEADLINE_PRODUCER") != "1" {
		return
	}
	cache, stage := os.Getenv("OMNIVIEW_VITE_CACHE_DIRECTORY"), os.Getenv("OMNIVIEW_BUILD_OUTPUT_DIRECTORY")
	if cache == "" || stage == "" {
		t.Fatal("actual producer capabilities are missing")
	}
	if err := os.WriteFile(filepath.Join(cache, "partial.js"), []byte("controlled partial compiler cache\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(stage, "index.js"), []byte("partial JS is not ready\n"), 0600); err != nil {
		t.Fatal(err)
	}
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(stop)
	descendant := exec.Command(os.Args[0], "-test.run=^TestOwnedChildProcessFixture$")
	descendant.Env = append(os.Environ(), "OMNIVIEW_OWNED_CHILD_FIXTURE=descendant")
	if err := descendant.Start(); err != nil {
		t.Fatal(err)
	}
	if err := json.NewEncoder(os.Stdout).Encode(applicationDeadlineEvidence{Producer: os.Getpid(), Descendant: descendant.Process.Pid, Cache: cache, Stage: stage}); err != nil {
		t.Fatal(err)
	}
	<-stop
	_ = descendant.Wait()
}

func TestApplicationFixtureFinalizesOnlyDeterminateChildCancellation(t *testing.T) {
	for _, test := range []struct {
		name                  string
		wantErr               error
		outerLive, scopedLive bool
		finish                bool
	}{
		{"child-deadline", context.DeadlineExceeded, true, true, true},
		{"child-cancel", context.Canceled, true, true, true},
		{"scoped-cancel", context.Canceled, true, false, false},
		{"outer-cancel", context.Canceled, false, false, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			outer, cancelOuter := context.WithCancel(context.Background())
			defer cancelOuter()
			scoped, cancelScoped := context.WithCancel(outer)
			defer cancelScoped()
			g := graphFixture(t)
			install, err := devoutputs.BeginCompositionInstall(scoped, g.workspace.ResolvedWorkspace, *g.plan.Composition)
			if err != nil {
				t.Fatal(err)
			}
			writeGraphFixture(t, filepath.Join(g.workspace.Root, "node_modules/fixture"), "aggregate\n")
			for _, pkg := range g.plan.Composition.Packages {
				writeGraphFixture(t, filepath.Join(pkg.Path, "node_modules/fixture"), "consumer\n")
			}
			if err = install.Finish(scoped); err != nil {
				t.Fatal(err)
			}
			var nodes []BuildNode
			for _, node := range g.Nodes {
				if node.ID == "base-ui" {
					nodes = append(nodes, node)
				}
			}
			if len(nodes) != 1 {
				t.Fatal("actual selected JavaScript producer is missing")
			}
			var evidence applicationDeadlineEvidence
			var producer, descendant devcontract.ProcessIdentity
			owner := devsession.ProcessOwner{WorkspaceID: g.workspace.Manifest.WorkspaceID, Generation: g.options.Generation, Role: "application-deadline-producer", Source: nodes[0].Directory}
			descendantOwner := owner
			descendantOwner.Role = "application-deadline-descendant"
			g.runProducer = func(ctx context.Context, directory string, environment []string, _ string, _ ...string) ([]byte, error) {
				var childCtx context.Context
				var cancelChild context.CancelFunc
				if test.name == "child-deadline" {
					childCtx, cancelChild = context.WithTimeout(ctx, 2*time.Second)
				} else {
					childCtx, cancelChild = context.WithCancel(ctx)
				}
				defer cancelChild()
				command := exec.Command(os.Args[0], "-test.run=^TestApplicationFixtureDeadlineProducerProcess$")
				command.Dir = directory
				command.Env = append(append(os.Environ(), environment...), "GOWORK=off", "OMNIVIEW_APPLICATION_DEADLINE_PRODUCER=1")
				reader, output := io.Pipe()
				defer reader.Close()
				command.Stdout = output
				var diagnostics strings.Builder
				command.Stderr = &diagnostics
				done := make(chan error, 1)
				go func() {
					runErr := RunRepositoryCommand(childCtx, command, owner)
					_ = output.CloseWithError(runErr)
					done <- runErr
				}()
				readyErr := json.NewDecoder(reader).Decode(&evidence)
				if readyErr == nil {
					producer, readyErr = devsession.CaptureProcess(evidence.Producer, owner)
				}
				if readyErr == nil {
					descendant, readyErr = devsession.CaptureProcess(evidence.Descendant, descendantOwner)
				}
				if readyErr != nil {
					cancelChild()
				} else {
					switch test.name {
					case "child-cancel":
						cancelChild()
					case "scoped-cancel":
						cancelScoped()
					case "outer-cancel":
						cancelOuter()
					}
				}
				_, _ = io.Copy(io.Discard, reader)
				runErr := <-done
				if readyErr != nil {
					return nil, errors.Join(readyErr, runErr, errors.New(diagnostics.String()))
				}
				return nil, runErr
			}
			err = g.buildApplicationFixture(scoped, nodes, t.TempDir(), func(_ string, run func() error) error { return run() })
			if !errors.Is(err, test.wantErr) || errors.Is(err, errOwnedCommandUncertain) {
				t.Fatalf("actual joined producer failure was lost or became success/uncertainty: %v", err)
			}
			if (outer.Err() == nil) != test.outerLive || (scoped.Err() == nil) != test.scopedLive {
				t.Fatalf("operation cancellation was confused with its child: outer=%v scoped=%v", outer.Err(), scoped.Err())
			}
			if producer.PID == 0 || descendant.PID == 0 {
				t.Fatal("actual producer/descendant identities were not captured")
			}
			if err = devsession.VerifyOwnedProcess(producer, owner); !errors.Is(err, devsession.ErrProcessGone) {
				t.Fatal("producer survived the returned failure", err)
			}
			if err = devsession.VerifyOwnedProcess(descendant, descendantOwner); !errors.Is(err, devsession.ErrProcessGone) {
				t.Fatal("descendant survived the returned failure", err)
			}
			if raw, err := os.ReadFile(filepath.Join(evidence.Cache, "partial.js")); err != nil || string(raw) != "controlled partial compiler cache\n" {
				t.Fatal("actual controlled partial cache is missing", err)
			}
			if _, err = os.Lstat(evidence.Stage); !os.IsNotExist(err) {
				t.Fatal("determinate failed producer left its staged output", err)
			}
			if _, err = os.Lstat(filepath.Join(nodes[0].Directory, "dist")); !os.IsNotExist(err) {
				t.Fatal("failed producer published ready artifacts", err)
			}
			if test.finish {
				if err = ValidateRepositoryOutputs(scoped, g.workspace); err != nil {
					t.Fatal("joined child cancellation stranded or failed to authenticate owned partial output", err)
				}
				if err = RestoreRepositoryOutputs(scoped, g.workspace); err != nil {
					t.Fatal("canonical restoration could not retire the completed failed transaction", err)
				}
				if _, err = os.Lstat(evidence.Cache); !os.IsNotExist(err) {
					t.Fatal("canonical restoration retained the authenticated partial cache", err)
				}
			} else if err = RestoreRepositoryOutputs(context.Background(), g.workspace); err == nil {
				t.Fatal("canceled operation released durable writer ownership")
			}
		})
	}
}
