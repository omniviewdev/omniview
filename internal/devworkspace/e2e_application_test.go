//go:build e2eapplication && (darwin || linux)

package devworkspace

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devoutputs"
	"github.com/omniviewdev/omniview/internal/devsession"
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
	var built []BuildNode
	for _, node := range g.Nodes {
		if node.Kind != "javascript" {
			continue
		}
		if err = g.applicationFixtureJavaScript(ctx, node); err != nil {
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
		if err = g.applicationFixtureJavaScript(ctx, node); !errors.Is(err, errOwnedCommandUncertain) {
			t.Fatal(err)
		}
	}
	if err = RestoreRepositoryOutputs(ctx, g.workspace); err == nil {
		t.Fatal("uncertain producer ownership was released")
	}
}
