package devworkspace

import (
	"context"
	"encoding/json"
	"maps"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/google/uuid"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"gopkg.in/yaml.v3"
)

type Options struct {
	Home string
	// Stopped is an additional process/session guard supplied by the orchestrator.
	// The canonical state-root flock is always held independently of this guard.
	Stopped func(context.Context, devcontract.ResolvedWorkspace) error
}

type Manager struct {
	Root    string
	options Options
}

type Workspace struct {
	devcontract.ResolvedWorkspace
	Phase string `json:"phase"`
}

type WorkspacePaths struct {
	WorkspaceID  string            `json:"workspaceID"`
	Root         string            `json:"root"`
	ManifestPath string            `json:"manifestPath"`
	LocalRoot    string            `json:"localRoot"`
	StateRoot    string            `json:"stateRoot"`
	RuntimeRoot  string            `json:"runtimeRoot"`
	WebviewRoot  string            `json:"webviewRoot"`
	Repositories map[string]string `json:"repositories"`
}

type CreateOptions struct {
	Slug         string
	DisplayName  string
	Repositories []string
	Plugins      []string
	Refs         map[string]string
	Baseline     *string
	Ports        *devcontract.PortPolicy
	workspaceID  string
	// pinnedCommits preserves existing resource metadata during selection edits.
	// Unlike Refs, entries need not remain selected in the resulting manifest.
	pinnedCommits map[string]string
}

type EditOptions struct {
	DisplayName        *string
	AddRepositories    []string
	RemoveRepositories []string
	AddPlugins         []string
	RemovePlugins      []string
	Slug               *string
	Refs               map[string]string
	Ports              *devcontract.PortPolicy
}

func Open(root string, opts Options) (*Manager, error) {
	if root == "" {
		return nil, devcontract.Fail(2, "missing_root", "repository root is required")
	}
	canonical, err := devcontract.CanonicalPath(root)
	if err != nil {
		return nil, err
	}
	if _, err = LoadRegistry(canonical); err != nil {
		return nil, err
	}
	if opts.Home == "" {
		opts.Home, err = os.UserHomeDir()
	}
	if err != nil {
		return nil, err
	}
	opts.Home, err = devcontract.CanonicalPath(opts.Home)
	if err != nil {
		return nil, err
	}
	return &Manager{Root: canonical, options: opts}, nil
}

func writeManifest(root string, m devcontract.WorkspaceManifest) error {
	if err := m.Validate(); err != nil {
		return err
	}
	return atomicOwnedJSON(filepath.Join(root, "workspace.json"), m, m.WorkspaceID)
}

func readManifest(root string) (devcontract.WorkspaceManifest, error) {
	var m devcontract.WorkspaceManifest
	data, err := os.ReadFile(filepath.Join(root, "workspace.json"))
	if err != nil {
		return m, devcontract.Fail(3, "missing_workspace", "workspace manifest is missing")
	}
	if err = json.Unmarshal(data, &m); err != nil {
		return m, devcontract.Fail(2, "invalid_manifest", "invalid workspace JSON")
	}
	return m, m.Validate()
}

func sameManifest(a, b devcontract.WorkspaceManifest) bool {
	x, _ := json.Marshal(a)
	y, _ := json.Marshal(b)
	return string(x) == string(y)
}

func (m *Manager) plan(ctx context.Context, reg Registry, opts CreateOptions) (devcontract.WorkspaceManifest, error) {
	id := opts.workspaceID
	if id == "" {
		id = uuid.NewString()
	}
	display := opts.DisplayName
	if display == "" {
		display = opts.Slug
	}
	manifest := devcontract.WorkspaceManifest{SchemaVersion: 1, WorkspaceID: id, Slug: opts.Slug, DisplayName: display, Repositories: []devcontract.Repository{}, Plugins: []devcontract.Plugin{}, Links: devcontract.Links{HostPackages: true}, Profile: devcontract.Profile{Kind: "development", Baseline: opts.Baseline}, Ports: devcontract.PortPolicy{Policy: "sticky", Overrides: map[string]int{}}}
	if opts.Ports != nil {
		manifest.Ports = copyWorkspacePortPolicy(*opts.Ports)
	}
	selected := map[string]bool{"omniview": true}
	for _, name := range opts.Repositories {
		if selected[name] && name != "omniview" {
			return manifest, devcontract.Fail(2, "duplicate_selection", "repository selected more than once")
		}
		selected[name] = true
	}
	plugins := map[string]bool{}
	for _, id := range opts.Plugins {
		if !safeID(id) || plugins[id] {
			return manifest, devcontract.Fail(2, "invalid_plugin", "plugin IDs must be safe and unique")
		}
		plugins[id] = true
	}
	sources := map[string]Source{}
	commits := map[string]string{}
	pluginSources := map[string]string{}
	selections := map[string]string{}
	for _, s := range reg.Repositories {
		sources[s.ID] = s
		ref := s.DefaultRef
		if r, ok := opts.Refs[s.ID]; ok {
			ref = r
		}
		selection := ref
		if pinned := opts.pinnedCommits[s.ID]; pinned != "" {
			if _, explicit := opts.Refs[s.ID]; !explicit {
				selection = pinned
			}
		}
		selections[s.ID] = selection
		if !selected[s.ID] && len(plugins) == 0 {
			continue
		}
		resolve := resolveSelectedCommit
		if !selected[s.ID] {
			// Discovery must not contact unrelated remotes.
			resolve = resolveCommit
		}
		commit, err := resolve(ctx, s.CommonDir, selection)
		if err != nil {
			return manifest, err
		}
		commits[s.ID] = commit
		if len(plugins) == 0 {
			continue
		}
		// Read committed metadata at the selected ref, never an unrelated dirty
		// source checkout or a directory name inferred from a URL.
		raw, err := git(ctx, s.CommonDir, "", "show", commit+":plugin.yaml")
		if err != nil {
			if ctx.Err() != nil {
				return manifest, ctx.Err()
			}
			continue
		}
		var meta struct {
			ID string `yaml:"id"`
		}
		if yaml.Unmarshal([]byte(raw), &meta) != nil || !safeID(meta.ID) {
			return manifest, devcontract.Fail(2, "invalid_plugin_metadata", "registered plugin has invalid committed plugin.yaml identity")
		}
		if previous, ok := pluginSources[meta.ID]; ok && previous != s.ID {
			return manifest, devcontract.Fail(3, "ambiguous_plugin", "plugin ID belongs to multiple registered sources")
		}
		pluginSources[meta.ID] = s.ID
	}
	pluginIDs := make([]string, 0, len(plugins))
	for id := range plugins {
		pluginIDs = append(pluginIDs, id)
	}
	sort.Strings(pluginIDs)
	for _, id := range pluginIDs {
		repositoryID, ok := pluginSources[id]
		if !ok {
			return manifest, devcontract.Fail(3, "missing_plugin", "plugin ID is not present in registered source metadata")
		}
		if !selected[repositoryID] {
			source := sources[repositoryID]
			commit, err := resolveSelectedCommit(ctx, source.CommonDir, selections[repositoryID])
			if err != nil {
				return manifest, err
			}
			raw, err := git(ctx, source.CommonDir, "", "show", commit+":plugin.yaml")
			if err != nil {
				if ctx.Err() != nil {
					return manifest, ctx.Err()
				}
				return manifest, devcontract.Fail(3, "missing_plugin", "selected source no longer contains committed plugin metadata")
			}
			var meta struct {
				ID string `yaml:"id"`
			}
			if yaml.Unmarshal([]byte(raw), &meta) != nil || meta.ID != id {
				return manifest, devcontract.Fail(2, "invalid_plugin_metadata", "selected source changed committed plugin identity")
			}
			commits[repositoryID] = commit
		}
		selected[repositoryID] = true
		manifest.Plugins = append(manifest.Plugins, devcontract.Plugin{ID: id, RepositoryID: repositoryID, Mode: "managed"})
	}
	for name := range selected {
		if _, ok := sources[name]; !ok {
			return manifest, devcontract.Fail(3, "missing_repository", "selected repository is not registered")
		}
	}
	for name := range opts.Refs {
		if !selected[name] {
			return manifest, devcontract.Fail(2, "unselected_ref", "ref override must target a selected repository")
		}
	}
	for _, s := range reg.Repositories {
		if !selected[s.ID] {
			continue
		}
		ref := s.DefaultRef
		if r, ok := opts.Refs[s.ID]; ok {
			ref = r
		}
		manifest.Repositories = append(manifest.Repositories, devcontract.Repository{ID: s.ID, Directory: s.Directory, BaseRef: ref, BaseCommit: commits[s.ID], Branch: "feature/" + opts.Slug + "-" + id[:8]})
		if s.ID == "ui" {
			v := s.ID
			manifest.Links.UIRepositoryID = &v
		}
		if s.ID == "plugin-sdk" {
			v := s.ID
			manifest.Links.SDKRepositoryID = &v
		}
	}
	return manifest, manifest.Validate()
}

func copyWorkspacePortPolicy(policy devcontract.PortPolicy) devcontract.PortPolicy {
	policy.Overrides = maps.Clone(policy.Overrides)
	return policy
}

func (m *Manager) workspaceRoot(name string) (string, error) {
	base := filepath.Join(m.Root, "workspaces")
	canonical, err := devcontract.CanonicalPath(base)
	if err != nil {
		return "", err
	}
	if canonical != base {
		return "", devcontract.Fail(4, "foreign_workspace", "workspace collection cannot be redirected through a symlink")
	}
	// Names are registry lookups, never arbitrary paths or relative traversal.
	if !safeID(name) {
		return "", devcontract.Fail(2, "invalid_target", "workspace name or UUID is required")
	}
	entries, err := os.ReadDir(base)
	if os.IsNotExist(err) {
		return "", devcontract.Fail(3, "missing_workspace", "workspace not found")
	}
	if err != nil {
		return "", err
	}
	found := ""
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		dir := filepath.Join(base, entry.Name())
		manifest, e := readManifest(dir)
		if e != nil {
			// A durable unpublished create can lack its first manifest. Match
			// only a valid ownership journal, never an unowned staging directory.
			if j, je := loadJournal(dir); je == nil {
				manifest = j.Manifest
			} else if entry.Name() == name {
				return "", e
			} else {
				continue
			}
		}
		if entry.Name() == name || manifest.Slug == name || manifest.WorkspaceID == name {
			if found != "" {
				return "", devcontract.Fail(3, "ambiguous_workspace", "multiple workspace identities match target")
			}
			found = dir
		}
	}
	if found == "" {
		return "", devcontract.Fail(3, "missing_workspace", "workspace not found")
	}
	return found, nil
}

func (m *Manager) inspectRoot(root string) (Workspace, error) {
	resolved, err := devcontract.ResolveWorkspace(devcontract.ResolveOptions{Explicit: filepath.Join(root, "workspace.json"), Home: m.options.Home})
	if err != nil {
		return Workspace{}, err
	}
	j, err := loadJournal(root)
	if err != nil {
		return Workspace{}, err
	}
	if j.WorkspaceID != resolved.Manifest.WorkspaceID {
		return Workspace{}, devcontract.Fail(4, "foreign_workspace", "manifest identity differs from ownership journal")
	}
	return Workspace{ResolvedWorkspace: resolved, Phase: j.Phase}, nil
}

func (m *Manager) Inspect(ctx context.Context, name string) (Workspace, error) {
	if err := ctx.Err(); err != nil {
		return Workspace{}, err
	}
	root, err := m.workspaceRoot(name)
	if err != nil {
		return Workspace{}, err
	}
	return m.inspectRoot(root)
}

func (m *Manager) Paths(ctx context.Context, name string) (WorkspacePaths, error) {
	w, err := m.Inspect(ctx, name)
	if err != nil {
		return WorkspacePaths{}, err
	}
	profile, err := m.defaultProfileRoot(w.Manifest.WorkspaceID)
	if err != nil {
		return WorkspacePaths{}, err
	}
	runtime, err := devcontract.CanonicalPath(filepath.Join(profile, "runtime"))
	if err != nil {
		return WorkspacePaths{}, err
	}
	webview, err := devcontract.CanonicalPath(filepath.Join(profile, "webview"))
	if err != nil {
		return WorkspacePaths{}, err
	}
	if !inside(profile, runtime) || !inside(profile, webview) {
		return WorkspacePaths{}, devcontract.Fail(4, "foreign_profile", "runtime or webview resolves outside the UUID profile")
	}
	paths := WorkspacePaths{WorkspaceID: w.Manifest.WorkspaceID, Root: w.Root, ManifestPath: w.ManifestPath, LocalRoot: filepath.Join(w.Root, ".local"), StateRoot: w.StateRoot, RuntimeRoot: runtime, WebviewRoot: webview, Repositories: map[string]string{}}
	for _, r := range w.Manifest.Repositories {
		paths.Repositories[r.ID], err = devcontract.CanonicalPath(filepath.Join(w.Root, r.Directory))
		if err != nil {
			return WorkspacePaths{}, err
		}
	}
	return paths, nil
}

func (m *Manager) defaultProfileRoot(id string) (string, error) {
	profiles, err := devcontract.CanonicalPath(filepath.Join(m.options.Home, ".omniview-dev", "profiles"))
	if err != nil {
		return "", err
	}
	expected := filepath.Join(profiles, id)
	actual, err := devcontract.CanonicalPath(expected)
	if err != nil {
		return "", err
	}
	if actual != expected {
		return "", devcontract.Fail(4, "foreign_profile", "UUID profile resolves through a symlink")
	}
	return actual, nil
}

func (m *Manager) defaultStateRoot(id string) (string, error) {
	profile, err := m.defaultProfileRoot(id)
	if err != nil {
		return "", err
	}
	expected := filepath.Join(profile, "state")
	actual, err := devcontract.CanonicalPath(expected)
	if err != nil {
		return "", err
	}
	if actual != expected {
		return "", devcontract.Fail(4, "foreign_profile", "default state root resolves through a symlink")
	}
	return actual, nil
}

func (m *Manager) List(ctx context.Context) ([]Workspace, error) {
	items := []Workspace{}
	base := filepath.Join(m.Root, "workspaces")
	canonical, err := devcontract.CanonicalPath(base)
	if err != nil {
		return nil, err
	}
	if canonical != base {
		return nil, devcontract.Fail(4, "foreign_workspace", "workspace collection cannot be a symlink")
	}
	entries, err := os.ReadDir(base)
	if os.IsNotExist(err) {
		return items, nil
	}
	if err != nil {
		return nil, err
	}
	for _, e := range entries {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if !e.IsDir() || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		w, err := m.inspectRoot(filepath.Join(base, e.Name()))
		if err != nil {
			return nil, err
		}
		items = append(items, w)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Manifest.Slug < items[j].Manifest.Slug })
	return items, nil
}
