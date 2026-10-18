package devoutputs

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

func TestDisjointPluginInstallPreservesLiveHostViteAndBlocksOverlap(t *testing.T) {
	ctx := context.Background()
	workspace, host := outputFixture(t)
	plugin := filepath.Join(workspace.Root, "probe")
	ui := filepath.Join(plugin, "ui")
	if err := os.MkdirAll(ui, 0700); err != nil {
		t.Fatal(err)
	}
	outputGit(t, plugin, "init")
	writeOutput(t, filepath.Join(plugin, ".gitignore"), "ui/node_modules/\n")
	writeOutput(t, filepath.Join(ui, "package.json"), `{"name":"probe-ui","private":true}`)
	outputGit(t, plugin, "add", ".")
	outputCommit(t, plugin, "probe source")
	workspace.Manifest.Repositories = append(workspace.Manifest.Repositories, devcontract.Repository{ID: "probe", Directory: "probe"})
	hostInstall, err := BeginInstall(ctx, workspace, host)
	if err != nil {
		t.Fatal(err)
	}
	writeOutput(t, filepath.Join(host, "node_modules/package/index.js"), "host dependency")
	if err = hostInstall.Finish(ctx); err != nil {
		t.Fatal(err)
	}
	hostVite, err := BeginVite(ctx, workspace, host)
	if err != nil {
		t.Fatal(err)
	}
	defer hostVite.Finish(ctx)
	var cache string
	for _, entry := range hostVite.Environment {
		if strings.HasPrefix(entry, "OMNIVIEW_VITE_CACHE_DIRECTORY=") {
			cache = strings.TrimPrefix(entry, "OMNIVIEW_VITE_CACHE_DIRECTORY=")
		}
	}
	if cache == "" {
		t.Fatal("host cache capability missing")
	}
	pluginInstall, err := BeginInstall(ctx, workspace, ui)
	if err != nil {
		t.Fatalf("disjoint plugin install blocked by live host Vite: %v", err)
	}
	writeOutput(t, filepath.Join(ui, "node_modules/package/index.js"), "plugin dependency")
	marker := filepath.Join(cache, "deps/live.js")
	writeOutput(t, marker, "live host cache")
	if err = pluginInstall.Finish(ctx); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(marker)
	if err != nil || string(raw) != "live host cache" {
		t.Fatalf("disjoint installation changed live host cache: %v", err)
	}
	if overlapping, err := BeginInstall(ctx, workspace, host); err == nil {
		overlapping.Finish(ctx)
		t.Fatal("install accepted overlapping live host cache writer")
	}
	if err = hostVite.Finish(ctx); err != nil {
		t.Fatal(err)
	}
	if err = Restore(ctx, workspace); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Lstat(filepath.Join(ui, "node_modules")); !os.IsNotExist(err) {
		t.Fatalf("plugin install ownership was not restored: %v", err)
	}
}
