// Package devcontract defines native-independent development workspace contracts.
package devcontract

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/google/uuid"
)

const SchemaVersion = 1
const WorkspaceEnvironment = "OMNIVIEW_WORKSPACE_FILE"

var slugPattern = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)
var commitPattern = regexp.MustCompile(`^([0-9a-f]{40}|[0-9a-f]{64})$`)

type WorkspaceManifest struct {
	SchemaVersion int          `json:"schemaVersion"`
	WorkspaceID   string       `json:"workspaceID"`
	Slug          string       `json:"slug"`
	DisplayName   string       `json:"displayName"`
	Repositories  []Repository `json:"repositories"`
	Plugins       []Plugin     `json:"plugins"`
	Links         Links        `json:"links"`
	Profile       Profile      `json:"profile"`
	Ports         PortPolicy   `json:"ports"`
}
type Repository struct {
	ID         string `json:"id"`
	Directory  string `json:"directory"`
	BaseRef    string `json:"baseRef"`
	BaseCommit string `json:"baseCommit"`
	Branch     string `json:"branch"`
}
type Plugin struct {
	ID           string `json:"id"`
	RepositoryID string `json:"repositoryID"`
	Mode         string `json:"mode"`
}
type Links struct {
	UIRepositoryID  *string `json:"uiRepositoryID"`
	SDKRepositoryID *string `json:"sdkRepositoryID"`
	HostPackages    bool    `json:"hostPackages"`
}
type Profile struct {
	Kind     string  `json:"kind"`
	Baseline *string `json:"baseline"`
}
type PortPolicy struct {
	Policy    string         `json:"policy"`
	Overrides map[string]int `json:"overrides"`
}

func (m WorkspaceManifest) Validate() error {
	if m.SchemaVersion != SchemaVersion {
		return Fail(2, "unsupported_schema", "unsupported workspace schema")
	}
	id, err := uuid.Parse(m.WorkspaceID)
	if err != nil || id == uuid.Nil || id.String() != m.WorkspaceID {
		return Fail(2, "invalid_identity", "workspaceID must be a canonical nonzero UUID")
	}
	if len(m.Slug) > 48 || !slugPattern.MatchString(m.Slug) {
		return Fail(2, "invalid_slug", "workspace slug must contain 1–48 lowercase letters/digits and interior single hyphens")
	}
	if strings.TrimSpace(m.DisplayName) == "" || strings.ContainsAny(m.DisplayName, "\x00\r\n") {
		return Fail(2, "invalid_name", "displayName must be nonempty single-line text")
	}
	if m.Profile.Kind != "development" {
		return Fail(2, "invalid_profile", "workspace profile must be development")
	}
	repos := make(map[string]bool, len(m.Repositories))
	dirs := make([]string, 0, len(m.Repositories))
	for _, r := range m.Repositories {
		if !safeID(r.ID) || repos[r.ID] {
			return Fail(2, "invalid_repository", "repository IDs must be unique safe identifiers")
		}
		repos[r.ID] = true
		if !safeRelative(r.Directory) {
			return Fail(2, "invalid_repository_path", "repository directory must be a contained relative path")
		}
		d := filepath.Clean(r.Directory)
		for _, other := range dirs {
			if contained(other, d) || contained(d, other) {
				return Fail(2, "overlapping_repositories", "repository directories overlap")
			}
		}
		dirs = append(dirs, d)
		if strings.TrimSpace(r.BaseRef) == "" || !commitPattern.MatchString(r.BaseCommit) || strings.TrimSpace(r.Branch) == "" {
			return Fail(2, "unresolved_repository", "repository requires base ref, resolved commit and branch")
		}
	}
	if !repos["omniview"] {
		return Fail(2, "missing_host", "workspace must select omniview")
	}
	plugins := make(map[string]bool, len(m.Plugins))
	for _, p := range m.Plugins {
		if !safeID(p.ID) || plugins[p.ID] || !repos[p.RepositoryID] || p.Mode != "managed" {
			return Fail(2, "invalid_plugin", "plugins require unique IDs, a selected source and managed mode")
		}
		plugins[p.ID] = true
	}
	for _, link := range []*string{m.Links.UIRepositoryID, m.Links.SDKRepositoryID} {
		if link != nil && !repos[*link] {
			return Fail(2, "invalid_link", "linked repository is not selected")
		}
	}
	if m.Ports.Policy != "sticky" && m.Ports.Policy != "strict" {
		return Fail(2, "invalid_port_policy", "port policy must be sticky or strict")
	}
	used := make(map[int]bool, len(m.Ports.Overrides))
	for role, port := range m.Ports.Overrides {
		if strings.TrimSpace(role) == "" || port < 1 || port > 65535 || used[port] {
			return Fail(2, "invalid_port", "port overrides must be valid distinct ports")
		}
		used[port] = true
	}
	return nil
}
func safeID(s string) bool {
	return s != "" && s != "." && s != ".." && !strings.ContainsAny(s, "/\\\x00\r\n")
}
func safeRelative(s string) bool {
	return s != "" && s != "." && !strings.ContainsAny(s, "\\:\x00") && !filepath.IsAbs(s) && filepath.Clean(s) == s && s != ".." && !strings.HasPrefix(s, ".."+string(filepath.Separator))
}
func contained(root, path string) bool {
	rel, err := filepath.Rel(root, path)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && !filepath.IsAbs(rel)
}

// CanonicalPath resolves existing symlink ancestors even for not-yet-created paths.
func CanonicalPath(path string) (string, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	probe := abs
	var missing []string
	for {
		resolved, e := filepath.EvalSymlinks(probe)
		if e == nil {
			for i := len(missing) - 1; i >= 0; i-- {
				resolved = filepath.Join(resolved, missing[i])
			}
			return resolved, nil
		}
		if !os.IsNotExist(e) {
			return "", e
		}
		// A dangling link is an existing identity boundary, not a missing
		// directory to reconstruct lexically beneath its parent.
		if _, statErr := os.Lstat(probe); statErr == nil {
			return "", e
		} else if !os.IsNotExist(statErr) {
			return "", statErr
		}
		parent := filepath.Dir(probe)
		if parent == probe {
			return "", e
		}
		missing = append(missing, filepath.Base(probe))
		probe = parent
	}
}

type ResolveOptions struct {
	CWD                 string
	Explicit            string
	EnvironmentManifest string
	StateRoot           string
	Home                string
}
type ResolvedWorkspace struct {
	ManifestPath string            `json:"manifestPath"`
	Root         string            `json:"root"`
	StateRoot    string            `json:"stateRoot"`
	Manifest     WorkspaceManifest `json:"manifest"`
}

func ResolveWorkspace(opts ResolveOptions) (ResolvedWorkspace, error) {
	var result ResolvedWorkspace
	cwd := opts.CWD
	if cwd == "" {
		var err error
		cwd, err = os.Getwd()
		if err != nil {
			return result, err
		}
	}
	explicit := opts.Explicit
	env := opts.EnvironmentManifest
	if env != "" && !filepath.IsAbs(env) {
		return result, Fail(2, "invalid_target", "environment manifest must be absolute")
	}
	canonical := func(p string) (string, error) {
		if !filepath.IsAbs(p) {
			p = filepath.Join(cwd, p)
		}
		if info, e := os.Stat(p); e == nil && info.IsDir() {
			p = filepath.Join(p, "workspace.json")
		}
		resolved, err := CanonicalPath(p)
		if os.IsNotExist(err) {
			return "", Fail(3, "missing_workspace", "cannot read selected workspace manifest")
		}
		return resolved, err
	}
	if explicit != "" && env != "" {
		a, e := canonical(explicit)
		if e != nil {
			return result, e
		}
		b, e := canonical(env)
		if e != nil {
			return result, e
		}
		if a != b {
			return result, Fail(4, "conflicting_target", "explicit and environment workspaces disagree")
		}
	}
	target := explicit
	if target == "" {
		target = env
	}
	if target == "" {
		dir, e := CanonicalPath(cwd)
		if e != nil {
			return result, e
		}
		for {
			candidate := filepath.Join(dir, "workspace.json")
			if _, e = os.Stat(candidate); e == nil {
				if target != "" {
					return result, Fail(3, "ambiguous_workspace", "multiple enclosing workspace manifests; select explicitly")
				}
				target = candidate
			} else if !os.IsNotExist(e) {
				return result, e
			}
			parent := filepath.Dir(dir)
			if parent == dir {
				break
			}
			dir = parent
		}
	}
	if target == "" {
		return result, Fail(3, "missing_workspace", "no workspace selected; production fallback is disabled")
	}
	manifestPath, e := canonical(target)
	if e != nil {
		return result, e
	}
	data, e := os.ReadFile(manifestPath)
	if e != nil {
		return result, Fail(3, "missing_workspace", "cannot read selected workspace manifest")
	}
	var manifest WorkspaceManifest
	if e = json.Unmarshal(data, &manifest); e != nil {
		return result, Fail(2, "invalid_manifest", "invalid workspace JSON")
	}
	if e = manifest.Validate(); e != nil {
		return result, e
	}
	root := filepath.Dir(manifestPath)
	resolvedRepositories := make([]string, 0, len(manifest.Repositories))
	for _, r := range manifest.Repositories {
		p, e := CanonicalPath(filepath.Join(root, r.Directory))
		if e != nil {
			return result, e
		}
		if !contained(root, p) {
			return result, Fail(4, "escaping_repository", "repository resolves outside workspace")
		}
		for _, other := range resolvedRepositories {
			if contained(other, p) || contained(p, other) {
				return result, Fail(4, "overlapping_repositories", "resolved repository directories overlap")
			}
		}
		resolvedRepositories = append(resolvedRepositories, p)
	}
	home := opts.Home
	if home == "" {
		home, e = os.UserHomeDir()
		if e != nil {
			return result, e
		}
	}
	state, custom, e := resolveCustomProfile(ResolvedWorkspace{ManifestPath: manifestPath, Root: root, Manifest: manifest}, home)
	if e != nil {
		return result, e
	}
	if !custom {
		state, e = CanonicalPath(filepath.Join(home, ".omniview-dev", "profiles", manifest.WorkspaceID, "state"))
		if e != nil {
			return result, e
		}
		// Shared ancestors may alias, but the default UUID profile and its
		// state namespace must remain at their exact expected locations.
		profiles, e := CanonicalPath(filepath.Join(home, ".omniview-dev", "profiles"))
		if e != nil {
			return result, e
		}
		expectedProfile := filepath.Join(profiles, manifest.WorkspaceID)
		profile, e := CanonicalPath(expectedProfile)
		if e != nil {
			return result, e
		}
		if profile != expectedProfile || state != filepath.Join(expectedProfile, "state") {
			return result, Fail(4, "conflicting_state_root", "workspace state resolves outside its expected state namespace")
		}
	}
	if opts.StateRoot != "" {
		if !filepath.IsAbs(opts.StateRoot) {
			return result, Fail(2, "invalid_state_root", "state root must be absolute")
		}
		selected, e := CanonicalPath(opts.StateRoot)
		if e != nil {
			return result, e
		}
		if state != selected {
			return result, Fail(4, "conflicting_state_root", "state root disagrees with workspace profile")
		}
	}
	for _, name := range []string{".omniview", ".omniview-nightly"} {
		protected, e := CanonicalPath(filepath.Join(home, name))
		if e != nil {
			return result, e
		}
		if contained(protected, state) || contained(state, protected) {
			return result, Fail(4, "protected_state_root", "workspace state overlaps a production profile")
		}
	}
	return ResolvedWorkspace{ManifestPath: manifestPath, Root: root, StateRoot: state, Manifest: manifest}, nil
}

func (w ResolvedWorkspace) RepositoryPath(id string) (string, error) {
	for _, r := range w.Manifest.Repositories {
		if r.ID == id {
			return filepath.Join(w.Root, r.Directory), nil
		}
	}
	return "", Fail(3, "missing_repository", fmt.Sprintf("repository %q is not selected", id))
}
