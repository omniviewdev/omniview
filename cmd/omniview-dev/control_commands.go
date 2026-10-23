package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devcontrol"
	"github.com/omniviewdev/omniview/internal/devsession"
	"github.com/omniviewdev/omniview/internal/devworkspace"
	"github.com/omniviewdev/omniview/internal/instance"
)

// HandleControlCommand is the root CLI integration point. Unrecognized command
// groups are left to the workspace/orchestration handler without side effects.
func HandleControlCommand(ctx context.Context, args []string, in io.Reader, out, diagnostics io.Writer) (bool, int) {
	if len(args) == 0 {
		return false, 0
	}
	switch args[0] {
	case "instance", "plugin", "settings", "operation":
	default:
		return false, 0
	}
	fail := func(err error) (bool, int) {
		var typed *devcontract.Error
		if !errors.As(err, &typed) {
			typed = devcontract.Fail(5, "operation_failed", "development control operation failed")
		}
		_ = json.NewEncoder(out).Encode(map[string]any{"error": typed})
		return true, devcontract.ExitCode(typed)
	}
	command, err := parseControlCommand(args, in, diagnostics)
	if err != nil {
		return fail(err)
	}
	workspace, err := resolveControlWorkspace(ctx, command.root, command.workspace)
	if err != nil {
		return fail(err)
	}
	client, inspection, err := connectControl(ctx, workspace)
	if err != nil {
		return fail(err)
	}
	defer client.Close()
	var response devcontract.Response
	if command.operation == "instance.inspect" {
		response = inspection
	} else if command.operation == "operation.wait" {
		response, err = client.Wait(ctx, command.params.(devcontrol.OperationParams).OperationID, command.timeout)
	} else {
		response, err = client.Call(ctx, command.operation, command.params)
		if err == nil && command.wait && response.OperationID != "" && (response.Status == "accepted" || response.Status == "running") {
			response, err = client.Wait(ctx, response.OperationID, command.timeout)
		}
	}
	if err != nil && (response.Status == "" || response.Error == nil) {
		return fail(err)
	}
	if command.operation == "plugin.dev.logs" && response.Error == nil && !command.unsafeOutput {
		var page devcontrol.LogPage
		if json.Unmarshal(response.Result, &page) != nil {
			return fail(devcontract.Fail(5, "invalid_response", "invalid log response"))
		}
		for _, entry := range page.Entries {
			if _, writeErr := fmt.Fprintf(diagnostics, "%s [%s] [%s] %s\n", entry.Timestamp, entry.Source, entry.Level, entry.Message); writeErr != nil {
				return fail(devcontract.Fail(5, "output_failed", "cannot write log output"))
			}
		}
		// Stdout contains only the structured pagination metadata, never diagnostics.
		response.Result, _ = json.Marshal(struct {
			NextCursor int  `json:"nextCursor"`
			Truncated  bool `json:"truncated"`
			Count      int  `json:"count"`
		}{page.NextCursor, page.Truncated, len(page.Entries)})
	}
	if command.unsafeOutput {
		if _, writeErr := fmt.Fprintln(diagnostics, "WARNING: --unsafe-output includes raw plugin/build logs in JSON stdout; arbitrary plugin output may contain secrets. Store and share this output deliberately."); writeErr != nil {
			return fail(devcontract.Fail(5, "output_failed", "cannot write unsafe-output warning"))
		}
	}
	if encodeErr := json.NewEncoder(out).Encode(response); encodeErr != nil {
		return true, 5
	}
	if err != nil {
		return true, devcontract.ExitCode(err)
	}
	if response.Error != nil {
		return true, devcontract.ExitCode(response.Error)
	}
	return true, 0
}

type controlCommand struct {
	operation       string
	params          any
	workspace, root string
	wait            bool
	unsafeOutput    bool
	timeout         time.Duration
}

func parseControlCommand(args []string, in io.Reader, diagnostics io.Writer) (controlCommand, error) {
	var command controlCommand
	if len(args) < 2 {
		return command, controlUsage("command action is required; see development-cli.md")
	}
	group, action, start := args[0], args[1], 2
	if group == "plugin" && action == "dev" {
		if len(args) < 3 {
			return command, controlUsage("plugin dev action is required")
		}
		action = "dev." + args[2]
		start = 3
	}
	command.operation = group + "." + action
	flags := flag.NewFlagSet(command.operation, flag.ContinueOnError)
	flags.SetOutput(diagnostics)
	flags.StringVar(&command.workspace, "workspace", "", "explicit workspace name, UUID, manifest or directory")
	flags.StringVar(&command.root, "root", "", "registered repository collection root for workspace names")
	flags.Bool("json", true, "JSON stdout (always enabled)")
	flags.BoolVar(&command.wait, "wait", false, "wait for accepted mutation completion")
	flags.DurationVar(&command.timeout, "timeout", 30*time.Second, "maximum wait; timeout does not cancel mutation")
	switch group {
	case "plugin":
		err := parsePluginControlCommand(&command, flags, args[start:])
		return command, err
	case "settings":
		err := parseSettingsControlCommand(&command, flags, args[start:], in)
		return command, err
	case "operation":
		err := parseOperationControlCommand(&command, flags, args[start:])
		return command, err
	case "instance":
		if action == "inspect" {
			positionals, err := parseControlFlags(&command, flags, args[start:])
			if err != nil {
				return command, err
			}
			if len(positionals) != 0 {
				return command, controlUsage("this command accepts no positional target")
			}
			command.params = devcontrol.EmptyParams{}
			return command, nil
		}
	}
	return command, controlUsage("unknown control command")
}

func controlUsage(message string) error {
	return devcontract.Fail(2, "usage", message)
}

func parseControlFlags(command *controlCommand, flags *flag.FlagSet, args []string) ([]string, error) {
	normalized := normalizeRegisteredFlags(flags, args, nil)
	if normalized.unknownFlag {
		return nil, controlUsage("unknown command flag")
	}
	if normalized.missingValue != "" {
		return nil, controlUsage("command flag requires a value")
	}
	if err := flags.Parse(normalized.options); err != nil {
		return nil, controlUsage("invalid command flags")
	}
	if command.timeout <= 0 {
		return nil, controlUsage("timeout must be positive")
	}
	if len(normalized.positionals) > 1 {
		return nil, controlUsage("at most one positional target is accepted")
	}
	return normalized.positionals, nil
}

func controlTarget(explicit string, positionals []string, disagreement string) (string, error) {
	if len(positionals) == 0 {
		return explicit, nil
	}
	if explicit != "" && explicit != positionals[0] {
		return "", controlUsage(disagreement)
	}
	return positionals[0], nil
}

func requireControlID(id string) error {
	if strings.TrimSpace(id) == "" || strings.ContainsAny(id, "/\\\x00\r\n") {
		return controlUsage("a valid explicit ID is required")
	}
	return nil
}

// resolveControlWorkspace leaves manifest validation and profile isolation to
// A01; only names are looked up through the A03 registered collection.
func resolveControlWorkspace(ctx context.Context, root, explicit string) (devcontract.ResolvedWorkspace, error) {
	cwd, err := os.Getwd()
	if err != nil {
		return devcontract.ResolvedWorkspace{}, err
	}
	environment := os.Getenv(devcontract.WorkspaceEnvironment)
	isName := explicit != "" && !filepath.IsAbs(explicit) && !strings.ContainsAny(explicit, "/\\") && explicit != "." && explicit != ".." && explicit != "workspace.json"
	// Existing relative directories are paths, not ambiguous registry names.
	if isName {
		if _, e := os.Stat(explicit); e == nil {
			isName = false
		}
	}
	if isName {
		if root == "" {
			for dir := cwd; ; dir = filepath.Dir(dir) {
				if _, e := os.Stat(filepath.Join(dir, ".omniview-dev", "repositories.json")); e == nil {
					root = dir
					break
				}
				if filepath.Dir(dir) == dir {
					break
				}
			}
		}
		if root == "" {
			return devcontract.ResolvedWorkspace{}, devcontract.Fail(3, "missing_registry", "workspace name requires --root or an enclosing registered repository collection")
		}
		manager, e := devworkspace.Open(root, devworkspace.Options{})
		if e != nil {
			return devcontract.ResolvedWorkspace{}, e
		}
		workspace, e := manager.Inspect(ctx, explicit)
		if e != nil {
			return devcontract.ResolvedWorkspace{}, e
		}
		explicit = workspace.ManifestPath
	}
	return devcontract.ResolveWorkspace(devcontract.ResolveOptions{CWD: cwd, Explicit: explicit, EnvironmentManifest: environment, StateRoot: os.Getenv("OMNIVIEW_STATE_DIR")})
}

func connectControl(ctx context.Context, workspace devcontract.ResolvedWorkspace) (*devcontrol.Client, devcontract.Response, error) {
	var empty devcontract.Response
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, empty, err
	}
	profile, err := instance.Resolve(instance.Options{Workspace: workspace.ManifestPath, StateRoot: workspace.StateRoot, Home: home})
	if err != nil {
		return nil, empty, err
	}
	store, err := devsession.OpenDiscoveryStore(profile.RuntimeRoot)
	if err != nil {
		return nil, empty, devcontract.Fail(4, "invalid_discovery", "cannot open private workspace discovery")
	}
	discovery, err := store.Read(ctx, workspace.Manifest.WorkspaceID, "")
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, empty, devcontract.Fail(3, "instance_not_running", "no running development instance discovered")
		}
		return nil, empty, devcontract.Fail(4, "invalid_discovery", "workspace discovery identity or private permissions are invalid")
	}
	host, err := workspace.RepositoryPath("omniview")
	if err != nil {
		return nil, empty, err
	}
	if discovery.StateRoot != workspace.StateRoot || discovery.Process.Source != host || discovery.Process.Role != "host" || discovery.Endpoints.Control == nil {
		return nil, empty, devcontract.Fail(4, "conflicting_target", "discovered instance does not match the selected workspace source/profile")
	}
	expected := devsession.ProcessOwner{WorkspaceID: discovery.WorkspaceID, Generation: discovery.Generation, Role: "host", Source: host}
	if err = devsession.VerifyOwnedProcess(discovery.Process, expected); err != nil {
		return nil, empty, devcontract.Fail(4, "stale_target", "discovered process identity is no longer owned by this generation")
	}
	token, err := os.ReadFile(discovery.TokenFile)
	if err != nil {
		return nil, empty, devcontract.Fail(6, "unauthorized", "cannot read private control token")
	}
	client, err := devcontrol.NewClient(*discovery.Endpoints.Control, token, discovery.WorkspaceID, discovery.Generation)
	if err != nil {
		return nil, empty, err
	}
	response, err := client.Call(ctx, "instance.inspect", devcontrol.EmptyParams{})
	if err != nil {
		client.Close()
		return nil, empty, err
	}
	var actual devcontract.InstanceDescriptor
	if json.Unmarshal(response.Result, &actual) != nil {
		client.Close()
		return nil, empty, devcontract.Fail(5, "invalid_response", "control endpoint returned an invalid instance descriptor")
	}
	if actual.SchemaVersion != devcontract.SchemaVersion || actual.Kind != "development" || actual.WorkspaceID != workspace.Manifest.WorkspaceID || actual.InstanceID != discovery.InstanceID || actual.Generation != discovery.Generation || actual.StateRoot != workspace.StateRoot || actual.Process != discovery.Process || actual.Endpoints.Control == nil || *actual.Endpoints.Control != *discovery.Endpoints.Control {
		client.Close()
		return nil, empty, devcontract.Fail(4, "stale_target", "authenticated endpoint identity differs from the selected discovery generation")
	}
	return client, response, nil
}
