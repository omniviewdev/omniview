// Package instance resolves runtime identity before application state is opened.
package instance

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/omniviewdev/omniview/internal/appstate"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"
)

// buildChannel is independent of optimization tags and version.Development.
// Release builders may set it to stable, nightly or local with -X.
var buildChannel string

// Options are resolved without creating files, opening settings, or starting services.
// StateRoot is an explicit selection, never an implicit production default.
type Options struct {
	CWD                 string
	Workspace           string
	EnvironmentManifest string
	StateRoot           string
	Home                string
	Channel             string
	Version             string
	Commit              string
	Generation          string
}

// Profile is the resolved startup snapshot. Callers must not mutate Descriptor.
type Profile struct {
	Descriptor  devcontract.InstanceDescriptor
	Workspace   *devcontract.ResolvedWorkspace
	RuntimeRoot string
	WebviewRoot string
	home        string
}

// ResolveEnvironment selects the host profile without relying on build optimization
// or telemetry's Development flag. A source/local build requires a workspace.
func ResolveEnvironment(version, commit string) (Profile, error) {
	root, err := appstate.SelectedRoot()
	if err != nil {
		return Profile{}, err
	}
	channel := buildChannel
	if env := os.Getenv("OMNIVIEW_CHANNEL"); env != "" {
		if channel != "" && channel != env {
			return Profile{}, fmt.Errorf("instance: environment channel disagrees with build channel")
		}
		channel = env
	}
	if channel == "" {
		switch {
		case strings.Contains(strings.ToLower(version), "nightly") || filepath.Base(root) == ".omniview-nightly":
			channel = "nightly"
		case strings.HasSuffix(version, "-dev"):
			channel = "local"
		default:
			channel = "stable"
		}
		// Explicit workspace selection is authoritative, including optimized builds.
		if os.Getenv(devcontract.WorkspaceEnvironment) != "" {
			channel = "local"
		}
	}
	return Resolve(Options{EnvironmentManifest: os.Getenv(devcontract.WorkspaceEnvironment), StateRoot: root, Channel: channel, Version: version, Commit: commit, Generation: os.Getenv("OMNIVIEW_GENERATION")})
}

func Resolve(opts Options) (Profile, error) {
	var profile Profile
	home := opts.Home
	if home == "" {
		var err error
		home, err = os.UserHomeDir()
		if err != nil {
			return profile, err
		}
	}
	profile.home = home
	channel := opts.Channel
	if channel == "" {
		channel = "local"
	}
	if channel != "local" && channel != "stable" && channel != "nightly" {
		return profile, fmt.Errorf("instance: unknown channel %q", channel)
	}
	generation := opts.Generation
	if generation == "" {
		generation = uuid.NewString()
	} else if err := canonicalUUID(generation); err != nil {
		return profile, fmt.Errorf("instance: invalid generation: %w", err)
	}
	workspace, err := devcontract.ResolveWorkspace(devcontract.ResolveOptions{CWD: opts.CWD, Explicit: opts.Workspace, EnvironmentManifest: opts.EnvironmentManifest, StateRoot: opts.StateRoot, Home: home})
	if err == nil {
		if channel != "local" {
			return profile, fmt.Errorf("instance: workspace requires local channel, not %s", channel)
		}
		profile.Workspace = &workspace
		profiles, e := devcontract.CanonicalPath(filepath.Join(home, ".omniview-dev", "profiles"))
		if e != nil {
			return Profile{}, e
		}
		boundary := filepath.Join(profiles, workspace.Manifest.WorkspaceID)
		// State ownership (default or explicit custom binding) is authoritative in
		// the common resolver; transient paths always remain UUID-owned here.
		profile.RuntimeRoot = filepath.Join(boundary, "runtime")
		profile.WebviewRoot = filepath.Join(boundary, "webview")
		profile.Descriptor = devcontract.InstanceDescriptor{SchemaVersion: devcontract.SchemaVersion, WorkspaceID: workspace.Manifest.WorkspaceID, InstanceID: workspace.Manifest.WorkspaceID, Generation: generation, Kind: "development", Channel: "local", DisplayName: workspace.Manifest.DisplayName, StateRoot: workspace.StateRoot}
		for _, repo := range workspace.Manifest.Repositories {
			path, e := workspace.RepositoryPath(repo.ID)
			if e != nil {
				return Profile{}, e
			}
			profile.Descriptor.Repositories = append(profile.Descriptor.Repositories, devcontract.RepositoryResolution{ID: repo.ID, Path: path, Ref: repo.BaseRef, Commit: repo.BaseCommit})
		}
	} else {
		var contractErr *devcontract.Error
		if !errors.As(err, &contractErr) || contractErr.Code != "missing_workspace" || channel == "local" || opts.Workspace != "" || opts.EnvironmentManifest != "" {
			return profile, err
		}
		root := opts.StateRoot
		if root == "" {
			name := ".omniview"
			if channel == "nightly" {
				name = ".omniview-nightly"
			}
			root = filepath.Join(home, name)
		}
		root, err = appstate.ValidateRoot(root)
		if err != nil {
			return profile, err
		}
		if err := validateProductionDefaultNamespaces(root, home, channel); err != nil {
			return profile, err
		}
		for _, protected := range []string{filepath.Join(home, ".omniview-dev", "profiles")} {
			canonical, e := devcontract.CanonicalPath(protected)
			if e != nil {
				return profile, e
			}
			overlap, e := devcontract.ProfilePathsOverlap(root, canonical)
			if e != nil {
				return profile, e
			}
			if overlap {
				return profile, fmt.Errorf("instance: production state overlaps development profiles")
			}
		}
		if err := devcontract.ValidateProductionProfileIsolation(root, home); err != nil {
			return profile, err
		}
		other := ".omniview-nightly"
		if channel == "nightly" {
			other = ".omniview"
		}
		protected, e := devcontract.CanonicalPath(filepath.Join(home, other))
		if e != nil {
			return profile, e
		}
		overlap, e := devcontract.ProfilePathsOverlap(root, protected)
		if e != nil {
			return profile, e
		}
		if overlap {
			return profile, fmt.Errorf("instance: %s state overlaps another production channel", channel)
		}
		name := "Omniview"
		if channel == "nightly" {
			name = "Omniview Nightly"
		}
		profile.RuntimeRoot = filepath.Join(root, "runtime")
		profile.Descriptor = devcontract.InstanceDescriptor{SchemaVersion: devcontract.SchemaVersion, InstanceID: channel, Generation: generation, Kind: "production", Channel: channel, DisplayName: name, StateRoot: root}
	}
	if err := validateRuntimePaths(profile.runtimePaths()); err != nil {
		return Profile{}, err
	}
	d := &profile.Descriptor
	d.Version = opts.Version
	d.Commit = opts.Commit
	d.Readiness = "starting"
	d.StartedAt = time.Now().UTC()
	executable, _ := os.Executable()
	d.Process = devcontract.ProcessIdentity{PID: os.Getpid(), Executable: executable, WorkspaceID: d.WorkspaceID, Generation: generation, Role: "host"}
	return profile, nil
}

func canonicalUUID(value string) error {
	parsed, err := uuid.Parse(value)
	if err != nil || parsed == uuid.Nil || parsed.String() != value {
		return fmt.Errorf("expected canonical nonzero UUID")
	}
	return nil
}

func contained(root, path string) bool {
	rel, err := filepath.Rel(root, path)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && !filepath.IsAbs(rel)
}

// Production overrides reserve ASCII case variants of the other channel's
// default label and .omniview-dev/profiles beneath this HOME, even before those
// directories exist. This is a product namespace rule, not filesystem case
// detection: arbitrary custom paths retain physical, case-sensitive identity.
func validateProductionDefaultNamespaces(root, home, channel string) error {
	home, err := devcontract.CanonicalPath(home)
	if err != nil {
		return err
	}
	homeInfo, err := os.Stat(home)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	for ancestor := root; ; ancestor = filepath.Dir(ancestor) {
		isHome := ancestor == home
		if !isHome && homeInfo != nil {
			info, err := os.Stat(ancestor)
			if err != nil && !os.IsNotExist(err) {
				return err
			}
			isHome = info != nil && os.SameFile(info, homeInfo)
		}
		if isHome {
			relative, err := filepath.Rel(ancestor, root)
			if err != nil {
				return err
			}
			label, tail, nested := strings.Cut(relative, string(filepath.Separator))
			other := ".omniview-nightly"
			if channel == "nightly" {
				other = ".omniview"
			}
			if sameASCIIProfileLabel(label, other) {
				return fmt.Errorf("instance: %s state overlaps another production channel's reserved namespace", channel)
			}
			if sameASCIIProfileLabel(label, ".omniview-dev") {
				child, _, _ := strings.Cut(tail, string(filepath.Separator))
				if !nested || sameASCIIProfileLabel(child, "profiles") {
					return fmt.Errorf("instance: production state overlaps reserved development profiles")
				}
			}
			return nil
		}
		if filepath.Dir(ancestor) == ancestor {
			return nil
		}
	}
}

func sameASCIIProfileLabel(value, lowerLabel string) bool {
	if len(value) != len(lowerLabel) {
		return false
	}
	for i := range len(value) {
		char := value[i]
		if char >= 'A' && char <= 'Z' {
			char += 'a' - 'A'
		}
		if char != lowerLabel[i] {
			return false
		}
	}
	return true
}

// ChildEnvironment replaces inherited ownership values, including for a root
// selected programmatically or by ldflags. It never replaces HOME/credentials.
func (p Profile) ChildEnvironment(base []string, pluginID string) ([]string, error) {
	// Native host XDG roots must never escape into plugin or source-tool execs.
	base, err := RestoreNativeChildEnvironment(base)
	if err != nil {
		return nil, err
	}
	values := []string{"GOWORK=off", "OMNIVIEW_STATE_DIR=" + p.Descriptor.StateRoot, "OMNIVIEW_INSTANCE_ID=" + p.Descriptor.InstanceID, "OMNIVIEW_GENERATION=" + p.Descriptor.Generation, "OMNIVIEW_WORKSPACE_ID=" + p.Descriptor.WorkspaceID, "OMNIVIEW_PLUGIN_ID=" + pluginID}
	if p.Workspace != nil {
		values = append(values, devcontract.WorkspaceEnvironment+"="+p.Workspace.ManifestPath)
	}
	keys := map[string]bool{devcontract.WorkspaceEnvironment: true, "GOWORK": true, "OMNIVIEW_STATE_DIR": true, "OMNIVIEW_INSTANCE_ID": true, "OMNIVIEW_GENERATION": true, "OMNIVIEW_WORKSPACE_ID": true, "OMNIVIEW_PLUGIN_ID": true, "PLUGIN_UNIX_SOCKET_DIR": true, "PLUGIN_UNIX_SOCKET_GROUP": true}
	env := make([]string, 0, len(base)+len(values))
	for _, entry := range base {
		key, _, _ := strings.Cut(entry, "=")
		if pluginID != "" && (strings.HasPrefix(key, "OMNIVIEW_PROCESS_BRIDGE_") || strings.HasPrefix(key, "OMNIVIEW_SUPERVISOR_") || key == "OMNIVIEW_PLUGIN_PNPM_COMMANDS" || key == "OMNIVIEW_P02_METRICS_SOCKET") {
			continue
		}
		if !keys[key] {
			env = append(env, entry)
		}
	}
	return append(env, values...), nil
}

// PrepareRuntime creates only instance-owned transient directories. Call after
// native preflight and root/channel guards, never during profile resolution.
func (p Profile) PrepareRuntime() error {
	if p.Descriptor.Kind == "development" {
		if err := devcontract.ValidateDefaultProfileOwnership(p.home, p.Descriptor.WorkspaceID); err != nil {
			return err
		}
	}
	paths := p.runtimePaths()
	// Validate every configured native child before creating any directory.
	// In particular Linux data/cache must not alias another profile even when
	// the webview parent itself is a normal owned directory.
	if err := validateRuntimePaths(paths); err != nil {
		return err
	}
	for _, path := range paths {
		if err := os.MkdirAll(path, 0700); err != nil {
			return err
		}
		if err := os.Chmod(path, 0700); err != nil {
			return err
		}
	}
	if p.Descriptor.Kind == "development" {
		for key, value := range map[string]string{"TMPDIR": filepath.Join(p.RuntimeRoot, "tmp"), "TMP": filepath.Join(p.RuntimeRoot, "tmp"), "TEMP": filepath.Join(p.RuntimeRoot, "tmp"), "OMNIVIEW_STARTUP_REPORT": filepath.Join(p.RuntimeRoot, "startup-report.json")} {
			if err := os.Setenv(key, value); err != nil {
				return err
			}
		}
	}
	return nil
}

func (p Profile) runtimePaths() []string {
	paths := []string{p.RuntimeRoot, filepath.Join(p.RuntimeRoot, "tmp")}
	if p.WebviewRoot != "" {
		paths = append(paths, p.WebviewRoot, filepath.Join(p.WebviewRoot, "data"), filepath.Join(p.WebviewRoot, "cache"))
	}
	return paths
}

func validateRuntimePaths(paths []string) error {
	for _, path := range paths {
		if !filepath.IsAbs(path) {
			return fmt.Errorf("instance: runtime path must be absolute")
		}
		canonical, err := devcontract.CanonicalPath(path)
		if err != nil {
			return err
		}
		if canonical != path {
			return fmt.Errorf("instance: runtime/native storage path must not be a symlink alias")
		}
		info, err := os.Stat(path)
		if err != nil && !os.IsNotExist(err) {
			return err
		}
		if err == nil && !info.IsDir() {
			return fmt.Errorf("instance: runtime/native storage path must be a directory")
		}
	}
	return nil
}

// Snapshot returns a detached safe descriptor; no token or internal provenance
// path is part of the public instance contract.
func Snapshot(d devcontract.InstanceDescriptor) devcontract.InstanceDescriptor {
	d.Repositories = append([]devcontract.RepositoryResolution(nil), d.Repositories...)
	d.Plugins = append([]devcontract.PluginState(nil), d.Plugins...)
	// Error detail maps are intentionally omitted from the public snapshot; they
	// can contain provider-specific operational details not safe for discovery.
	if d.LastError != nil {
		d.LastError = &devcontract.Error{Code: d.LastError.Code, Message: d.LastError.Message}
	}
	for i := range d.Plugins {
		if e := d.Plugins[i].LastError; e != nil {
			d.Plugins[i].LastError = &devcontract.Error{Code: e.Code, Message: e.Message}
		}
	}
	copyString := func(p *string) *string {
		if p == nil {
			return nil
		}
		v := *p
		return &v
	}
	d.Endpoints = devcontract.Endpoints{Browser: copyString(d.Endpoints.Browser), Vite: copyString(d.Endpoints.Vite), HMR: copyString(d.Endpoints.HMR), MCP: copyString(d.Endpoints.MCP), Control: copyString(d.Endpoints.Control), Health: copyString(d.Endpoints.Health)}
	return d
}

// PluginEnvironment derives process ownership from the injected state service,
// not an inherited state-root variable. This also supports non-main embedders.
func PluginEnvironment(stateRoot, pluginID string, base []string) ([]string, error) {
	base, err := RestoreNativeChildEnvironment(base)
	if err != nil {
		return nil, err
	}
	root, err := appstate.ValidateRoot(stateRoot)
	if err != nil {
		return nil, err
	}
	values := make(map[string]string)
	for _, entry := range base {
		key, value, ok := strings.Cut(entry, "=")
		if ok {
			values[key] = value
		}
	}
	generation := values["OMNIVIEW_GENERATION"]
	if generation == "" {
		generation = uuid.NewString()
	}
	if err := canonicalUUID(generation); err != nil {
		return nil, err
	}
	profile := Profile{Descriptor: devcontract.InstanceDescriptor{StateRoot: root, InstanceID: values["OMNIVIEW_INSTANCE_ID"], Generation: generation, WorkspaceID: values["OMNIVIEW_WORKSPACE_ID"]}}
	if manifest := values[devcontract.WorkspaceEnvironment]; manifest != "" {
		workspace, err := devcontract.ResolveWorkspace(devcontract.ResolveOptions{EnvironmentManifest: manifest, StateRoot: root})
		if err != nil {
			return nil, err
		}
		profile.Workspace = &workspace
		profile.Descriptor.InstanceID = workspace.Manifest.WorkspaceID
		profile.Descriptor.WorkspaceID = workspace.Manifest.WorkspaceID
	}
	env, err := profile.ChildEnvironment(base, pluginID)
	if err != nil {
		return nil, err
	}
	// Only an actual managed host carries both process-bridge selections.
	// Production and directly launched development hosts do not acquire a
	// dependency on supervisor-owned transport records.
	if profile.Workspace != nil && pluginID != "" && values["OMNIVIEW_PROCESS_BRIDGE_ENDPOINT"] != "" && values["OMNIVIEW_PROCESS_BRIDGE_TOKEN_FILE"] != "" {
		managed, err := Resolve(Options{EnvironmentManifest: profile.Workspace.ManifestPath, StateRoot: root, Generation: generation})
		if err != nil {
			return nil, err
		}
		socketRoot, err := devsession.ReadUnixSocketDirectory(managed.RuntimeRoot, managed.Descriptor.WorkspaceID, generation, managed.Workspace.Root)
		if err != nil {
			return nil, fmt.Errorf("instance: managed plugin Unix socket ownership: %w", err)
		}
		if socketRoot != "" {
			env = append(env, "PLUGIN_UNIX_SOCKET_DIR="+socketRoot)
		}
	}
	return env, nil
}
