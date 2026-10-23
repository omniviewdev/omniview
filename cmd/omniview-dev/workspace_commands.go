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
	"sort"
	"strings"
	"time"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devworkspace"
)

type repeatedWorkspaceFlag []string

func (v *repeatedWorkspaceFlag) String() string         { return strings.Join(*v, ",") }
func (v *repeatedWorkspaceFlag) Set(value string) error { *v = append(*v, value); return nil }

type workspaceCommand struct {
	verb, root, target, explicit, name, slug, stateRoot, linkEvidence                           string
	json, start, deleteState, deleteBranches                                                    bool
	repositories, plugins, refs, addRepositories, removeRepositories, addPlugins, removePlugins repeatedWorkspaceFlag
	sources, sourceRefs, sourceDirectories                                                      repeatedWorkspaceFlag
	ports                                                                                       repeatedWorkspaceFlag
	portPolicy                                                                                  string
	launch                                                                                      devworkspace.LaunchOptions
	supplied                                                                                    map[string]bool
}

func parseWorkspaceCommand(args []string, diagnostics io.Writer) (workspaceCommand, error) {
	c := workspaceCommand{supplied: map[string]bool{}}
	if len(args) < 2 {
		return c, devcontract.Fail(2, "usage", "workspace requires a command")
	}
	c.verb = args[1]
	flags := flag.NewFlagSet("workspace "+c.verb, flag.ContinueOnError)
	flags.SetOutput(diagnostics)
	flags.StringVar(&c.root, "root", "", "machine-local source registry/collection root")
	flags.StringVar(&c.explicit, "workspace", "", "explicit workspace manifest/directory")
	flags.BoolVar(&c.json, "json", false, "machine-readable output; diagnostics remain stderr")
	launchFlags := func() {
		flags.StringVar(&c.launch.Mode, "mode", "browser", "browser or native")
		flags.BoolVar(&c.launch.MCP, "mcp", false, "enable authenticated native MCP")
		flags.BoolVar(&c.launch.Watch, "watch", true, "own source build/watch for the session lifetime")
		flags.BoolVar(&c.launch.LiveFrontend, "live-frontend", true, "run actual strict host Vite and HMR")
		flags.StringVar(&c.launch.ReviewedSDKRevision, "reviewed-sdk-revision", "", "independently reviewed full SDK commit")
		flags.BoolVar(&c.launch.AllowIsolationSourceChanges, "allow-isolation-source-changes", false, "explicitly allow SDK isolation-boundary edits in this workspace")
		flags.StringVar(&c.linkEvidence, "link-evidence", "", "actual successful pinned pnpm probe JSON")
		flags.StringVar(&c.launch.BaselineSource, "seed-from", "", "stopped baseline source state root")
		flags.StringVar(&c.launch.BaselineVersion, "seed-version", "", "nonsecret baseline source build version")
		flags.DurationVar(&c.launch.Timeout, "timeout", 20*time.Minute, "bounded build/readiness deadline")
	}
	if c.verb == "create" || c.verb == "edit" || c.verb == "up" {
		flags.StringVar(&c.portPolicy, "port-policy", "", "sticky or strict durable listener policy")
		flags.Var(&c.ports, "port", "ROLE=PORT override (repeatable); 0 clears")
	}
	switch c.verb {
	case "init":
		flags.Var(&c.sources, "source", "ID=source-path (repeatable)")
		flags.Var(&c.sourceRefs, "source-ref", "ID=default-ref (repeatable)")
		flags.Var(&c.sourceDirectories, "source-directory", "ID=worktree-directory (repeatable)")
	case "create":
		flags.StringVar(&c.name, "name", "", "workspace display name")
		flags.Var(&c.repositories, "repo", "selected repository ID (repeatable)")
		flags.Var(&c.plugins, "plugin", "plugin ID read from selected committed plugin.yaml (repeatable)")
		flags.Var(&c.refs, "ref", "ID=ref override (repeatable)")
		flags.BoolVar(&c.start, "start", false, "build and launch after creation")
		flags.StringVar(&c.stateRoot, "state-root", "", "explicit custom state leaf under a new dedicated profile container")
		launchFlags()
	case "up":
		launchFlags()
	case "down", "restart":
		flags.DurationVar(&c.launch.Timeout, "timeout", 20*time.Minute, "bounded stop/restart wait")
	case "edit":
		flags.StringVar(&c.name, "name", "", "new display name")
		flags.StringVar(&c.slug, "slug", "", "new workspace slug")
		flags.Var(&c.addRepositories, "add-repo", "repository ID (repeatable)")
		flags.Var(&c.removeRepositories, "remove-repo", "repository ID (repeatable)")
		flags.Var(&c.addPlugins, "add-plugin", "plugin ID (repeatable)")
		flags.Var(&c.removePlugins, "remove-plugin", "plugin ID (repeatable)")
		flags.Var(&c.refs, "ref", "ID=ref override (repeatable)")
	case "link":
		flags.StringVar(&c.linkEvidence, "link-evidence", "", "actual successful pinned pnpm probe JSON")
	case "remove":
		flags.BoolVar(&c.deleteState, "delete-state", false, "explicitly delete owned stopped profile state")
		flags.BoolVar(&c.deleteBranches, "delete-branches", false, "explicitly delete owned feature branches")
	case "profile":
		flags.StringVar(&c.stateRoot, "state-root", "", "explicit custom state leaf under a new dedicated profile container")
	case "inspect", "paths", "list", "unlink", "resume", "rollback", "supervise":
	default:
		return c, devcontract.Fail(2, "usage", "unknown workspace command; use --help")
	}
	normalized := normalizeRegisteredFlags(flags, args[2:], c.supplied)
	if normalized.missingValue != "" {
		return c, devcontract.Fail(2, "usage", "--"+normalized.missingValue+" requires a value")
	}
	if err := flags.Parse(normalized.options); err != nil {
		return c, devcontract.Fail(2, "usage", "invalid workspace command flags")
	}
	positionals := normalized.positionals
	if len(positionals) > 1 {
		return c, devcontract.Fail(2, "usage", "at most one workspace target is accepted")
	}
	if len(positionals) == 1 {
		c.target = positionals[0]
	}
	if c.explicit != "" && c.target != "" && c.explicit != c.target {
		return c, devcontract.Fail(4, "conflicting_target", "workspace arguments disagree")
	}
	if c.explicit != "" {
		c.target = c.explicit
	}
	if (c.verb == "init" || c.verb == "list") && c.target != "" {
		return c, devcontract.Fail(2, "usage", "this command accepts --root, not a workspace target")
	}
	if c.supplied["timeout"] && c.launch.Timeout <= 0 {
		return c, devcontract.Fail(2, "usage", "timeout must be positive")
	}
	return c, nil
}

func workspaceAssignments(values []string) (map[string]string, error) {
	result := map[string]string{}
	for _, value := range values {
		key, item, ok := strings.Cut(value, "=")
		if !ok || key == "" || item == "" {
			return nil, devcontract.Fail(2, "usage", "mapping flags require nonempty ID=value")
		}
		if _, exists := result[key]; exists {
			return nil, devcontract.Fail(2, "duplicate_selection", "mapping ID selected more than once")
		}
		result[key] = item
	}
	return result, nil
}

func workspaceCollectionRoot(explicit string) (string, error) {
	if explicit != "" {
		return devcontract.CanonicalPath(explicit)
	}
	directory, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		if _, err = os.Stat(filepath.Join(directory, ".omniview-dev", "repositories.json")); err == nil {
			return directory, nil
		} else if !os.IsNotExist(err) {
			return "", err
		}
		parent := filepath.Dir(directory)
		if parent == directory {
			break
		}
		directory = parent
	}
	return "", devcontract.Fail(3, "missing_registry", "select --root COLLECTION or run inside an initialized collection")
}
func resolveWorkspaceCLI(ctx context.Context, c workspaceCommand) (devworkspace.Workspace, *devworkspace.Manager, error) {
	// An explicit manifest/path is authoritative; an invalid explicit context can
	// never fall through to another registry workspace or production state.
	pathTarget := c.explicit != "" || c.target == "" || strings.ContainsAny(c.target, "/\\") || filepath.IsAbs(c.target)
	if !pathTarget && c.root == "" {
		if _, err := os.Lstat(c.target); err == nil {
			pathTarget = true
		} else if !os.IsNotExist(err) {
			return devworkspace.Workspace{}, nil, err
		} else if _, err = workspaceCollectionRoot(""); err != nil {
			pathTarget = true
		}
	}
	if pathTarget {
		resolved, err := devcontract.ResolveWorkspace(devcontract.ResolveOptions{Explicit: c.target, EnvironmentManifest: os.Getenv(devcontract.WorkspaceEnvironment), StateRoot: os.Getenv("OMNIVIEW_STATE_DIR")})
		if err != nil {
			return devworkspace.Workspace{}, nil, err
		}
		w := devworkspace.Workspace{ResolvedWorkspace: resolved}
		root := c.root
		if root == "" {
			root = filepath.Dir(filepath.Dir(resolved.Root))
		}
		manager, err := devworkspace.Open(root, devworkspace.Options{Stopped: devworkspace.RequireStopped})
		if err != nil {
			var typed *devcontract.Error
			if c.root == "" && (c.verb == "inspect" || c.verb == "paths") && errors.As(err, &typed) && typed.Code == "missing_registry" {
				return w, nil, nil
			}
			return w, nil, err
		}
		managed, err := manager.Inspect(ctx, resolved.Manifest.WorkspaceID)
		if err == nil && managed.Root != resolved.Root {
			return managed, manager, devcontract.Fail(4, "conflicting_target", "explicit workspace path disagrees with the selected collection")
		}
		return managed, manager, err
	}
	root, err := workspaceCollectionRoot(c.root)
	if err != nil {
		return devworkspace.Workspace{}, nil, err
	}
	manager, err := devworkspace.Open(root, devworkspace.Options{Stopped: devworkspace.RequireStopped})
	if err != nil {
		return devworkspace.Workspace{}, nil, err
	}
	w, err := manager.Inspect(ctx, c.target)
	if err != nil {
		return w, manager, err
	}
	resolved, err := devcontract.ResolveWorkspace(devcontract.ResolveOptions{Explicit: w.ManifestPath, EnvironmentManifest: os.Getenv(devcontract.WorkspaceEnvironment), StateRoot: os.Getenv("OMNIVIEW_STATE_DIR")})
	if err != nil {
		return w, manager, err
	}
	w.ResolvedWorkspace = resolved
	return w, manager, nil
}

func workspaceLaunchOptions(c workspaceCommand, w devworkspace.Workspace) (devworkspace.LaunchOptions, error) {
	options := c.launch
	if previous, err := devworkspace.LoadLaunchOptions(w); err == nil {
		options.LinkEvidence = previous.LinkEvidence
		if c.verb == "up" {
			if !c.supplied["mode"] {
				options.Mode = previous.Mode
			}
			if !c.supplied["mcp"] {
				options.MCP = previous.MCP
			}
			if !c.supplied["watch"] {
				options.Watch = previous.Watch
			}
			if !c.supplied["live-frontend"] {
				options.LiveFrontend = previous.LiveFrontend
			}
			if !c.supplied["reviewed-sdk-revision"] {
				options.ReviewedSDKRevision = previous.ReviewedSDKRevision
			}
			if !c.supplied["allow-isolation-source-changes"] {
				options.AllowIsolationSourceChanges = previous.AllowIsolationSourceChanges
			}
			if !c.supplied["seed-from"] {
				options.BaselineSource = previous.BaselineSource
			}
			if !c.supplied["seed-version"] {
				options.BaselineVersion = previous.BaselineVersion
			}
		}
	} else if !os.IsNotExist(err) {
		return options, err
	}
	evidence := c.linkEvidence
	if evidence == "" && options.LinkEvidence.Protocol == "" {
		if c.root != "" {
			evidence = filepath.Join(c.root, ".omniview-dev", "link-protocol.json")
		}
	}
	if evidence != "" {
		raw, err := os.ReadFile(evidence)
		if err != nil {
			return options, devcontract.Fail(3, "link_evidence_required", "provide --link-evidence with the actual successful pinned protocol probe report")
		}
		if err = json.Unmarshal(raw, &options.LinkEvidence); err != nil {
			return options, devcontract.Fail(2, "invalid_link_evidence", "pinned protocol probe report is invalid JSON")
		}
	}
	if options.BaselineSource != "" {
		canonical, err := devcontract.CanonicalPath(options.BaselineSource)
		if err != nil {
			return options, err
		}
		options.BaselineSource = canonical
	}
	return options, nil
}

func HandleWorkspaceCommand(ctx context.Context, args []string, out, diagnostics io.Writer) (bool, int) {
	if len(args) == 0 || args[0] != "workspace" {
		return false, 0
	}
	fail := func(err error) (bool, int) {
		var payload *devcontract.Error
		if !errors.As(err, &payload) {
			payload = devcontract.Fail(5, "operation_failed", err.Error())
		}
		if payload.Exit == 0 {
			payload.Exit = 5
		}
		_ = json.NewEncoder(out).Encode(map[string]any{"error": payload})
		return true, devcontract.ExitCode(payload)
	}
	c, err := parseWorkspaceCommand(args, diagnostics)
	if err != nil {
		return fail(err)
	}
	var value any
	if c.verb == "init" {
		root := c.root
		if root == "" {
			root, err = os.Getwd()
			if err != nil {
				return fail(err)
			}
		}
		paths, parseErr := workspaceAssignments(c.sources)
		if parseErr != nil {
			return fail(parseErr)
		}
		refs, parseErr := workspaceAssignments(c.sourceRefs)
		if parseErr != nil {
			return fail(parseErr)
		}
		directories, parseErr := workspaceAssignments(c.sourceDirectories)
		if parseErr != nil {
			return fail(parseErr)
		}
		ids := make([]string, 0, len(paths))
		for id := range paths {
			ids = append(ids, id)
		}
		sort.Strings(ids)
		specs := make([]devworkspace.SourceSpec, 0, len(paths))
		for _, id := range ids {
			specs = append(specs, devworkspace.SourceSpec{ID: id, Path: paths[id], DefaultRef: refs[id], Directory: directories[id]})
		}
		for id := range refs {
			if _, ok := paths[id]; !ok {
				return fail(devcontract.Fail(2, "unselected_ref", "--source-ref must name an explicit --source"))
			}
		}
		for id := range directories {
			if _, ok := paths[id]; !ok {
				return fail(devcontract.Fail(2, "unselected_directory", "--source-directory must name an explicit --source"))
			}
		}
		value, err = devworkspace.Init(ctx, devworkspace.InitOptions{Root: root, Sources: specs})
	} else if c.verb == "create" || c.verb == "list" {
		root, rootErr := workspaceCollectionRoot(c.root)
		if rootErr != nil {
			return fail(rootErr)
		}
		manager, openErr := devworkspace.Open(root, devworkspace.Options{Stopped: devworkspace.RequireStopped})
		if openErr != nil {
			return fail(openErr)
		}
		if c.verb == "list" {
			value, err = manager.List(ctx)
		} else {
			if c.target == "" {
				return fail(devcontract.Fail(2, "usage", "create requires a workspace slug"))
			}
			refs, parseErr := workspaceAssignments(c.refs)
			if parseErr != nil {
				return fail(parseErr)
			}
			if c.start {
				if trustErr := c.launch.Validate(); trustErr != nil {
					return fail(trustErr)
				}
			}
			ports, portErr := workspacePortPolicy(c, devcontract.PortPolicy{Policy: "sticky"}, c.plugins)
			if portErr != nil {
				return fail(portErr)
			}
			var w devworkspace.Workspace
			w, err = manager.Create(ctx, devworkspace.CreateOptions{Slug: c.target, DisplayName: c.name, Repositories: c.repositories, Plugins: c.plugins, Refs: refs, Ports: ports})
			if err == nil && c.stateRoot != "" {
				w, err = bindWorkspaceProfile(ctx, manager, w, c.stateRoot)
			}
			value = w
			if err == nil && c.start {
				c.root = root
				options, optionErr := workspaceLaunchOptions(c, w)
				if optionErr != nil {
					return fail(optionErr)
				}
				value, err = manager.Start(ctx, w.Manifest.WorkspaceID, options, "", diagnostics)
			}
		}
	} else if c.verb == "resume" || c.verb == "rollback" || c.verb == "remove" {
		target := c.target
		path := ""
		collection := c.root
		if c.explicit != "" || strings.ContainsAny(target, "/\\") || filepath.IsAbs(target) {
			path = target
			if filepath.Base(path) == "workspace.json" {
				path = filepath.Dir(path)
			}
			path, err = devcontract.CanonicalPath(path)
			if err != nil {
				return fail(err)
			}
			if collection == "" {
				collection = filepath.Dir(filepath.Dir(path))
			}
		}
		root, rootErr := workspaceCollectionRoot(collection)
		if rootErr != nil {
			return fail(rootErr)
		}
		manager, openErr := devworkspace.Open(root, devworkspace.Options{Stopped: devworkspace.RequireStopped})
		if openErr != nil {
			return fail(openErr)
		}
		if path != "" {
			if filepath.Dir(path) != filepath.Join(root, "workspaces") {
				return fail(devcontract.Fail(4, "conflicting_target", "explicit lifecycle workspace path is outside the selected collection"))
			}
			target = filepath.Base(path)
		}
		if target == "" {
			resolved, resolveErr := devcontract.ResolveWorkspace(devcontract.ResolveOptions{EnvironmentManifest: os.Getenv(devcontract.WorkspaceEnvironment), StateRoot: os.Getenv("OMNIVIEW_STATE_DIR")})
			if resolveErr != nil {
				return fail(resolveErr)
			}
			target = resolved.Manifest.WorkspaceID
		}
		target, err = manager.ValidateLifecycleContext(ctx, target, os.Getenv(devcontract.WorkspaceEnvironment), os.Getenv("OMNIVIEW_STATE_DIR"))
		if err != nil {
			return fail(err)
		}
		switch c.verb {
		case "resume":
			value, err = manager.ResumeWorkspace(ctx, target)
		case "rollback":
			err = manager.RollbackWorkspace(ctx, target)
			value = map[string]any{"rolledBack": err == nil}
		case "remove":
			value, err = manager.RemoveWorkspace(ctx, target, devworkspace.RemoveOptions{PurgeState: c.deleteState, DeleteBranches: c.deleteBranches}, diagnostics)
		}
	} else {
		w, manager, resolveErr := resolveWorkspaceCLI(ctx, c)
		if resolveErr != nil {
			return fail(resolveErr)
		}
		if manager != nil {
			c.root = manager.Root
		}
		if manager != nil && (c.verb == "up" || c.verb == "link") && c.linkEvidence == "" {
			evidence, evidenceErr := manager.LinkEvidence(ctx, w.Manifest.WorkspaceID)
			if evidenceErr == nil {
				c.launch.LinkEvidence = evidence
			} else if !os.IsNotExist(evidenceErr) {
				return fail(evidenceErr)
			}
		}
		switch c.verb {
		case "inspect":
			if manager == nil {
				value = w
			} else {
				value, err = manager.Status(ctx, w.Manifest.WorkspaceID)
			}
		case "paths":
			if manager != nil {
				value, err = manager.Paths(ctx, w.Manifest.WorkspaceID)
			} else {
				paths := map[string]string{}
				for _, repo := range w.Manifest.Repositories {
					path, pathErr := w.RepositoryPath(repo.ID)
					if pathErr != nil {
						return fail(pathErr)
					}
					paths[repo.ID] = path
				}
				value = map[string]any{"workspaceID": w.Manifest.WorkspaceID, "root": w.Root, "stateRoot": w.StateRoot, "repositories": paths}
			}
		case "up":
			ports, portErr := workspacePortPolicy(c, w.Manifest.Ports, manifestPluginIDs(w.Manifest))
			if portErr != nil {
				return fail(portErr)
			}
			if ports != nil {
				edited, editErr := manager.Reconfigure(ctx, w.Manifest.WorkspaceID, devworkspace.EditOptions{Ports: ports})
				if editErr != nil {
					return fail(editErr)
				}
				w = edited.Workspace
			}
			options, optionErr := workspaceLaunchOptions(c, w)
			if optionErr != nil {
				return fail(optionErr)
			}
			value, err = manager.Start(ctx, w.Manifest.WorkspaceID, options, "", diagnostics)
		case "down", "restart":
			wait, cancel := context.WithTimeout(ctx, c.launch.Timeout)
			defer cancel()
			if c.verb == "down" {
				value, err = manager.Down(wait, w.Manifest.WorkspaceID)
			} else {
				value, err = manager.Restart(wait, w.Manifest.WorkspaceID)
			}
		case "supervise":
			err = manager.ServeSupervisor(ctx, w.Manifest.WorkspaceID, diagnostics)
			value = map[string]any{"workspaceID": w.Manifest.WorkspaceID, "stopped": err == nil}
		case "unlink":
			value, err = manager.Unlink(ctx, w.Manifest.WorkspaceID)
		case "link":
			options, optionErr := workspaceLaunchOptions(c, w)
			if optionErr != nil {
				return fail(optionErr)
			}
			value, err = manager.Link(ctx, w.Manifest.WorkspaceID, devworkspace.LinkOptions{Evidence: options.LinkEvidence})
		case "profile":
			if c.stateRoot == "" {
				return fail(devcontract.Fail(2, "usage", "profile requires --state-root"))
			}
			value, err = bindWorkspaceProfile(ctx, manager, w, c.stateRoot)
		case "edit":
			refs, parseErr := workspaceAssignments(c.refs)
			if parseErr != nil {
				return fail(parseErr)
			}
			options := devworkspace.EditOptions{AddRepositories: c.addRepositories, RemoveRepositories: c.removeRepositories, AddPlugins: c.addPlugins, RemovePlugins: c.removePlugins, Refs: refs}
			if c.supplied["name"] {
				options.DisplayName = &c.name
			}
			if c.supplied["slug"] {
				options.Slug = &c.slug
			}
			ports, portErr := workspacePortPolicy(c, w.Manifest.Ports, manifestPluginIDs(w.Manifest))
			if portErr != nil {
				return fail(portErr)
			}
			options.Ports = ports
			value, err = manager.Reconfigure(ctx, w.Manifest.WorkspaceID, options)
		}
	}
	if err != nil {
		return fail(err)
	}
	if c.json || c.verb == "supervise" {
		if err = json.NewEncoder(out).Encode(value); err != nil {
			fmt.Fprintln(diagnostics, "cannot write workspace result")
			return true, 5
		}
	} else {
		printWorkspaceValue(out, value)
	}
	return true, 0
}

func printWorkspaceValue(out io.Writer, value any) {
	if status, ok := value.(devworkspace.Status); ok {
		fmt.Fprintf(out, "%s (%s)\nWorkspace: %s\nState: %s\nStatus: %s\n", status.Manifest.DisplayName, status.Manifest.WorkspaceID, status.Root, status.StateRoot, status.Phase)
		for _, repo := range status.Manifest.Repositories {
			path, _ := status.RepositoryPath(repo.ID)
			fmt.Fprintf(out, "%s: %s\n", repo.ID, path)
		}
		if status.Instance != nil {
			endpoints := status.Instance.Endpoints
			for _, item := range []struct {
				name  string
				value *string
			}{{"Browser", endpoints.Browser}, {"Vite", endpoints.Vite}, {"HMR", endpoints.HMR}, {"Control", endpoints.Control}, {"MCP", endpoints.MCP}} {
				if item.value != nil {
					fmt.Fprintf(out, "%s: %s\n", item.name, *item.value)
				}
			}
		}
		return
	}
	encoder := json.NewEncoder(out)
	encoder.SetIndent("", "  ")
	_ = encoder.Encode(value)
}

func bindWorkspaceProfile(ctx context.Context, manager *devworkspace.Manager, w devworkspace.Workspace, stateRoot string) (devworkspace.Workspace, error) {
	if err := devworkspace.RequireStopped(ctx, w.ResolvedWorkspace); err != nil {
		return w, err
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return w, err
	}
	resolved, err := devcontract.SetCustomProfile(ctx, w.ResolvedWorkspace, stateRoot, home)
	if err != nil {
		return w, err
	}
	w.ResolvedWorkspace = resolved
	return w, nil
}
