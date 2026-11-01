package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
	"time"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devworkspace"
	"github.com/spf13/cobra"
	"github.com/spf13/pflag"
)

const (
	workspaceFollow       = "follow"
	defaultFollowInterval = 30 * time.Second
	workspaceUsageExit    = 2
	workspaceRecover      = "recover"
	workspaceStopped      = "stopped"
	workspaceResetModules = "reset-modules"
	workspaceRefresh      = "refresh"
	workspaceUpdate       = "update"
)

type repeatedWorkspaceFlag []string

func (v *repeatedWorkspaceFlag) String() string         { return strings.Join(*v, ",") }
func (v *repeatedWorkspaceFlag) Set(value string) error { *v = append(*v, value); return nil }
func (v *repeatedWorkspaceFlag) Type() string           { return "string" }

type workspaceCommand struct {
	verb, root, target, explicit, name, slug, stateRoot, linkEvidence                           string
	modulePath, marker                                                                          string
	json, start, deleteState, deleteBranches, apply, check                                      bool
	repositories, plugins, refs, addRepositories, removeRepositories, addPlugins, removePlugins repeatedWorkspaceFlag
	sources, sourceRefs, sourceDirectories                                                      repeatedWorkspaceFlag
	ports                                                                                       repeatedWorkspaceFlag
	upstreams                                                                                   repeatedWorkspaceFlag
	interval                                                                                    time.Duration
	portPolicy                                                                                  string
	launch                                                                                      devworkspace.LaunchOptions
	supplied                                                                                    map[string]bool
}

func addWorkspaceCommands(root *cobra.Command) {
	group := &cobra.Command{Use: "workspace", Short: "Manage development workspaces"}
	for _, verb := range []string{
		"init", "create", "up", "preflight", workspaceRefresh, workspaceUpdate, workspaceFollow, workspaceRecover, "evidence",
		"verify-reload",
		"down", "restart", "edit", "link", "remove", "profile", "inspect", "paths", "list", "collections", "unlink", workspaceResetModules,
		"resume", "rollback", "supervise",
	} {
		group.AddCommand(newWorkspaceCommand(verb, func(cmd *cobra.Command, c workspaceCommand) error {
			_, code := executeWorkspaceCommand(cmd.Context(), c, cmd.OutOrStdout(), cmd.ErrOrStderr())
			return commandExit(code)
		}))
	}
	root.AddCommand(group)
	addRepositoryCommands(root)
}

func newWorkspaceCommand(verb string, execute func(*cobra.Command, workspaceCommand) error) *cobra.Command {
	c := workspaceCommand{verb: verb, supplied: map[string]bool{}}
	cmd := &cobra.Command{Use: verb + " [NAME]", Short: "Workspace " + verb}
	flags := cmd.Flags()
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
	case "up", "preflight":
		launchFlags()
		if c.verb == "preflight" {
			cmd.Short = "Report all launch input prerequisites without installing or starting"
		}
	case workspaceRefresh, workspaceUpdate, workspaceFollow, workspaceRecover:
		if c.verb == workspaceUpdate || c.verb == workspaceFollow {
			flags.Var(&c.repositories, "repo", "selected repository ID to observe or fast-forward (repeatable)")
		}
		if c.verb == workspaceUpdate {
			cmd.Short = "Fetch and safely update configured workspace upstreams"
			cmd.Long = "Fetch selected configured upstream branches and apply one safe cohort " +
				"through the workspace lifecycle. --check only reports the plan and never stops the app " +
				"or changes worktrees. " +
				"Running workspaces return to ready; stopped workspaces remain stopped. " +
				"Omitted launch flags preserve saved options. Pins and tags are skipped; " +
				"no reset, stash, clean, merge or rebase runs automatically."
			flags.BoolVar(&c.check, "check", false, "fetch and report available updates and blockers without applying")
		}
		if c.verb == workspaceFollow {
			cmd.Short = "Observe workspace upstreams in the foreground"
			cmd.Long = "Observe selected configured upstream branches in the foreground. " +
				"--apply explicitly permits safe updates, dependency installation and execution of upstream code " +
				"with your local permissions; this is not a sandbox. Omitted launch flags preserve saved options. " +
				"Stopped workspaces stay stopped. Ctrl-C stops following; an idle app stays running. " +
				"--watch still controls only the local build graph. " +
				"--json streams one diagnostic object per observation."
			flags.DurationVar(&c.interval, "interval", defaultFollowInterval, "upstream observation interval (minimum 5s)")
			flags.BoolVar(&c.apply, "apply", false,
				"explicitly trust selected upstream code and apply safe updates automatically")
		}
		launchFlags()
	case "evidence":
		flags.StringVar(&c.linkEvidence, "link-evidence", "", "successful pinned pnpm probe JSON to retain; omit to inspect saved evidence")
	case "verify-reload":
		flags.StringVar(&c.modulePath, "module", "", "Vite module URL path for edited source")
		flags.StringVar(&c.marker, "marker", "", "unique marker added to source")
	case "down", "restart":
		flags.DurationVar(&c.launch.Timeout, "timeout", 20*time.Minute, "bounded stop/restart wait")
	case "edit":
		flags.BoolVar(&c.apply, "apply", false, "apply edits and refresh; restart only a previously running workspace")
		flags.StringVar(&c.name, "name", "", "new display name")
		flags.StringVar(&c.slug, "slug", "", "new workspace slug")
		flags.Var(&c.addRepositories, "add-repo", "repository ID (repeatable)")
		flags.Var(&c.removeRepositories, "remove-repo", "repository ID (repeatable)")
		flags.Var(&c.addPlugins, "add-plugin", "plugin ID (repeatable)")
		flags.Var(&c.removePlugins, "remove-plugin", "plugin ID (repeatable)")
		flags.Var(&c.refs, "ref", "ID=ref override (repeatable)")
		flags.Var(&c.upstreams, "upstream", "ID=REMOTE/BRANCH update policy (repeatable); does not change the selected ref")
	case "link":
		flags.StringVar(&c.linkEvidence, "link-evidence", "", "actual successful pinned pnpm probe JSON")
	case "remove":
		flags.BoolVar(&c.deleteState, "delete-state", false, "explicitly delete owned stopped profile state")
		flags.BoolVar(&c.deleteBranches, "delete-branches", false, "explicitly delete owned feature branches")
	case "profile":
		flags.StringVar(&c.stateRoot, "state-root", "", "explicit custom state leaf under a new dedicated profile container")
	case workspaceResetModules:
		cmd.Short = "Delete and reinstall owned dependency trees of a stopped workspace"
		cmd.Long = "Explicit recovery for an externally changed dependency tree (for example a stray pnpm install). " +
			"The workspace must be stopped and linked. Every journal-owned node_modules tree and dependency cache " +
			"(TypeScript, Vite loader and Vite optimizer caches) and any node_modules at the selected package roots " +
			"is deleted and reinstalled through the recorded composition installer. Foreign bytes are never adopted; " +
			"distributions, bindings, shims and other outputs are left untouched. During an interrupted unlink or remove " +
			"it only deletes those trees; rerun the interrupted command afterwards."
	case "collections":
		cmd.Short = "List validated collections associated with this Git repository without selecting a profile"
	case "inspect", "paths", "list", "unlink", "resume", "rollback", "supervise":
	}
	cmd.RunE = func(cmd *cobra.Command, positionals []string) error {
		c.supplied = map[string]bool{}
		flags.Visit(func(f *pflag.Flag) { c.supplied[f.Name] = true })
		if err := func() error {
			if len(positionals) > 1 {
				return devcontract.Fail(2, "usage", "at most one workspace target is accepted")
			}
			if len(positionals) == 1 {
				c.target = positionals[0]
			}
			if c.explicit != "" && c.target != "" && c.explicit != c.target {
				return devcontract.Fail(4, "conflicting_target", "workspace arguments disagree")
			}
			if c.explicit != "" {
				c.target = c.explicit
			}
			if (c.verb == "init" || c.verb == "list") && c.target != "" {
				return devcontract.Fail(2, "usage", "this command accepts --root, not a workspace target")
			}
			if c.verb == "collections" && (c.target != "" || c.root != "") {
				return devcontract.Fail(2, "usage", "collections accepts no target or --root; run from a Git checkout, then select a listed root explicitly")
			}
			if c.supplied["timeout"] && c.launch.Timeout <= 0 {
				return devcontract.Fail(2, "usage", "timeout must be positive")
			}
			if c.verb == workspaceFollow && c.interval < 5*time.Second {
				return devcontract.Fail(workspaceUsageExit, "usage", "follow interval must be at least 5s")
			}
			return nil
		}(); err != nil {
			return err
		}
		return execute(cmd, c)
	}
	return cmd
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
	return "", devcontract.Fail(3, "missing_registry", "select --root COLLECTION or run inside an initialized collection; discover known roots with workspace collections from a host checkout")
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
		if c.verb == "up" || c.verb == workspaceRefresh || c.verb == workspaceUpdate ||
			c.verb == workspaceFollow || c.verb == workspaceRecover || c.verb == "preflight" {
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
			if !c.supplied["timeout"] {
				options.Timeout = previous.Timeout
			}
		}
	} else if !os.IsNotExist(err) {
		return options, err
	}
	return workspaceLaunchInputs(c, options)
}

// workspaceLaunchInputs also validates create inputs without reading workspace state.
func workspaceLaunchInputs(c workspaceCommand, options devworkspace.LaunchOptions) (devworkspace.LaunchOptions, error) {
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
		if err := json.Unmarshal(raw, &options.LinkEvidence); err != nil {
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

func executeWorkspaceCommand(ctx context.Context, c workspaceCommand, out, diagnostics io.Writer) (bool, int) {
	var value any
	fail := func(err error) (bool, int) {
		var payload *devcontract.Error
		if !errors.As(err, &payload) {
			payload = devcontract.Fail(5, "operation_failed", err.Error())
		}
		if payload.Exit == 0 {
			payload.Exit = 5
		}
		var plan *devworkspace.UpdatePlan
		if result, ok := value.(devworkspace.RefreshResult); ok {
			plan = result.Plan
		}
		if c.json {
			response := map[string]any{"error": payload}
			if plan != nil {
				response["plan"] = plan
			}
			_ = json.NewEncoder(out).Encode(response)
		} else {
			if plan != nil {
				printWorkspaceUpdatePlan(diagnostics, *plan)
			}
			fmt.Fprintf(diagnostics, "%s: %s\n", payload.Code, payload.Message)
		}
		return true, devcontract.ExitCode(payload)
	}
	var err error
	if c.verb == "collections" {
		directory, cwdErr := os.Getwd()
		if cwdErr != nil {
			return fail(cwdErr)
		}
		value, err = devworkspace.DiscoverCollections(ctx, directory)
	} else if c.verb == "init" {
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
				c.root = root
				options, optionErr := workspaceLaunchInputs(c, c.launch)
				if optionErr != nil {
					return fail(optionErr)
				}
				c.launch = options
				if preflightErr := manager.PreflightCreateLaunch(ctx, devworkspace.CreateOptions{Slug: c.target, DisplayName: c.name, Repositories: c.repositories, Plugins: c.plugins, Refs: refs}, options); preflightErr != nil {
					return fail(preflightErr)
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
	} else if c.verb == "resume" || c.verb == workspaceRecover || c.verb == "rollback" || c.verb == "remove" {
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
		case workspaceRecover:
			var recovered devworkspace.Workspace
			recovered, err = manager.ResumeWorkspace(ctx, target)
			if err != nil {
				return fail(err)
			}
			c.root = root
			refresh, optionErr := workspaceRefreshOptions(c, recovered, diagnostics)
			if optionErr != nil {
				return fail(optionErr)
			}
			value, err = manager.Recover(ctx, recovered.Manifest.WorkspaceID, refresh)
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
		if manager != nil && (c.verb == "up" || c.verb == "link" || c.verb == "preflight") && c.linkEvidence == "" {
			evidence, evidenceErr := manager.LinkEvidence(ctx, w.Manifest.WorkspaceID)
			if evidenceErr == nil {
				c.launch.LinkEvidence = evidence
			} else if !os.IsNotExist(evidenceErr) {
				return fail(evidenceErr)
			}
		}
		switch c.verb {
		case "preflight":
			options, optionErr := workspaceLaunchOptions(c, w)
			report := devworkspace.PreflightLaunch(w, options)
			if optionErr != nil {
				var issue *devcontract.Error
				if !errors.As(optionErr, &issue) {
					return fail(optionErr)
				}
				issues := []*devcontract.Error{issue}
				for _, existing := range report.Issues {
					evidenceError := issue.Code == "link_evidence_required" || issue.Code == "invalid_link_evidence"
					if existing.Code != issue.Code && !(evidenceError && existing.Code == "link_evidence_required") {
						issues = append(issues, existing)
					}
				}
				report.Issues = issues
				report.Ready = false
			}
			if c.json {
				if encodeErr := json.NewEncoder(out).Encode(report); encodeErr != nil {
					return fail(encodeErr)
				}
			} else {
				for _, issue := range report.Issues {
					fmt.Fprintf(out, "%s: %s\n", issue.Code, issue.Message)
				}
				if report.Ready {
					fmt.Fprintln(out, "Launch inputs ready; launch still checks source trust, dependencies and runtime compatibility.")
				}
			}
			if !report.Ready {
				return true, 3
			}
			return true, 0
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
			value = map[string]any{"workspaceID": w.Manifest.WorkspaceID, workspaceStopped: err == nil}
		case "unlink":
			value, err = manager.Unlink(ctx, w.Manifest.WorkspaceID)
		case workspaceResetModules:
			value, err = manager.ResetModules(ctx, w.Manifest.WorkspaceID)
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
		case workspaceRefresh, workspaceUpdate, workspaceFollow:
			refresh, optionErr := workspaceRefreshOptions(c, w, diagnostics)
			if optionErr != nil {
				return fail(optionErr)
			}
			if c.verb == workspaceFollow {
				if c.apply {
					selected := make(map[string]bool, len(c.repositories))
					for _, id := range c.repositories {
						selected[id] = true
					}
					var ids []string
					for _, repo := range w.Manifest.Repositories {
						if len(selected) == 0 || selected[repo.ID] {
							ids = append(ids, repo.ID)
						}
					}
					sort.Strings(ids)
					if _, writeErr := fmt.Fprintf(diagnostics, "Follow apply trusts upstream code from selected repositories: %s. "+
						"Updates may install dependencies and execute code with your local permissions; "+
						"this is not a sandbox.\n", strings.Join(ids, ", ")); writeErr != nil {
						return true, 5
					}
				}
				followContext, cancel := signal.NotifyContext(ctx, os.Interrupt, syscall.SIGTERM)
				defer cancel()
				err = manager.Follow(followContext, w.Manifest.WorkspaceID, devworkspace.FollowOptions{
					UpdateOptions: devworkspace.UpdateOptions{
						RefreshOptions: refresh, Repositories: c.repositories, Check: false,
					},
					Interval: c.interval, Apply: c.apply,
				}, func(status devworkspace.FollowStatus) error {
					if c.json {
						return json.NewEncoder(out).Encode(status)
					}
					delivery := &outputDelivery{writer: out}
					printWorkspaceFollow(delivery, status)
					return delivery.err
				})
				if err != nil && (followContext.Err() == nil || !errors.Is(err, context.Canceled)) {
					return fail(err)
				}
				return true, 0
			}
			if c.verb == workspaceUpdate {
				value, err = manager.Update(ctx, w.Manifest.WorkspaceID, devworkspace.UpdateOptions{
					RefreshOptions: refresh, Repositories: c.repositories, Check: c.check,
				})
			} else {
				value, err = manager.Refresh(ctx, w.Manifest.WorkspaceID, refresh)
			}
		case "verify-reload":
			if c.modulePath == "" || c.marker == "" {
				return fail(devcontract.Fail(2, "usage", "verify-reload requires --module and --marker"))
			}
			value, err = manager.VerifySourceReload(ctx, w.Manifest.WorkspaceID, c.modulePath, c.marker)
		case "evidence":
			if c.linkEvidence == "" {
				value, err = manager.ProtocolEvidence(ctx, w.Manifest.WorkspaceID)
			} else {
				options, optionErr := workspaceLaunchOptions(c, w)
				if optionErr != nil {
					return fail(optionErr)
				}
				value, err = manager.Link(ctx, w.Manifest.WorkspaceID, devworkspace.LinkOptions{Evidence: options.LinkEvidence})
			}
		case "edit":
			refs, parseErr := workspaceAssignments(c.refs)
			if parseErr != nil {
				return fail(parseErr)
			}
			upstreams, parseErr := workspaceAssignments(c.upstreams)
			if parseErr != nil {
				return fail(parseErr)
			}
			options := devworkspace.EditOptions{
				DisplayName: nil, Slug: nil, PreserveSelection: false, Ports: nil,
				AddRepositories: c.addRepositories, RemoveRepositories: c.removeRepositories,
				AddPlugins: c.addPlugins, RemovePlugins: c.removePlugins, Refs: refs, Upstreams: upstreams,
			}
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
			var refresh devworkspace.RefreshOptions
			refresh.Diagnostics = diagnostics
			if c.apply {
				if preflightErr := manager.PreflightEdit(ctx, w.Manifest.WorkspaceID, options); preflightErr != nil {
					return fail(preflightErr)
				}
				// Capture authenticated liveness before Down intentionally stops it.
				status, statusErr := manager.Status(ctx, w.Manifest.WorkspaceID)
				if statusErr != nil {
					return fail(statusErr)
				}
				refresh.Restart = workspaceWasRunning(status)
				if _, stopErr := manager.Down(ctx, w.Manifest.WorkspaceID); stopErr != nil {
					return fail(stopErr)
				}
			}
			selectionEdit := false
			for _, flag := range []string{
				"name", "slug", "add-repo", "remove-repo", "add-plugin", "remove-plugin", "ref", "port-policy", "port",
			} {
				selectionEdit = selectionEdit || c.supplied[flag]
			}
			if len(upstreams) > 0 && !selectionEdit {
				value, err = manager.ConfigureUpstreams(ctx, w.Manifest.WorkspaceID, upstreams)
			} else {
				value, err = manager.Reconfigure(ctx, w.Manifest.WorkspaceID, options)
			}
			if err == nil && c.apply {
				value, err = manager.Refresh(ctx, w.Manifest.WorkspaceID, refresh)
			}
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
	switch result := value.(type) {
	case devworkspace.RefreshResult:
		if result.Plan != nil {
			printWorkspaceUpdatePlan(out, *result.Plan)
		}
		if result.Phase != "" {
			fmt.Fprintf(out, "Refresh: %s\n", result.Phase)
		}
		if result.BackupDirectory != "" {
			fmt.Fprintf(out, "Recovery evidence: %s\n", result.BackupDirectory)
		}
		if result.Status.Manifest.WorkspaceID != "" {
			printWorkspaceValue(out, result.Status)
		}
		return
	case devworkspace.UpdatePlan:
		printWorkspaceUpdatePlan(out, result)
		return
	case devworkspace.ResetModulesReport:
		fmt.Fprintf(out, "Reset modules: %s\n", result.WorkspaceID)
		for _, path := range result.Removed {
			fmt.Fprintf(out, "Removed: %s\n", path)
		}
		if result.Reinstalled {
			fmt.Fprintln(out, "Reinstalled: dependency trees recorded by the composition installer")
		} else {
			fmt.Fprintln(out, "Not reinstalled: the dependency unlink was interrupted (phase "+result.Phase+"); "+
				"rerun the interrupted `workspace unlink` or `workspace remove`")
		}
		return
	case devworkspace.Registry:
		for _, repository := range result.Repositories {
			fmt.Fprintf(out, "%s: %s (ref=%s directory=%s)\n", repository.ID, repository.CommonDir, repository.DefaultRef, repository.Directory)
		}
		return
	}
	if status, ok := value.(devworkspace.Status); ok {
		fmt.Fprintf(out, "%s (%s)\nWorkspace: %s\nState: %s\nStatus: %s\n", status.Manifest.DisplayName, status.Manifest.WorkspaceID, status.Root, status.StateRoot, status.Phase)
		fmt.Fprintf(out, "Health: process=%s build=%s dependencies=%s source=%s readiness=%s hmr=%s reload=%s\n", status.Health.Liveness, status.Health.Build, status.Health.Dependencies, status.Health.ServedSource, status.Health.Readiness, status.Health.HMR, status.Health.SourceReload)
		if status.FailedStage != "" {
			fmt.Fprintf(out, "Failed stage: %s\n", status.FailedStage)
		}
		if status.RecoveryCommand != "" {
			fmt.Fprintf(out, "Recovery: %s\n", status.RecoveryCommand)
		}
		for _, repo := range status.Manifest.Repositories {
			path, _ := status.RepositoryPath(repo.ID)
			fmt.Fprintf(out, "%s: %s\n", repo.ID, path)
			if checkout, exists := status.Checkouts[repo.ID]; exists {
				fmt.Fprintf(out, "  Checkout: %s branch=%s dirty=%t digest=%s\n", checkout.Commit, checkout.Branch, checkout.Dirty, checkout.SourceDigest)
				if checkout.Error != "" {
					fmt.Fprintf(out, "  Checkout error: %s\n", checkout.Error)
				}
			}
			if served, exists := status.ServedCheckouts[repo.ID]; exists {
				fmt.Fprintf(out, "  Served: %s dirty=%t digest=%s\n", served.Commit, served.Dirty, served.SourceDigest)
			}
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

func printWorkspaceUpdatePlan(out io.Writer, plan devworkspace.UpdatePlan) {
	fmt.Fprintf(out, "Update: %s\n", plan.Result)
	if plan.OperationID != "" {
		fmt.Fprintf(out, "Operation: %s\n", plan.OperationID)
	}
	fmt.Fprintf(out, "Dependencies changed: %t\n", plan.DependencyChanged)
	for _, repo := range plan.Repositories {
		fmt.Fprintf(out, "%s: %s selection=%s upstream=%s/%s\n",
			repo.ID, repo.Classification, repo.SelectionKind, repo.Remote, repo.Branch)
		fmt.Fprintf(out, "  Old: %s\n  Target: %s\n  Actual HEAD: %s\n", repo.OldSHA, repo.TargetSHA, repo.ActualHEAD)
		if repo.TreesEqual {
			fmt.Fprintln(out, "  Committed trees match. Tree equality does not authorize replacing history.")
		}
		if repo.Classification == "divergent" {
			fmt.Fprintln(out, "  History diverged. Align explicitly or merge manually; no history was replaced automatically.")
		}
		if repo.BlockedReason != "" {
			fmt.Fprintf(out, "  Blocked: %s\n", repo.BlockedReason)
		}
		for _, path := range repo.BlockerPaths {
			fmt.Fprintf(out, "  Blocker path: %s\n", path)
		}
	}
	if plan.NextCommand != "" {
		fmt.Fprintf(out, "Next: %s\n", plan.NextCommand)
	}
}

func printWorkspaceFollow(out io.Writer, status devworkspace.FollowStatus) {
	fmt.Fprintf(out, "Follow: %s enabled=%t apply=%t workspace=%s\n",
		status.Result, status.Enabled, status.Apply, status.WorkspaceID)
	if status.Owner != "" {
		fmt.Fprintf(out, "Owner: %s\n", status.Owner)
	}
	if !status.LastObservation.IsZero() {
		fmt.Fprintf(out, "Last observation: %s\n", status.LastObservation.Format(time.RFC3339))
	}
	if status.ActiveOperation != "" {
		fmt.Fprintf(out, "Active operation: %s\n", status.ActiveOperation)
	}
	if status.PendingCohort != "" {
		fmt.Fprintf(out, "Pending cohort: %s\n", status.PendingCohort)
	}
	if status.Plan != nil {
		printWorkspaceUpdatePlan(out, *status.Plan)
	}
	if status.BlockedReason != "" {
		fmt.Fprintf(out, "Blocked: %s\n", status.BlockedReason)
	}
	if status.Error != "" {
		fmt.Fprintf(out, "Observation error: %s\n", status.Error)
	}
	if !status.NextAttempt.IsZero() {
		fmt.Fprintf(out, "Next observation: %s\n", status.NextAttempt.Format(time.RFC3339))
	}
	if status.NextCommand != "" {
		fmt.Fprintf(out, "Next: %s\n", status.NextCommand)
	}
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

func workspaceRefreshOptions(c workspaceCommand, w devworkspace.Workspace, diagnostics io.Writer) (devworkspace.RefreshOptions, error) {
	refresh := devworkspace.RefreshOptions{Diagnostics: diagnostics}
	for _, name := range []string{"mode", "mcp", "watch", "live-frontend", "reviewed-sdk-revision", "allow-isolation-source-changes", "link-evidence", "seed-from", "seed-version", "timeout"} {
		if !c.supplied[name] {
			continue
		}
		launch, err := workspaceLaunchOptions(c, w)
		if err != nil {
			return refresh, err
		}
		refresh.Evidence = launch.LinkEvidence
		refresh.Launch = &launch
		break
	}
	return refresh, nil
}

func workspaceWasRunning(status devworkspace.Status) bool {
	return status.Generation != "" && status.Phase != workspaceStopped && status.Phase != "crashed"
}
