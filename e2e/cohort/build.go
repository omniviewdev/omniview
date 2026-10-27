//go:build e2eapplication

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/devserver"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"
	"github.com/omniviewdev/omniview/internal/devsource"
	"github.com/omniviewdev/omniview/internal/devworkspace"
)

type applicationBuildStage struct {
	Name      string `json:"name"`
	Lane      string `json:"lane"`
	StartedMS int64  `json:"startedMs"`
	ElapsedMS int64  `json:"elapsedMs"`
	Status    string `json:"status"`
}

type applicationBuildPlugin struct {
	ID          string             `json:"id"`
	Source      string             `json:"source"`
	Artifact    string             `json:"artifact"`
	SDKIdentity devsource.Identity `json:"sdkIdentity"`
}

// Execution timings only: this is not a managed workspace/ownership receipt.
type applicationBuildReport struct {
	SchemaVersion int                      `json:"schemaVersion"`
	Succeeded     bool                     `json:"succeeded"`
	ElapsedMS     int64                    `json:"elapsedMs"`
	Stages        []applicationBuildStage  `json:"stages"`
	Plugins       []applicationBuildPlugin `json:"plugins"`
}

type applicationBuildReporter struct {
	path    string
	started time.Time
	report  applicationBuildReport
}

func newApplicationBuildReporter(path string, started time.Time) (*applicationBuildReporter, error) {
	if err := devsession.ValidatePrivateDirectory(filepath.Dir(path)); err != nil {
		return nil, err
	}
	if _, err := os.Lstat(path); err == nil {
		return nil, os.ErrExist
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	r := &applicationBuildReporter{path: path, started: started, report: applicationBuildReport{SchemaVersion: 1, ElapsedMS: time.Since(started).Milliseconds(), Stages: []applicationBuildStage{}, Plugins: []applicationBuildPlugin{}}}
	return r, devsession.WritePrivateJSON(path, r.report)
}

func (r *applicationBuildReporter) stage(name, lane string, build func() error) error {
	started := time.Now()
	index := len(r.report.Stages)
	r.report.Stages = append(r.report.Stages, applicationBuildStage{Name: name, Lane: lane, StartedMS: started.Sub(r.started).Milliseconds(), Status: "running"})
	err := devsession.WritePrivateJSON(r.path, r.report)
	if err != nil {
		return err
	}
	buildErr := build()
	r.report.Stages[index].ElapsedMS = time.Since(started).Milliseconds()
	r.report.Stages[index].Status = "succeeded"
	if buildErr != nil {
		r.report.Stages[index].Status = "failed"
	}
	r.report.ElapsedMS = time.Since(r.started).Milliseconds()
	return errors.Join(buildErr, devsession.WritePrivateJSON(r.path, r.report))
}

func (r *applicationBuildReporter) plugin(plugin applicationBuildPlugin) error {
	r.report.Plugins = append(r.report.Plugins, plugin)
	return devsession.WritePrivateJSON(r.path, r.report)
}

func (r *applicationBuildReporter) finish(buildErr error) error {
	r.report.ElapsedMS = time.Since(r.started).Milliseconds()
	r.report.Succeeded = buildErr == nil
	for i := range r.report.Stages {
		if r.report.Stages[i].Status == "running" {
			r.report.Stages[i].Status = "failed"
			r.report.Stages[i].ElapsedMS = r.report.ElapsedMS - r.report.Stages[i].StartedMS
		}
	}
	return devsession.WritePrivateJSON(r.path, r.report)
}

func runApplicationBuildCommand(ctx context.Context, owner devsession.ProcessOwner, directory string, environment []string, capture bool, program string, args ...string) ([]byte, error) {
	command := exec.Command(program, args...)
	command.Dir = directory
	command.Env = append(append([]string{}, environment...), "GOWORK=off", "GOFLAGS=")
	command.Stdout, command.Stderr = os.Stdout, os.Stderr
	var output bytes.Buffer
	if capture {
		command.Stdout = &output
	}
	if err := devworkspace.RunRepositoryCommand(ctx, command, owner); err != nil {
		return nil, err
	}
	return output.Bytes(), nil
}

// Verify the actual effective module with the production SDK verifier. Its
// self-CLI runs under RunRepositoryCommand so Go list and any descendants stay
// owned during cancellation, too.
func applicationSDKIdentity(ctx context.Context, manager *devworkspace.Manager, target string, config configuration, source, modfile string) (devsource.Identity, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	paths, err := manager.Paths(ctx, target)
	if err != nil {
		return devsource.Identity{}, err
	}
	flags := ""
	if modfile != "" {
		flags = strconv.Quote("-modfile=" + modfile)
	}
	environment := append(os.Environ(), "GOWORK=off", "GOFLAGS="+flags)
	identity, err := devserver.VerifySelectedSDK(ctx, "", source, config.Refs["plugin-sdk"], environment)
	if err == nil && identity.Directory != paths.Repositories["plugin-sdk"] {
		err = fmt.Errorf("effective SDK differs from invocation-selected source")
	}
	return identity, err
}

func buildApplicationCohort(ctx context.Context, manager *devworkspace.Manager, target string, config configuration, configPath, artifacts, reportPath string) (resultErr error) {
	started := time.Now()
	canonical, err := devcontract.CanonicalPath(artifacts)
	if err != nil || canonical != artifacts || !filepath.IsAbs(artifacts) || filepath.Dir(reportPath) != artifacts {
		return fmt.Errorf("application build requires canonical private artifact/report paths")
	}
	if err = devsession.ValidatePrivateDirectory(artifacts); err != nil {
		return err
	}
	prepared, err := manager.ApplicationFixturePackageCommands(ctx, target)
	if err != nil {
		return err
	}
	relative, err := filepath.Rel(prepared.Paths.Root, artifacts)
	if err != nil || relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return fmt.Errorf("application artifacts must remain outside the source workspace")
	}
	for _, id := range []string{"omniview", "plugin-sdk", "workspace-probe", "kubernetes"} {
		if prepared.Paths.Repositories[id] == "" {
			return fmt.Errorf("application build lacks selected source %s", id)
		}
	}
	report, err := newApplicationBuildReporter(reportPath, started)
	if err != nil {
		return err
	}
	defer func() { resultErr = errors.Join(resultErr, report.finish(resultErr)) }()
	tool, err := os.Executable()
	if err != nil {
		return err
	}
	owner := devsession.ProcessOwner{WorkspaceID: prepared.Paths.WorkspaceID, Generation: uuid.NewString(), Role: "application-build-command", Source: prepared.Paths.Root}
	runSelected := func(ctx context.Context, source string, environment []string, capture bool, program string, args ...string) ([]byte, error) {
		workspace, err := manager.Inspect(ctx, target)
		if err != nil {
			return nil, err
		}
		if workspace.Manifest.WorkspaceID != owner.WorkspaceID || workspace.Root != prepared.Paths.Root {
			return nil, fmt.Errorf("application build workspace changed")
		}
		if err = devworkspace.RequireStopped(ctx, workspace.ResolvedWorkspace); err != nil {
			return nil, err
		}
		commandOwner := owner
		commandOwner.Source = source
		return runApplicationBuildCommand(ctx, commandOwner, source, environment, capture, program, args...)
	}
	verify := func(ctx context.Context, source, modfile string) (devsource.Identity, error) {
		raw, err := runSelected(ctx, source, os.Environ(), true, tool, "sdk-identity", configPath, source, modfile)
		if err != nil {
			return devsource.Identity{}, err
		}
		var identity devsource.Identity
		if err = json.Unmarshal(raw, &identity); err != nil {
			return identity, err
		}
		if identity.Directory != prepared.Paths.Repositories["plugin-sdk"] || identity.ReviewedRevision != config.Refs["plugin-sdk"] || identity.SourceDigest == "" {
			return identity, fmt.Errorf("actual SDK verification returned different source evidence")
		}
		return identity, nil
	}
	if err = report.stage("application-sdk-admission", "setup", func() error { _, err := verify(ctx, prepared.Paths.Repositories["omniview"], ""); return err }); err != nil {
		return err
	}
	if err := manager.BuildApplicationFixture(ctx, target, artifacts, config.Refs["plugin-sdk"], func(name string, build func() error) error {
		return report.stage(name, "ordered", build)
	}); err != nil {
		return err
	}
	for _, id := range []string{"workspace-probe", "kubernetes"} {
		if err := ctx.Err(); err != nil {
			return err
		}
		err := report.stage(id+"-artifact-go-build-once", "plugin-go", func() error {
			source, artifact := prepared.Paths.Repositories[id], filepath.Join(artifacts, id)
			if err := os.Mkdir(artifact, 0700); err != nil {
				return err
			}
			if err := os.Mkdir(filepath.Join(artifact, "bin"), 0700); err != nil {
				return err
			}
			modfile := filepath.Join(artifact, "plugin.mod")
			for input, output := range map[string]string{"go.mod": modfile, "go.sum": filepath.Join(artifact, "plugin.sum")} {
				data, err := os.ReadFile(filepath.Join(source, input))
				if err != nil {
					return err
				}
				if err = os.WriteFile(output, data, 0600); err != nil {
					return err
				}
			}
			editCtx, cancelEdit := context.WithTimeout(ctx, 180*time.Second)
			_, editErr := runSelected(editCtx, source, os.Environ(), false, "go", "mod", "edit", "-modfile="+modfile, "-replace=github.com/omniviewdev/plugin-sdk="+prepared.Paths.Repositories["plugin-sdk"])
			cancelEdit()
			if editErr != nil {
				return editErr
			}
			before, err := verify(ctx, source, modfile)
			if err != nil {
				return err
			}
			environment := os.Environ()
			if id == "kubernetes" {
				environment = append(environment, "GOEXPERIMENT=jsonv2")
			}
			compileCtx, cancelCompile := context.WithTimeout(ctx, 240*time.Second)
			_, err = runSelected(compileCtx, source, environment, false, "go", "build", "-mod=mod", "-modfile="+modfile, "-o", filepath.Join(artifact, "bin", "plugin"), "./pkg")
			cancelCompile()
			if err != nil {
				return err
			}
			after, err := verify(ctx, source, modfile)
			if err != nil {
				return err
			}
			if after != before {
				return fmt.Errorf("SDK source changed across the actual %s plugin build", id)
			}
			return report.plugin(applicationBuildPlugin{ID: id, Source: source, Artifact: artifact, SDKIdentity: before})
		})
		if err != nil {
			return err
		}
	}
	return ctx.Err()
}
