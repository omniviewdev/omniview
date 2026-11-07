package devworkspace

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsdk"
)

var errSupervisorExecutableForbidden = errors.New("test attempted to resolve a supervisor executable")

// forbidSupervisorExecutable is the injected resolver for tests that must never
// launch a supervisor: reaching it is the observable "launch preconditions met".
func forbidSupervisorExecutable() (string, error) { return "", errSupervisorExecutableForbidden }

// Every typed constructor with a non-default exit must survive the JSON status
// boundary, where Error.Exit is not serialized. Scanning the constructors keeps
// the table from drifting when a code is added.
func TestWorkspaceExitCodesCoverEveryTypedConstructor(t *testing.T) {
	directories := []string{".", "../devsession", "../devcontract", "../devcontrol", "../devcontrol/host", "../../backend/pkg/plugin/devserver"}
	// These codes are constructed with different exits at different sites; the
	// table lists the blocking exit for them.
	ambiguous := map[string][]int{"invalid_process_bridge": {2, 4}, "invalid_registry": {2, 4}, "overlapping_repositories": {2, 4}}
	fset := token.NewFileSet()
	checked := 0
	var missing []string
	for _, directory := range directories {
		entries, err := os.ReadDir(directory)
		require.NoError(t, err)
		var files []*ast.File
		constants := map[string]string{}
		for _, entry := range entries {
			if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".go") || strings.HasSuffix(entry.Name(), "_test.go") {
				continue
			}
			file, parseErr := parser.ParseFile(fset, filepath.Join(directory, entry.Name()), nil, 0)
			require.NoError(t, parseErr)
			files = append(files, file)
			for _, declaration := range file.Decls {
				generic, ok := declaration.(*ast.GenDecl)
				if !ok || generic.Tok != token.CONST {
					continue
				}
				for _, spec := range generic.Specs {
					value := spec.(*ast.ValueSpec)
					for index, name := range value.Names {
						if index >= len(value.Values) {
							continue
						}
						if literal, isLiteral := value.Values[index].(*ast.BasicLit); isLiteral {
							constants[name.Name] = literal.Value
						}
					}
				}
			}
		}
		resolve := func(expression ast.Expr) (string, bool) {
			switch node := expression.(type) {
			case *ast.BasicLit:
				return node.Value, true
			case *ast.Ident:
				value, found := constants[node.Name]
				return value, found
			}
			return "", false
		}
		for _, file := range files {
			ast.Inspect(file, func(node ast.Node) bool {
				call, ok := node.(*ast.CallExpr)
				if !ok || len(call.Args) < 2 {
					return true
				}
				var exitText, codeText string
				switch function := call.Fun.(type) {
				case *ast.SelectorExpr:
					if owner, isIdent := function.X.(*ast.Ident); !isIdent || owner.Name != "devcontract" || function.Sel.Name != "Fail" {
						return true
					}
					exitText, _ = resolve(call.Args[0])
					codeText, _ = resolve(call.Args[1])
				case *ast.Ident:
					switch function.Name {
					case "Fail":
						if filepath.Base(directory) != "devcontract" {
							return true
						}
						exitText, _ = resolve(call.Args[0])
						codeText, _ = resolve(call.Args[1])
					case "sourceUpdateFailure":
						exitText = constants["sourceUpdateConflictExitCode"]
						codeText, _ = resolve(call.Args[0])
					default:
						return true
					}
				default:
					return true
				}
				exit, exitErr := strconv.Atoi(exitText)
				code, codeErr := strconv.Unquote(codeText)
				if exitErr != nil || codeErr != nil {
					return true // dynamic code or exit: the dynamic constructor is listed by hand
				}
				position := fset.Position(call.Pos())
				if exits, mixed := ambiguous[code]; mixed {
					require.Contains(t, exits, exit, "%s", position)
					require.Equal(t, 4, workspaceExitCode(code), "%s: ambiguous code must list the blocking exit", position)
					return true
				}
				if workspaceExitCode(code) != exit {
					missing = append(missing, fmt.Sprintf("%s: devcontract.Fail(%d, %q) restores exit %d", position, exit, code, workspaceExitCode(code)))
				}
				checked++
				return true
			})
		}
	}
	require.Empty(t, missing, "typed codes lose their exit across the supervisor boundary; add each to workspaceExitCodes")
	require.Greater(t, checked, 400, "the scan must see the typed constructors")
}

func TestWorkspaceErrorRestoresExitFromCodeOnly(t *testing.T) {
	for _, test := range []struct {
		code string
		exit int
	}{
		{"usage", 2}, {"sdk_source_required", 2}, {"sdk_contract_mismatch", 3}, {"peer_contract_mismatch", 3},
		{"invalid_journal", 4}, {"generated_cleanup_pending", 4}, {"unauthorized", 6}, {"timeout", 7},
		{"build_failed", 5}, {"a_code_nobody_declared", 5},
	} {
		t.Run(test.code, func(t *testing.T) {
			restored := workspaceError(&devcontract.Error{Code: test.code, Message: "rebuilt from JSON"})
			require.Equal(t, test.exit, restored.Exit)
			require.Equal(t, test.code, restored.Code)
		})
	}
	explicit := workspaceError(&devcontract.Error{Code: "peer_contract_mismatch", Exit: 4})
	require.Equal(t, 4, explicit.Exit, "a constructor-assigned exit is never overridden by the table")
}

// A typed error raised inside a build node must cross the real supervisor
// status transport with its code, and recover its exit class on the controller.
func TestTypedBuildNodeErrorsKeepCodeAndExitAcrossSupervisorTransport(t *testing.T) {
	g := graphFixture(t)
	g.workspace.ManifestPath = filepath.Join(g.workspace.Root, "workspace.json")
	s := &workspaceSupervisor{
		manager: &Manager{Root: filepath.Dir(filepath.Dir(g.workspace.Root)), options: Options{Home: t.TempDir()}}, workspace: g.workspace,
		generation: g.options.Generation, status: Status{Workspace: g.workspace, Generation: g.options.Generation, Phase: "building"},
	}
	g.options.OnEvent = func(event BuildEvent) {
		if event.Phase == "error" {
			s.status.LastError = supervisedBuildError(event, g.workspace)
			s.status.Phase = "build-error"
		}
	}
	base := outputGraphNode(t, g, "base-ui")
	token := []byte("typed-build-error-authenticated-token")
	server := httptest.NewServer(supervisorHandler(g.workspace.Manifest.WorkspaceID, g.options.Generation, token, s.execute))
	defer server.Close()
	record := supervisorRecord{WorkspaceID: g.workspace.Manifest.WorkspaceID, Generation: g.options.Generation, Endpoint: server.URL + "/v1/supervisor"}
	for _, test := range []struct {
		name, code string
		cause      error
		exit       int
	}{
		{"prerequisite", "peer_contract_mismatch", devcontract.Fail(3, "peer_contract_mismatch", "typed prerequisite refusal"), 3},
		{"ownership conflict class", "invalid_journal", devcontract.Fail(4, "invalid_journal", "typed ownership refusal"), 4},
		{"joined with tool output", "generated_cleanup_pending", errors.Join(errors.New("go failed:\ncompiler text"), devcontract.Fail(4, "generated_cleanup_pending", "typed cleanup refusal")), 4},
		{"untyped failure", "build_failed", errors.New("compiler token=secret-output"), 5},
	} {
		t.Run(test.name, func(t *testing.T) {
			s.status.LastError, s.status.Phase = nil, "building"
			g.runProducer = func(context.Context, string, []string, string, ...string) ([]byte, error) { return nil, test.cause }
			require.Error(t, g.execute(context.Background(), []BuildNode{base}, nil))
			require.NotNil(t, s.status.LastError)
			status, err := callSupervisor(context.Background(), record, token, supervisorStatusCommand)
			require.NoError(t, err)
			require.NotNil(t, status.LastError)
			require.Equal(t, test.code, status.LastError.Code, "a typed node error must not be flattened to build_failed")
			require.Zero(t, status.LastError.Exit, "Exit is not serialized; only the code crosses")
			controller := workspaceOwnershipError(status.LastError, g.workspace)
			require.Equal(t, test.code, controller.Code)
			require.Equal(t, test.exit, controller.Exit)
			require.NotContains(t, controller.Message, "secret-output")
		})
	}
}

func commandEnvironmentProbe(t *testing.T) (program string, script string) {
	t.Helper()
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("actual Node is required for command environment behavior")
	}
	return node, `process.stdout.write(JSON.stringify({sdk: process.env.SDK_SOURCE ?? "unset", lower: process.env.sdk_source ?? "unset"}))`
}

// An exported SDK_SOURCE would make the Taskfile replace the SDK with a
// checkout the verifier never observed, so only the selected source may set it.
func TestOwnedCommandsNeverInheritAmbientSDKSource(t *testing.T) {
	node, script := commandEnvironmentProbe(t)
	t.Setenv("SDK_SOURCE", "/ambient/sdk-overlay")
	t.Setenv("sdk_source", "/ambient/lowercase-overlay")
	g := graphFixture(t)
	read := func(raw []byte) string {
		var got struct{ SDK, Lower string }
		require.NoError(t, json.Unmarshal(raw, &got))
		return got.SDK + "|" + got.Lower
	}
	raw, err := g.command(context.Background(), g.workspace.Root, node, "-e", script)
	require.NoError(t, err)
	require.Equal(t, "unset|unset", read(raw), "an ambient value reached a graph command")
	raw, err = g.commandWithEnvironment(context.Background(), g.workspace.Root, []string{"SDK_SOURCE=/selected/sdk"}, node, "-e", script)
	require.NoError(t, err)
	require.Equal(t, "/selected/sdk|unset", read(raw), "the selected source must still be the only value that can set it")
	raw, err = linkCommand(context.Background(), g.workspace.Root, node, "-e", script)
	require.NoError(t, err)
	require.Equal(t, "unset|unset", read(raw), "an ambient value reached a dependency command")
}

// The workspace child environment sets SDK_SOURCE only from the selected SDK.
func TestWorkspaceEnvironmentSetsSDKSourceOnlyFromTheSelection(t *testing.T) {
	g := graphFixture(t)
	ambient := []string{"SDK_SOURCE=/ambient/sdk-overlay", "HOME=/unchanged"}
	count := func(env []string) (values []string) {
		for _, entry := range env {
			if strings.HasPrefix(entry, "SDK_SOURCE=") {
				values = append(values, strings.TrimPrefix(entry, "SDK_SOURCE="))
			}
		}
		return values
	}
	require.Equal(t, []string{sdkDirectory(t, g)}, count(workspaceEnvironment(ambient, g.workspace, "generation", LaunchOptions{})))
	published := g.workspace
	published.Manifest.Links.SDKRepositoryID = nil
	require.Empty(t, count(workspaceEnvironment(ambient, published, "generation", LaunchOptions{})), "a published selection must not inherit an overlay")
}

// The bindings task is the production path an ambient SDK_SOURCE would flip.
func TestBindingsTaskNeverSeesAmbientSDKSource(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("the capture task is a POSIX shell script")
	}
	bin, capture := t.TempDir(), filepath.Join(t.TempDir(), "task-env")
	require.NoError(t, os.WriteFile(filepath.Join(bin, "task"), []byte("#!/bin/sh\nprintf '%s' \"${SDK_SOURCE-unset}\" > \"$CAPTURE_FILE\"\nexit 1\n"), 0o700))
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("CAPTURE_FILE", capture)
	t.Setenv("SDK_SOURCE", "/ambient/sdk-overlay")
	g := graphFixture(t)
	node := outputGraphNode(t, g, "bindings")
	real := g.command
	g.run = func(ctx context.Context, directory, program string, args ...string) ([]byte, error) {
		if program == "task" {
			return real(ctx, directory, program, args...)
		}
		return json.Marshal(map[string]any{"Path": devsdk.Module, "Dir": sdkDirectory(t, g)})
	}
	g.options.Bindings = nil
	require.Error(t, g.buildNode(context.Background(), node), "the capture task fails the build by design")
	raw, err := os.ReadFile(capture)
	require.NoError(t, err)
	require.Equal(t, "unset", string(raw), "the ambient SDK_SOURCE reached the bindings task")
}

func TestWatchRootsAndSDKContainmentFollowTheSelection(t *testing.T) {
	g := graphFixture(t)
	sdk := sdkDirectory(t, g)
	roots := g.watchRoots()
	require.Equal(t, sdk, roots[0], "a selected SDK checkout is watched first")
	require.Len(t, roots, len(g.workspace.Manifest.Repositories), "the SDK checkout is watched exactly once")
	require.True(t, g.sdkContains(sdk))
	require.True(t, g.sdkContains(filepath.Join(sdk, "pkg", "state", "root.go")))
	require.False(t, g.sdkContains(sdk+"-sibling/file.go"), "a sibling with the same prefix is not inside the checkout")
	changed, err := g.affected([]string{filepath.Join(sdk, "api.go")})
	require.NoError(t, err)
	require.Subset(t, nodeIDs(changed), []string{"bindings", "host-backend"}, "an SDK checkout edit rebuilds bindings and the host")

	g.plan.SDK = devsdk.PublishedSelection()
	published := g.watchRoots()
	require.Len(t, published, len(g.workspace.Manifest.Repositories))
	require.NotContains(t, published, "", "a published SDK must never add an empty watch root")
	require.False(t, g.sdkContains(sdk), "a published SDK has no checkout to contain paths")
	require.False(t, g.sdkContains(""))
	changed, err = g.affected([]string{filepath.Join(sdk, "api.go")})
	require.NoError(t, err)
	require.Empty(t, nodeIDs(changed), "SDK checkout edits are not SDK changes when no checkout is selected")
}

func nodeIDs(nodes []BuildNode) []string {
	var ids []string
	for _, node := range nodes {
		ids = append(ids, node.ID)
	}
	return ids
}

// Start and Restart resolve the supervisor executable through the manager, so a
// test can never exec its own binary when launch preconditions are met.
func TestStartAndRestartResolveTheSupervisorExecutableThroughTheManager(t *testing.T) {
	m, _ := fixtureManager(t)
	resolved := 0
	m.options.Executable = func() (string, error) {
		resolved++
		return forbidSupervisorExecutable()
	}
	ctx := context.Background()
	w, err := m.Create(ctx, CreateOptions{Slug: "executable-seam", Repositories: []string{"plugin-sdk"}})
	require.NoError(t, err)
	options := LaunchOptions{Mode: "browser"}
	require.NoError(t, saveLaunchJSON(launchPath(w, "launch.json"), options))

	_, err = m.Restart(ctx, w.Manifest.WorkspaceID)
	require.ErrorIs(t, err, errSupervisorExecutableForbidden)
	_, err = m.Start(ctx, w.Manifest.WorkspaceID, options, "", io.Discard)
	require.ErrorIs(t, err, errSupervisorExecutableForbidden)
	require.Equal(t, 2, resolved)

	_, err = m.Start(ctx, w.Manifest.WorkspaceID, options, "/must-not-launch", io.Discard)
	require.Error(t, err)
	require.NotErrorIs(t, err, errSupervisorExecutableForbidden)
	require.Equal(t, 2, resolved, "an explicit executable must bypass the resolver")
}
