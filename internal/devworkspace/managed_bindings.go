package devworkspace

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"

	"github.com/google/uuid"
	"github.com/omniviewdev/omniview/internal/devcompose"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devoutputs"
	"github.com/omniviewdev/omniview/internal/devsource"
)

// GenerateBindings uses the canonical task through the staged graph producer.
// Collection, worktree, profile and exact stopped-process guards stay held until
// the command and all its owned descendants terminate or retain an uncertain writer.
func (m *Manager) GenerateBindings(ctx context.Context, name string, output io.Writer) (string, error) {
	w, unlock, err := m.linkWorkspace(ctx, name)
	if err != nil {
		return "", err
	}
	defer unlock()
	j, err := loadLinkJournal(w)
	if os.IsNotExist(err) {
		return "", devcontract.Fail(4, "link_required", "managed bindings require a stopped, successfully linked workspace; link the selected composition before generating bindings")
	}
	if err != nil {
		return "", err
	}
	if j.Phase != "linked" || !sameManifest(j.Manifest, w.Manifest) || j.Plan.Composition == nil {
		return "", devcontract.Fail(4, "link_interrupted", "managed bindings require a completed selected dependency link; finish or unlink the retained dependency transaction first")
	}
	if err = j.Evidence.validateRoots(j.Plan.Roots); err != nil {
		return "", err
	}
	if err = checkLinkFiles(w.Root, j); err != nil {
		return "", err
	}
	if err = devcompose.CheckInputs(*j.Plan.Composition); err != nil {
		return "", err
	}
	options, err := LoadLaunchOptions(w)
	if os.IsNotExist(err) {
		options = LaunchOptions{Mode: "browser"}
	} else if err != nil {
		return "", err
	}
	if options.Mode != "browser" && options.Mode != "native" {
		return "", fmt.Errorf("saved bindings build mode is invalid")
	}
	if err = compatibilityPreflight(ctx, w); err != nil {
		return "", err
	}
	generation := uuid.NewString()
	cache, err := prepareWorkspaceBuildCacheLocked(w, m.options.Home, generation)
	if err != nil {
		return "", err
	}
	g := &BuildGraph{workspace: w, plan: j.Plan, options: BuildOptions{Generation: generation, GoBuildCacheDirectory: cache, VerifySDKSource: devsource.Verify}}
	if output != nil {
		g.options.Output = &lockedWriter{writer: output}
	}
	g.run, g.runProducer = g.command, g.commandWithEnvironment
	g.options.Bindings = func(ctx context.Context, host, directory string) (resultErr error) {
		mod, e := prepareStableHostModTree(w, generation)
		if e != nil {
			return e
		}
		defer func() {
			if errors.Is(resultErr, errOwnedCommandUncertain) {
				_ = mod.stageFile.Close()
				return
			}
			resultErr = errors.Join(resultErr, recordStableHostModTree(mod))
		}()
		args := []string{"bindings", "DEV=true", "EXTRA_TAGS=devcontrol", "BINDINGS_OUTPUT_DIRECTORY=" + directory, "HOST_MOD_OUTPUT_DIRECTORY=" + mod.Directory, "GO_BUILD_CACHE_DIRECTORY=" + cache}
		if options.Mode == "browser" {
			args = append(args, "SERVER=true")
		}
		if options.MCP {
			args = append(args, "WAILS_MCP=1")
		}
		_, resultErr = g.commandWithEnvironment(ctx, host, workspaceEnvironment(nil, w, generation, options), "task", args...)
		return resultErr
	}
	nodes, err := planBuildNodes(w)
	if err != nil {
		return "", err
	}
	for _, node := range nodes {
		if node.Kind != bindingsNode {
			continue
		}
		err = g.withBuildLock(ctx, func() error { return g.buildBindings(ctx, node) })
		if err != nil {
			return "", err
		}
		return node.Directory, nil
	}
	return "", fmt.Errorf("selected workspace has no bindings producer")
}

// ReconcileOutput preserves only the explicitly selected staged producer. It
// holds the same stopped/profile/worktree guards as other managed writers.
func (m *Manager) ReconcileOutput(ctx context.Context, name, consumer, producer, preserveAt string) (devoutputs.Reconciliation, error) {
	w, unlock, err := m.linkWorkspace(ctx, name)
	if err != nil {
		return devoutputs.Reconciliation{}, err
	}
	defer unlock()
	return devoutputs.Reconcile(ctx, w.ResolvedWorkspace, consumer, producer, preserveAt)
}
