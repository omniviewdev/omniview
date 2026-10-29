package devworkspace

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/omniviewdev/omniview/internal/devcompose"
	"github.com/omniviewdev/omniview/internal/devoutputs"
)

// RestoreRepositoryOutputs runs only after the controller has stopped all owned
// producers and acquired its existing lifecycle/profile guards. It restores the
// current committed source, never a historic worktree snapshot.
func RestoreRepositoryOutputs(ctx context.Context, w Workspace) error {
	return devoutputs.Restore(ctx, w.ResolvedWorkspace)
}
func ValidateRepositoryOutputs(ctx context.Context, w Workspace) error {
	return devoutputs.Validate(ctx, w.ResolvedWorkspace)
}

func abortRepositoryStages(ctx context.Context, stages []*devoutputs.Stage) error {
	var result error
	for i := len(stages) - 1; i >= 0; i-- {
		result = errors.Join(result, stages[i].Abort(context.WithoutCancel(ctx)))
	}
	return result
}

func (g *BuildGraph) buildBindings(ctx context.Context, n BuildNode) (resultErr error) {
	before, err := g.verifySDK(ctx, n.Directory)
	if err != nil {
		return err
	}
	stage, err := devoutputs.Prepare(ctx, g.workspace.ResolvedWorkspace, n.Directory, devoutputs.Bindings)
	if err != nil {
		return err
	}
	published := false
	defer func() {
		if !published && !errors.Is(resultErr, errOwnedCommandUncertain) {
			resultErr = errors.Join(resultErr, stage.Abort(context.WithoutCancel(ctx)))
		}
	}()
	if g.options.Bindings != nil {
		err = g.options.Bindings(ctx, n.Directory, stage.Directory)
	} else {
		_, err = g.run(ctx, n.Directory, "task", "bindings", "DEV=true", "BINDINGS_OUTPUT_DIRECTORY="+stage.Directory, "GO_BUILD_CACHE_DIRECTORY="+g.options.GoBuildCacheDirectory)
	}
	if err != nil {
		return err
	}
	if err = requireProducerFiles(stage.Directory); err != nil {
		return err
	}
	if err = g.verifyUnchangedSDK(ctx, n.Directory, before); err != nil {
		return err
	}
	if err = devoutputs.Publish(ctx, stage); err != nil {
		return err
	}
	published = true
	return nil
}

// buildJavaScript typechecks and builds one package into exclusive staged
// outputs (dist, plus shims or the YAML worker for their owners) and
// publishes them only after they validate.
func (g *BuildGraph) buildJavaScript(ctx context.Context, n BuildNode) (resultErr error) {
	if g.plan.Composition == nil {
		return fmt.Errorf("selected dependency composition is absent")
	}
	if err := devcompose.CheckInputs(*g.plan.Composition); err != nil {
		return err
	}
	pkg, err := readLinkPackage(n.Directory)
	if err != nil {
		return err
	}
	scripts, _ := pkg["scripts"].(map[string]any)
	if _, ok := scripts["build"]; !ok {
		return fmt.Errorf("selected frontend has no build script: %s", n.Directory)
	}
	// Register cache writers before the actual typechecker/config loader starts;
	// Finish captures their after-image on success AND actual terminal failure.
	writer, err := devoutputs.BeginVite(ctx, g.workspace.ResolvedWorkspace, n.Directory)
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
		stage, e := devoutputs.Prepare(ctx, g.workspace.ResolvedWorkspace, n.Directory, kind)
		if e == nil {
			stages = append(stages, stage)
		}
		return stage, e
	}
	dist, err := prepare(devoutputs.Distribution)
	if err != nil {
		return err
	}
	environment := append([]string{}, writer.Environment...)
	environment = append(environment, "OMNIVIEW_BUILD_OUTPUT_DIRECTORY="+dist.Directory)
	var shims, worker *devoutputs.Stage
	if n.ID == "vite-plugin" {
		shims, err = prepare(devoutputs.Shims)
		if err != nil {
			return err
		}
		environment = append(environment, "OMNIVIEW_SHIMS_OUTPUT_DIRECTORY="+shims.Directory, "OMNIVIEW_SHIMS_SOURCE_DIRECTORY="+filepath.Join(n.Directory, "shims"))
	}
	if n.ID == "host-frontend" {
		worker, err = prepare(devoutputs.YAMLWorker)
		if err != nil {
			return err
		}
		environment = append(environment, "OMNIVIEW_YAML_WORKER_OUTPUT_FILE="+filepath.Join(worker.Directory, "yaml.worker.bundle.js"))
	}
	// A build script that already runs the typecheck script must not run it twice.
	build, _ := scripts["build"].(string)
	if _, ok := scripts["typecheck"]; ok && !buildRunsTypecheck.MatchString(build) {
		if _, err = g.runProducer(ctx, n.Directory, environment, "pnpm", "run", "typecheck"); err != nil {
			return err
		}
	}
	if _, err = g.runProducer(ctx, n.Directory, environment, "pnpm", "run", "build"); err != nil {
		return err
	}
	if err = validateDistribution(pkg, dist.Directory, n.ID == "host-frontend"); err != nil {
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

var buildRunsTypecheck = regexp.MustCompile(`(^|[\s&;|(])(pnpm|npm|yarn)\s+(run\s+)?typecheck($|[\s&;|)])`)

func requireProducerFile(path string) error {
	info, err := os.Lstat(path)
	if err != nil {
		return fmt.Errorf("required producer output %s: %w", path, err)
	}
	if !info.Mode().IsRegular() || info.Size() == 0 {
		return fmt.Errorf("producer output is not a nonempty regular file: %s", path)
	}
	return nil
}
func requireProducerFiles(directory string) error {
	found := false
	err := filepath.WalkDir(directory, func(path string, item os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if item.IsDir() {
			return nil
		}
		if item.Name() == ".gitkeep" {
			return nil
		}
		info, err := item.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return fmt.Errorf("producer output is not a regular file: %s", path)
		}
		// Compilers may legitimately emit empty auxiliary chunks. They do not,
		// by themselves, establish that the producer generated a usable output.
		if info.Size() > 0 {
			found = true
		}
		return nil
	})
	if err != nil {
		return err
	}
	if !found {
		return fmt.Errorf("producer reported success without output: %s", directory)
	}
	return nil
}
func validateDistribution(pkg map[string]any, directory string, host bool) error {
	if err := requireProducerFiles(directory); err != nil {
		return err
	}
	if host {
		return requireProducerFile(filepath.Join(directory, "index.html"))
	}
	var inspect func(any) error
	inspect = func(value any) error {
		switch value := value.(type) {
		case string:
			path := strings.TrimPrefix(value, "./")
			if !strings.HasPrefix(path, "dist/") {
				return nil
			}
			relative := strings.TrimPrefix(path, "dist/")
			if strings.ContainsAny(relative, "*?[") {
				return nil
			}
			candidate := filepath.Join(directory, filepath.FromSlash(relative))
			if !inside(directory, candidate) {
				return fmt.Errorf("package output escapes distribution: %s", value)
			}
			return requireProducerFile(candidate)
		case map[string]any:
			for _, child := range value {
				if err := inspect(child); err != nil {
					return err
				}
			}
		case []any:
			for _, child := range value {
				if err := inspect(child); err != nil {
					return err
				}
			}
		}
		return nil
	}
	for _, field := range []string{"main", "module", "types", "typings", "exports", "browser"} {
		if err := inspect(pkg[field]); err != nil {
			return err
		}
	}
	return nil
}
