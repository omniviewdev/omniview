package devworkspace

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/omniviewdev/omniview/internal/devsource"
)

func outputGraphNode(t *testing.T, g *BuildGraph, id string) BuildNode {
	t.Helper()
	for _, node := range g.Nodes {
		if node.ID == id {
			return node
		}
	}
	t.Fatalf("missing graph producer %s", id)
	return BuildNode{}
}

func TestGraphPublishesOwnedJavaScriptThenRestoresCurrentSource(t *testing.T) {
	g := graphFixture(t)
	ctx := context.Background()
	for _, node := range g.Nodes {
		if node.Kind == "javascript" {
			if err := g.buildNode(ctx, node); err != nil {
				t.Fatalf("%s: %v", node.ID, err)
			}
		}
	}
	if err := ValidateRepositoryOutputs(ctx, g.workspace); err != nil {
		t.Fatal(err)
	}
	for _, node := range g.Nodes {
		if node.Kind == "javascript" {
			if err := requireProducerFiles(filepath.Join(node.Directory, "dist")); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := RestoreRepositoryOutputs(ctx, g.workspace); err != nil {
		t.Fatal(err)
	}
	for _, repo := range g.workspace.Manifest.Repositories {
		directory := filepath.Join(g.workspace.Root, repo.Directory)
		if status := fixtureGit(t, directory, "status", "--porcelain=v1", "--untracked-files=all", "--ignored=matching"); strings.TrimSpace(status) != "" {
			t.Fatalf("owned output left in %s: %s", repo.ID, status)
		}
	}
	worker := filepath.Join(g.workspace.Root, "host/ui/providers/monaco/yaml.worker.bundle.js")
	raw, err := os.ReadFile(worker)
	if err != nil || string(raw) != "self.original = true;\n" {
		t.Fatalf("tracked worker was not restored: %v", err)
	}
}

func TestGraphRefusesPreexistingIgnoredDistribution(t *testing.T) {
	g := graphFixture(t)
	base := outputGraphNode(t, g, "base-ui")
	foreign := filepath.Join(base.Directory, "dist/user.txt")
	writeGraphFixture(t, foreign, "human ignored output")
	if err := g.buildNode(context.Background(), base); err == nil {
		t.Fatal("adopted an unowned ignored distribution")
	}
	raw, err := os.ReadFile(foreign)
	if err != nil || string(raw) != "human ignored output" {
		t.Fatalf("foreign data changed: %v", err)
	}
}

func TestGraphUnknownProducerLifetimeRetainsStageAndCacheIntent(t *testing.T) {
	g := graphFixture(t)
	base := outputGraphNode(t, g, "base-ui")
	var stage string
	g.runProducer = func(_ context.Context, _ string, environment []string, _ string, _ ...string) ([]byte, error) {
		for _, entry := range environment {
			if strings.HasPrefix(entry, "OMNIVIEW_BUILD_OUTPUT_DIRECTORY=") {
				stage = strings.TrimPrefix(entry, "OMNIVIEW_BUILD_OUTPUT_DIRECTORY=")
				writeGraphFixture(t, filepath.Join(stage, "partial.js"), "possibly still being written")
			}
		}
		return nil, errors.Join(errOwnedCommandUncertain, context.Canceled)
	}
	err := g.buildNode(context.Background(), base)
	if !errors.Is(err, errOwnedCommandUncertain) {
		t.Fatalf("uncertain lifetime was hidden: %v", err)
	}
	if _, err = os.Stat(filepath.Join(stage, "partial.js")); err != nil {
		t.Fatalf("uncertain stage was deleted: %v", err)
	}
	if err = RestoreRepositoryOutputs(context.Background(), g.workspace); err == nil {
		t.Fatal("restoration accepted an unproven producer lifetime")
	}
}

func TestBindingsStageIsNotPublishedAcrossSDKMutation(t *testing.T) {
	g := graphFixture(t)
	node := outputGraphNode(t, g, "bindings")
	g.run = func(context.Context, string, string, ...string) ([]byte, error) {
		return json.Marshal(map[string]any{"Path": linkedSDK, "Dir": g.plan.SDK})
	}
	calls := 0
	g.options.VerifySDKSource = func(_ context.Context, directory, revision string) (devsource.Identity, error) {
		calls++
		digest := strings.Repeat("c", 64)
		if calls > 1 {
			digest = strings.Repeat("d", 64)
		}
		return devsource.Identity{Directory: directory, ReviewedRevision: revision, SourceDigest: digest}, nil
	}
	g.options.Bindings = func(_ context.Context, _ string, output string) error {
		writeGraphFixture(t, filepath.Join(output, "index.ts"), "export const changed = true;\n")
		return nil
	}
	if err := g.buildNode(context.Background(), node); err == nil {
		t.Fatal("SDK mutation allowed bindings publication")
	}
	raw, err := os.ReadFile(filepath.Join(node.Directory, "packages/omniviewdev-runtime/src/bindings/index.ts"))
	if err != nil || string(raw) != "export const original = true;\n" {
		t.Fatalf("unverified bindings reached source: %v", err)
	}
	if err = ValidateRepositoryOutputs(context.Background(), g.workspace); err != nil {
		t.Fatalf("known stopped failure left uncontrolled output: %v", err)
	}
}

func TestDistributionRequiresDeclaredExportsNotJustAnyOutput(t *testing.T) {
	directory := t.TempDir()
	writeGraphFixture(t, filepath.Join(directory, "unrelated.js"), "not the declared module")
	if err := validateDistribution(map[string]any{"exports": map[string]any{".": map[string]any{"import": "./dist/index.js", "types": "./dist/index.d.ts"}}}, directory, false); err == nil {
		t.Fatal("missing exports accepted")
	}
}

func TestDistributionAllowsEmptyAuxiliaryCompilerChunk(t *testing.T) {
	directory := t.TempDir()
	writeGraphFixture(t, filepath.Join(directory, "index.js"), "export const real = true;\n")
	writeGraphFixture(t, filepath.Join(directory, "empty-chunk.js"), "")
	if err := validateDistribution(map[string]any{"main": "./dist/index.js"}, directory, false); err != nil {
		t.Fatal(err)
	}
}

func TestPluginCompilerUnknownLifetimeCannotPublishGeneratedTree(t *testing.T) {
	g := graphFixture(t)
	var partial string
	g.run = func(_ context.Context, _ string, _ string, args ...string) ([]byte, error) {
		if len(args) > 0 && args[0] == "list" {
			return json.Marshal(map[string]any{"Path": linkedSDK, "Dir": g.plan.SDK})
		}
		if len(args) > 2 && args[0] == "build" && args[1] == "-o" {
			partial = args[2]
			writeGraphFixture(t, partial, "possibly live compiler output")
			return nil, errOwnedCommandUncertain
		}
		return nil, os.ErrInvalid
	}
	node := BuildNode{ID: "plugin-backend:plugin", Kind: "plugin-backend", PluginID: "plugin", Directory: filepath.Join(g.workspace.Root, "plugin")}
	if err := g.buildNode(context.Background(), node); !errors.Is(err, errOwnedCommandUncertain) {
		t.Fatalf("uncertain compiler lifetime was hidden: %v", err)
	}
	if _, err := os.Stat(partial); err != nil {
		t.Fatalf("unknown compiler output removed: %v", err)
	}
	if _, err := os.Lstat(filepath.Join(g.workspace.Root, ".local/build/plugin/plugin")); !os.IsNotExist(err) {
		t.Fatalf("unknown compiler output was published: %v", err)
	}
}
