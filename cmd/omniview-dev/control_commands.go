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
	usage := func(message string) (controlCommand, error) { return command, devcontract.Fail(2, "usage", message) }
	if len(args) < 2 {
		return usage("command action is required; see development-cli.md")
	}
	group, action, start := args[0], args[1], 2
	if group == "plugin" && action == "dev" {
		if len(args) < 3 {
			return usage("plugin dev action is required")
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
	var path, version, generation, scope, plugin, id, value, values string
	var cursor, limit int
	switch command.operation {
	case "instance.inspect", "plugin.list":
	case "plugin.get", "plugin.uninstall", "plugin.dev.unlink", "plugin.dev.start", "plugin.dev.stop", "plugin.dev.restart", "plugin.dev.status":
		flags.StringVar(&id, "id", "", "plugin ID")
	case "plugin.install-archive", "plugin.dev.link":
		flags.StringVar(&path, "path", "", "archive or plugin source path")
	case "plugin.install-version":
		flags.StringVar(&id, "id", "", "plugin ID")
		flags.StringVar(&version, "version", "", "exact plugin version")
	case "plugin.dev.rebuild":
		flags.StringVar(&id, "id", "", "plugin ID")
		flags.StringVar(&generation, "generation", "", "expected plugin generation")
	case "plugin.dev.logs":
		flags.StringVar(&id, "id", "", "plugin ID")
		flags.IntVar(&cursor, "cursor", 0, "log cursor")
		flags.IntVar(&limit, "limit", 100, "maximum log records (1..500)")
		flags.BoolVar(&command.unsafeOutput, "unsafe-output", false, "include raw potentially sensitive plugin/build output in JSON stdout")
	case "settings.schema", "settings.get", "settings.set", "settings.set-many":
		flags.StringVar(&scope, "scope", "host", "host or plugin")
		flags.StringVar(&plugin, "plugin", "", "plugin ID for plugin settings")
		if action != "schema" {
			flags.StringVar(&id, "id", "", "setting ID")
		}
		if action == "set" {
			flags.StringVar(&value, "value", "", "one JSON value; - reads stdin")
		}
		if action == "set-many" {
			flags.StringVar(&values, "values", "", "JSON object; - reads stdin")
		}
	case "operation.get", "operation.wait":
		flags.StringVar(&id, "id", "", "operation ID")
	default:
		return usage("unknown control command")
	}
	// Standard flag stops at the first positional. Reorder only declared flags;
	// consume their values before interpreting positional arguments.
	var options, positional []string
	for i := start; i < len(args); i++ {
		arg := args[i]
		if arg == "--" {
			positional = append(positional, args[i+1:]...)
			break
		}
		if !strings.HasPrefix(arg, "-") || arg == "-" {
			positional = append(positional, arg)
			continue
		}
		name, _, hasValue := strings.Cut(strings.TrimLeft(arg, "-"), "=")
		option := flags.Lookup(name)
		if option == nil {
			return usage("unknown command flag")
		}
		options = append(options, arg)
		boolean, ok := option.Value.(interface{ IsBoolFlag() bool })
		if !hasValue && !(ok && boolean.IsBoolFlag()) {
			if i+1 >= len(args) {
				return usage("command flag requires a value")
			}
			i++
			options = append(options, args[i])
		}
	}
	if err := flags.Parse(options); err != nil {
		return usage("invalid command flags")
	}
	if command.timeout <= 0 {
		return usage("timeout must be positive")
	}
	if len(positional) > 1 {
		return usage("at most one positional target is accepted")
	}
	if len(positional) == 1 {
		if command.operation == "plugin.install-archive" || command.operation == "plugin.dev.link" {
			if path != "" && path != positional[0] {
				return usage("path arguments disagree")
			}
			path = positional[0]
		} else {
			if id != "" && id != positional[0] {
				return usage("ID arguments disagree")
			}
			id = positional[0]
		}
	}
	requireID := func() error {
		if strings.TrimSpace(id) == "" || strings.ContainsAny(id, "/\\\x00\r\n") {
			return devcontract.Fail(2, "usage", "a valid explicit ID is required")
		}
		return nil
	}
	switch command.operation {
	case "instance.inspect", "plugin.list":
		if len(positional) != 0 {
			return usage("this command accepts no positional target")
		}
		command.params = devcontrol.EmptyParams{}
	case "plugin.install-archive", "plugin.dev.link":
		if path == "" {
			return usage("--path is required")
		}
		canonical, err := devcontract.CanonicalPath(path)
		if err != nil {
			return command, err
		}
		command.params = devcontrol.PathParams{Path: canonical}
	case "plugin.install-version":
		if err := requireID(); err != nil {
			return command, err
		}
		if version == "" {
			return usage("--version is required")
		}
		command.params = devcontrol.VersionParams{ID: id, Version: version}
	case "plugin.dev.rebuild":
		if err := requireID(); err != nil {
			return command, err
		}
		if generation == "" {
			return usage("--generation is required; use plugin dev status to obtain the plugin generation")
		}
		command.params = devcontrol.RebuildParams{ID: id, Generation: generation}
	case "plugin.dev.logs":
		if err := requireID(); err != nil {
			return command, err
		}
		if cursor < 0 || limit < 1 || limit > 500 {
			return usage("cursor must be nonnegative and limit must be 1..500")
		}
		command.params = devcontrol.LogsParams{ID: id, Cursor: cursor, Limit: limit, IncludeOutput: command.unsafeOutput}
	case "settings.schema", "settings.get", "settings.set", "settings.set-many":
		if scope != "host" && scope != "plugin" || scope == "plugin" && plugin == "" || scope == "host" && plugin != "" {
			return usage("settings scope must be host, or plugin with --plugin ID")
		}
		params := devcontrol.SettingsParams{Scope: scope, PluginID: plugin, ID: id}
		if action == "schema" && len(positional) > 0 {
			return usage("settings schema accepts no ID")
		}
		if action == "set" {
			if id == "" || value == "" {
				return usage("settings set requires --id and --value JSON (or -)")
			}
			raw, err := readControlJSON(value, in)
			if err != nil {
				return command, err
			}
			params.Value = raw
		}
		if action == "set-many" {
			if id != "" || values == "" {
				return usage("settings set-many requires --values JSON object (or -), without --id")
			}
			raw, err := readControlJSON(values, in)
			if err != nil {
				return command, err
			}
			if err = json.Unmarshal(raw, &params.Values); err != nil || params.Values == nil {
				return usage("settings values must be a JSON object")
			}
		}
		if action == "set-many" {
			command.operation = "settings.bulk"
		}
		command.params = params
	case "operation.get", "operation.wait":
		if err := requireID(); err != nil {
			return command, err
		}
		command.params = devcontrol.OperationParams{OperationID: id}
	default:
		if err := requireID(); err != nil {
			return command, err
		}
		command.params = devcontrol.PluginParams{ID: id}
	}
	return command, nil
}

func readControlJSON(value string, in io.Reader) (json.RawMessage, error) {
	data := []byte(value)
	if value == "-" {
		if in == nil {
			return nil, devcontract.Fail(2, "invalid_params", "JSON stdin is required")
		}
		var err error
		data, err = io.ReadAll(io.LimitReader(in, 1<<20+1))
		if err != nil {
			return nil, devcontract.Fail(2, "invalid_params", "cannot read JSON stdin")
		}
	}
	if len(data) > 1<<20 || !json.Valid(data) {
		return nil, devcontract.Fail(2, "invalid_params", "settings require one valid JSON value, at most 1 MiB")
	}
	return json.RawMessage(data), nil
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
