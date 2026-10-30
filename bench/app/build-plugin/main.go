// Build the real Kubernetes UI in a disposable canonical source composition,
// profile the caller's installed host frontend against it, then retire it.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"regexp"
	"strings"
	"syscall"

	"github.com/omniviewdev/omniview/internal/devcompose"
	"github.com/omniviewdev/omniview/internal/devsession"
	"github.com/omniviewdev/omniview/internal/devworkspace"
)

var fullCommit = regexp.MustCompile(`^[a-f0-9]{40}([a-f0-9]{24})?$`)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(ctx context.Context) (resultErr error) {
	host := flag.String("host", "", "installed host checkout to profile")
	hostRef := flag.String("host-ref", "", "exact host commit")
	sdk := flag.String("sdk", "", "reviewed SDK source checkout")
	sdkRef := flag.String("sdk-ref", "", "exact reviewed SDK commit")
	ui := flag.String("ui", "", "reviewed UI source checkout")
	uiRef := flag.String("ui-ref", "", "exact reviewed UI commit")
	kube := flag.String("kubernetes", "", "reviewed Kubernetes source checkout")
	kubeRef := flag.String("kubernetes-ref", "", "exact reviewed Kubernetes commit")
	evidenceFile := flag.String("link-evidence", "", "actual native pnpm protocol probe report")
	flag.Parse()
	for _, source := range []struct{ path, ref string }{{*host, *hostRef}, {*sdk, *sdkRef}, {*ui, *uiRef}, {*kube, *kubeRef}} {
		if !filepath.IsAbs(source.path) || !fullCommit.MatchString(source.ref) {
			return fmt.Errorf("each source requires an absolute checkout path and an explicit full commit")
		}
	}
	raw, err := os.ReadFile(*evidenceFile)
	if err != nil {
		return err
	}
	var evidence devworkspace.LinkProtocolEvidence
	if err = json.Unmarshal(raw, &evidence); err != nil {
		return err
	}
	collection, err := os.MkdirTemp("", "omniview-app-profile-")
	if err != nil {
		return err
	}
	collection, err = filepath.EvalSymlinks(collection)
	if err != nil {
		return err
	}
	fmt.Fprintln(os.Stderr, "Private app-profile source collection:", collection)
	creationStarted := false
	defer func() {
		if !creationStarted {
			resultErr = errors.Join(resultErr, os.RemoveAll(collection))
		}
	}()
	if _, err = devworkspace.Init(ctx, devworkspace.InitOptions{Root: collection, Sources: []devworkspace.SourceSpec{
		{ID: "omniview", Path: *host, DefaultRef: *hostRef},
		{ID: "plugin-sdk", Path: *sdk, DefaultRef: *sdkRef},
		{ID: "ui", Path: *ui, DefaultRef: *uiRef},
		{ID: "kubernetes", Path: *kube, DefaultRef: *kubeRef},
	}}); err != nil {
		return err
	}
	manager, err := openProfileManager(collection)
	if err != nil {
		return err
	}
	creationStarted = true
	workspace, err := manager.Create(ctx, devworkspace.CreateOptions{Slug: "app-profile", Repositories: []string{"plugin-sdk", "ui"}, Plugins: []string{"kubernetes"}})
	if err != nil {
		return fmt.Errorf("preserving private source collection %s after incomplete create: %w", collection, err)
	}
	defer func() {
		cleanup := context.WithoutCancel(ctx)
		if _, err := manager.Unlink(cleanup, workspace.Manifest.WorkspaceID); err != nil {
			resultErr = errors.Join(resultErr, fmt.Errorf("preserving private source collection %s: %w", collection, err))
			return
		}
		if err := devworkspace.CleanGenerated(workspace); err != nil {
			resultErr = errors.Join(resultErr, fmt.Errorf("preserving private source collection %s: %w", collection, err))
			return
		}
		if _, err := manager.Remove(cleanup, workspace.Manifest.WorkspaceID, devworkspace.RemoveOptions{PurgeState: true, DeleteBranches: true, ValidateGenerated: devworkspace.ValidateGenerated}); err != nil {
			resultErr = errors.Join(resultErr, fmt.Errorf("preserving private source collection %s: %w", collection, err))
			return
		}
		resultErr = errors.Join(resultErr, os.RemoveAll(collection))
	}()
	if _, err = manager.Link(ctx, workspace.Manifest.WorkspaceID, devworkspace.LinkOptions{Evidence: evidence}); err != nil {
		return err
	}
	assets, err := manager.BuildPluginUI(ctx, workspace.Manifest.WorkspaceID, "kubernetes", os.Stderr)
	if err != nil {
		return err
	}
	plugin, err := workspace.RepositoryPath("kubernetes")
	if err != nil {
		return err
	}
	cmd := exec.Command("pnpm", append([]string{"bench:app"}, flag.Args()...)...)
	cmd.Dir = *host
	for _, entry := range os.Environ() {
		key, _, _ := strings.Cut(entry, "=")
		switch strings.ToLower(key) {
		case "pnpm_config_workspace_dir", "npm_config_workspace_dir", "node_path", "omniview_pnpm_node_path", "ov_k8s_plugin_dist", "ov_k8s_plugin_metadata":
			continue
		}
		cmd.Env = append(cmd.Env, entry)
	}
	cmd.Env = append(cmd.Env, devcompose.RootEnvironment+"="+*host, "OV_K8S_PLUGIN_DIST="+assets, "OV_K8S_PLUGIN_METADATA="+filepath.Join(plugin, "plugin.json"))
	cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
	return devworkspace.RunRepositoryCommand(ctx, cmd, devsession.ProcessOwner{
		WorkspaceID: workspace.Manifest.WorkspaceID,
		Generation:  devworkspace.NewGeneration(),
		Role:        "app-profile",
		Source:      *host,
	})
}

func openProfileManager(collection string) (*devworkspace.Manager, error) {
	return devworkspace.Open(collection, devworkspace.Options{
		Home:    filepath.Join(collection, "home"),
		Stopped: devworkspace.RequireStopped,
	})
}
