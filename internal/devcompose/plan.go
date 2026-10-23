// Package devcompose plans the one native pnpm workspace owned by a feature.
// Planning and receipt validation never write to selected sources or outputs.
package devcompose

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"gopkg.in/yaml.v3"
)

const Version = "12.14.0"
const RootEnvironment = "PNPM_CONFIG_WORKSPACE_DIR"

type Root struct {
	Path    string            `json:"path"`
	Version string            `json:"version"`
	Targets map[string]string `json:"targets"`
}
type Package struct {
	Path    string `json:"path"`
	Name    string `json:"name"`
	Version string `json:"version,omitempty"`
	Private bool   `json:"private"`
}
type File struct {
	Path string
	Data []byte
}

// LockConvergence describes a seed reconciliation, not the final native graph.
// Sources and field names contain no registry URLs or resolution values.
type LockConvergence struct {
	Section         string   `json:"section"`
	PackageKey      string   `json:"packageKey"`
	PreferredSource string   `json:"preferredSource"`
	OtherSource     string   `json:"otherSource"`
	ChangedFields   []string `json:"changedFields"`
}
type Plan struct {
	SchemaVersion int               `json:"schemaVersion"`
	WorkspaceID   string            `json:"workspaceID"`
	Root          string            `json:"root"`
	Version       string            `json:"version"`
	Roots         []Root            `json:"roots"`
	Packages      []Package         `json:"packages"`
	Targets       map[string]string `json:"targets"`
	SourceHashes  map[string]string `json:"sourceHashes"`
	Files         []File            `json:"-"`
	Convergence   []LockConvergence `json:"convergence,omitempty"`
}

type sourceSet struct {
	packages  []Package
	manifests map[string]map[string]any
	configs   map[string]map[string]any
	roots     []Root
	hashes    map[string]string
	locks     []string
}

func refusal(format string, args ...any) error {
	return fmt.Errorf("pnpm composition: "+format, args...)
}
func within(root, path string) bool {
	r, e := filepath.Rel(root, path)
	return e == nil && r != ".." && !strings.HasPrefix(r, ".."+string(filepath.Separator)) && !filepath.IsAbs(r)
}
func exactPath(path string) error {
	if !filepath.IsAbs(path) || filepath.Clean(path) != path {
		return refusal("path must be absolute and canonical")
	}
	c, e := devcontract.CanonicalPath(path)
	if e != nil {
		return refusal("cannot resolve selected path")
	}
	if c != path {
		return refusal("selected path was redirected through a symlink")
	}
	return nil
}
func repository(w devcontract.ResolvedWorkspace, path string) (string, error) {
	if err := exactPath(path); err != nil {
		return "", err
	}
	for _, r := range w.Manifest.Repositories {
		root := filepath.Join(w.Root, r.Directory)
		if within(root, path) {
			if err := exactPath(root); err != nil {
				return "", err
			}
			rel, _ := filepath.Rel(root, path)
			for _, part := range strings.Split(rel, string(filepath.Separator)) {
				if part == ".git" || part == ".local" || part == "node_modules" {
					return "", refusal("selected path overlaps repository metadata or output")
				}
			}
			if w.StateRoot != "" && (within(w.StateRoot, path) || within(path, w.StateRoot)) {
				return "", refusal("selected path overlaps workspace state")
			}
			return root, nil
		}
	}
	return "", refusal("path is not inside an exact selected repository")
}
func workspace(w devcontract.ResolvedWorkspace) error {
	if err := w.Manifest.Validate(); err != nil {
		return err
	}
	if err := exactPath(w.Root); err != nil {
		return err
	}
	if w.ManifestPath != filepath.Join(w.Root, "workspace.json") {
		return refusal("feature root is not the registered workspace root")
	}
	if err := exactPath(w.ManifestPath); err != nil {
		return err
	}
	raw, e := os.ReadFile(w.ManifestPath)
	if e != nil {
		return refusal("cannot read registered workspace manifest")
	}
	var m devcontract.WorkspaceManifest
	if json.Unmarshal(raw, &m) != nil || !reflect.DeepEqual(m, w.Manifest) {
		return refusal("registered workspace manifest changed")
	}
	for _, r := range w.Manifest.Repositories {
		if _, e := repository(w, filepath.Join(w.Root, r.Directory)); e != nil {
			return e
		}
	}
	return nil
}
func hash(data []byte) string { d := sha256.Sum256(data); return hex.EncodeToString(d[:]) }
func readInput(w devcontract.ResolvedWorkspace, s *sourceSet, path string) ([]byte, error) {
	if err := exactPath(path); err != nil {
		return nil, err
	}
	if !within(w.Root, path) {
		return nil, refusal("source input escapes feature root")
	}
	rel, _ := filepath.Rel(w.Root, path)
	raw, e := os.ReadFile(path)
	if e != nil && !os.IsNotExist(e) {
		return nil, refusal("cannot read source input %s", filepath.ToSlash(rel))
	}
	fingerprint := "absent"
	if e == nil {
		fingerprint = hash(raw)
	}
	key := filepath.ToSlash(rel)
	if prior, read := s.hashes[key]; read && prior != fingerprint {
		return nil, refusal("source input %s changed during planning", key)
	}
	s.hashes[key] = fingerprint
	return raw, nil
}

// Merge independently read policy inputs without losing discovery's evidence
// when the same path was consumed by both phases.
func mergeInputHashes(hashes, additional map[string]string) error {
	for path, fingerprint := range additional {
		if prior, read := hashes[path]; read && prior != fingerprint {
			return refusal("source input %s changed during planning", path)
		}
		hashes[path] = fingerprint
	}
	return nil
}
func readManifest(raw []byte, path string) (map[string]any, error) {
	var m map[string]any
	if json.Unmarshal(raw, &m) != nil || m == nil {
		return nil, refusal("invalid package manifest at %s", path)
	}
	if pin, ok := m["packageManager"]; ok {
		v, ok := pin.(string)
		if !ok || strings.Split(v, "+")[0] != "pnpm@"+Version {
			return nil, refusal("incompatible packageManager at %s; managed workspaces require pnpm@%s", path, Version)
		}
	}
	return m, nil
}
func excludedDirectory(name string) bool {
	return strings.HasPrefix(name, ".") || name == "node_modules" || name == "dist" || name == "build" || name == "coverage" || name == "vendor" || name == "target"
}

// workspaceMatch implements pnpm's ordinary path segments and recursive **.
// Unsupported syntax is refused instead of accidentally selecting fewer packages.
func workspaceMatch(pattern, rel string) (bool, error) {
	if strings.ContainsAny(pattern, "{}\\") || strings.HasPrefix(pattern, "/") || strings.Contains(pattern, "..") {
		return false, refusal("unsupported workspace package pattern")
	}
	var match func([]string, []string) (bool, error)
	match = func(p, r []string) (bool, error) {
		if len(p) == 0 {
			return len(r) == 0, nil
		}
		if p[0] == "**" {
			for i := 0; i <= len(r); i++ {
				ok, e := match(p[1:], r[i:])
				if e != nil || ok {
					return ok, e
				}
			}
			return false, nil
		}
		if len(r) == 0 {
			return false, nil
		}
		ok, e := filepath.Match(p[0], r[0])
		if e != nil {
			return false, refusal("invalid workspace package pattern")
		}
		if !ok {
			return false, nil
		}
		return match(p[1:], r[1:])
	}
	return match(strings.Split(strings.TrimSuffix(pattern, "/"), "/"), strings.Split(filepath.ToSlash(rel), "/"))
}
func included(path, repo string, configs map[string]map[string]any, plugin bool) (bool, error) {
	target := path
	configured := false
	for dir := path; ; dir = filepath.Dir(dir) {
		if config, ok := configs[dir]; ok {
			configured = true
			if target != dir {
				patterns, ok := config["packages"].([]any)
				if !ok {
					if _, present := config["packages"]; present {
						return false, refusal("packages must be a list at selected workspace config")
					}
					return false, nil
				}
				relativePath, _ := filepath.Rel(dir, target)
				included := false
				for _, value := range patterns {
					pattern, ok := value.(string)
					if !ok {
						return false, refusal("workspace package pattern must be a string")
					}
					excluded := strings.HasPrefix(pattern, "!")
					matches, err := workspaceMatch(strings.TrimPrefix(pattern, "!"), relativePath)
					if err != nil {
						return false, err
					}
					if matches {
						if excluded {
							return false, nil
						}
						included = true
					}
				}
				if !included {
					return false, nil
				}
			}
			// Nested workspace membership is resolved from its own root; an enclosing
			// workspace can still explicitly exclude that whole source subtree.
			target = dir
		}
		if dir == repo {
			break
		}
	}
	return configured || plugin || path == repo, nil
}

func workspaceOwner(dir string, configs map[string]map[string]any) string {
	for {
		if _, declared := configs[dir]; declared {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return ""
		}
		dir = parent
	}
}

func discover(w devcontract.ResolvedWorkspace, roots []Root) (sourceSet, error) {
	sources := sourceSet{
		manifests: map[string]map[string]any{},
		configs:   map[string]map[string]any{},
		hashes:    map[string]string{},
	}
	if err := workspace(w); err != nil {
		return sources, err
	}
	if len(roots) == 0 {
		return sources, refusal("no selected JavaScript roots")
	}
	for _, name := range []string{".npmrc", ".pnpmfile.cjs", "pnpmfile.cjs", ".pnpmfile.mjs"} {
		raw, err := readInput(w, &sources, filepath.Join(w.Root, name))
		if err != nil {
			return sources, err
		}
		if raw != nil {
			return sources, refusal("unmanaged feature-root policy %s conflicts with the generated composition; keep authentication external and reconcile source policies", name)
		}
	}
	selected := map[string]bool{}
	pluginRepos := map[string]bool{}
	rootMap := map[string]Root{}
	for _, plugin := range w.Manifest.Plugins {
		repo, err := w.RepositoryPath(plugin.RepositoryID)
		if err != nil {
			return sources, err
		}
		selected[repo] = true
		pluginRepos[repo] = true
	}
	for _, root := range roots {
		repo, err := repository(w, root.Path)
		if err != nil {
			return sources, err
		}
		if root.Version != Version {
			return sources, refusal("selected roots require exact pnpm@%s", Version)
		}
		if _, exists := rootMap[root.Path]; exists {
			return sources, refusal("duplicate selected JavaScript root")
		}
		rootMap[root.Path] = root
		selected[repo] = true
	}
	host, _ := w.RepositoryPath("omniview")
	if _, exists := rootMap[host]; !exists {
		return sources, refusal("selected host JavaScript root is required")
	}
	var manifestPaths []string
	for _, repo := range sortedKeys(selected) {
		err := filepath.WalkDir(repo, func(path string, entry fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				return refusal("cannot discover selected repository")
			}
			if entry.IsDir() {
				if path != repo && excludedDirectory(entry.Name()) {
					return filepath.SkipDir
				}
				return nil
			}
			if entry.Type()&os.ModeSymlink != 0 {
				if excludedDirectory(entry.Name()) {
					return nil
				}
				info, err := os.Stat(path)
				if entry.Name() == "package.json" || entry.Name() == "pnpm-workspace.yaml" || (err == nil && info.IsDir()) {
					return refusal("source package/config directory was redirected through a symlink")
				}
				return nil
			}
			switch entry.Name() {
			case "package.json":
				manifestPaths = append(manifestPaths, path)
			case "pnpm-workspace.yaml":
				raw, err := readInput(w, &sources, path)
				if err != nil {
					return err
				}
				docs, err := decodeDocuments(raw)
				if err != nil || len(docs) != 1 {
					return refusal("invalid workspace config at %s", relative(w.Root, path))
				}
				sources.configs[filepath.Dir(path)] = docs[0]
			}
			return nil
		})
		if err != nil {
			return sources, err
		}
	}
	sort.Strings(manifestPaths)
	usedDirs := map[string]bool{}
	for _, path := range manifestPaths {
		dir := filepath.Dir(path)
		repo, err := repository(w, dir)
		if err != nil {
			return sources, err
		}
		selected, err := included(dir, repo, sources.configs, pluginRepos[repo])
		if err != nil {
			return sources, err
		}
		if _, explicit := rootMap[dir]; explicit {
			selected = true
		}
		if !selected {
			continue
		}
		raw, err := readInput(w, &sources, path)
		if err != nil {
			return sources, err
		}
		manifest, err := readManifest(raw, relative(w.Root, path))
		if err != nil {
			return sources, err
		}
		name, _ := manifest["name"].(string)
		if name == "" {
			return sources, refusal("selected package has no name at %s", relative(w.Root, dir))
		}
		version, _ := manifest["version"].(string)
		private, _ := manifest["private"].(bool)
		sources.packages = append(sources.packages, Package{Path: dir, Name: name, Version: version, Private: private})
		sources.manifests[dir] = manifest
		for ancestor := dir; ; ancestor = filepath.Dir(ancestor) {
			usedDirs[ancestor] = true
			if ancestor == repo {
				break
			}
		}
	}
	for path := range rootMap {
		if _, exists := sources.manifests[path]; !exists {
			return sources, refusal("selected JavaScript root has no actual package manifest at %s", relative(w.Root, path))
		}
	}
	if _, err := readInput(w, &sources, w.ManifestPath); err != nil {
		return sources, err
	}
	for _, dir := range sortedKeys(usedDirs) {
		for _, name := range []string{"pnpm-workspace.yaml", "pnpm-lock.yaml", ".npmrc", ".pnpmfile.cjs", "pnpmfile.cjs", ".pnpmfile.mjs"} {
			if name == "pnpm-lock.yaml" {
				// A package member's old standalone lock is inert under its
				// source workspace. Do not seed or freshness-track it.
				workspaceRoot := workspaceOwner(dir, sources.configs)
				if workspaceRoot != "" {
					if workspaceRoot != dir {
						continue
					}
				} else if _, explicit := rootMap[dir]; !explicit {
					continue
				}
			}
			path := filepath.Join(dir, name)
			raw, err := readInput(w, &sources, path)
			if err != nil {
				return sources, err
			}
			if raw == nil {
				continue
			}
			switch name {
			case "pnpm-lock.yaml":
				sources.locks = append(sources.locks, path)
			case "pnpm-workspace.yaml":
				if _, discovered := sources.configs[dir]; !discovered {
					return sources, refusal("workspace declaration at %s appeared during planning", relative(w.Root, path))
				}
				if _, actual := sources.manifests[dir]; actual {
					if _, exists := rootMap[dir]; !exists {
						rootMap[dir] = Root{Path: dir, Version: Version}
					}
				}
			case ".pnpmfile.cjs", "pnpmfile.cjs", ".pnpmfile.mjs":
				return sources, refusal("repository-local pnpm hook at %s cannot be represented; remove it or use standalone installation", relative(w.Root, path))
			}
		}
	}
	// Configs outside selected package ancestry do not govern this composition.
	for dir := range sources.configs {
		if !usedDirs[dir] {
			delete(sources.configs, dir)
			delete(sources.hashes, relative(w.Root, filepath.Join(dir, "pnpm-workspace.yaml")))
		}
	}
	for _, path := range sortedKeys(rootMap) {
		sources.roots = append(sources.roots, rootMap[path])
	}
	return sources, nil
}
func relative(root, path string) string { r, _ := filepath.Rel(root, path); return filepath.ToSlash(r) }
func sortedKeys[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func New(w devcontract.ResolvedWorkspace, roots []Root, targets map[string]string) (Plan, error) {
	sources, err := discover(w, roots)
	if err != nil {
		return Plan{}, err
	}
	for _, name := range []string{"package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml"} {
		if err := exactPath(filepath.Join(w.Root, name)); err != nil {
			return Plan{}, err
		}
	}
	plan := Plan{
		SchemaVersion: 1,
		WorkspaceID:   w.Manifest.WorkspaceID,
		Root:          w.Root,
		Version:       Version,
		Roots:         sources.roots,
		Packages:      sources.packages,
		Targets:       map[string]string{},
		SourceHashes:  sources.hashes,
	}
	for name, path := range targets {
		plan.Targets[name] = path
	}
	for _, root := range roots {
		for name, path := range root.Targets {
			if previous, exists := plan.Targets[name]; exists && previous != path {
				return Plan{}, refusal("ambiguous managed target %s", name)
			}
			plan.Targets[name] = path
		}
	}
	for i := range plan.Roots {
		plan.Roots[i].Targets = make(map[string]string, len(plan.Targets))
		for name, path := range plan.Targets {
			plan.Roots[i].Targets[name] = path
		}
	}
	if err := validateTargets(plan); err != nil {
		return Plan{}, err
	}
	if err := validateManifestDependencies(w, plan, sources.manifests); err != nil {
		return Plan{}, err
	}
	reconciled, err := reconcile(w, sources)
	if err != nil {
		return Plan{}, err
	}
	if err := mergeInputHashes(plan.SourceHashes, reconciled.inputHashes); err != nil {
		return Plan{}, err
	}
	policy := reconciled.settings
	lock, providers, err := seedLock(w, sources, &plan, policy)
	if err != nil {
		return Plan{}, err
	}
	overrides := mapping(policy["overrides"])
	if overrides == nil {
		overrides = map[string]any{}
	}
	for name := range plan.Targets {
		if err := managedOverride(overrides, name, "workspace:*"); err != nil {
			return Plan{}, err
		}
	}
	// Registry providers are singleton resolution policy, not peer evidence.
	// The install transaction must still audit original on-disk peer manifests.
	for name, version := range providers {
		if err := managedOverride(overrides, name, version); err != nil {
			return Plan{}, err
		}
	}
	policy["overrides"] = overrides
	paths := make([]string, 0, len(plan.Packages))
	for _, pkg := range plan.Packages {
		paths = append(paths, relative(plan.Root, pkg.Path))
	}
	policy["packages"] = paths
	dependencies := map[string]string{}
	for name := range plan.Targets {
		dependencies[name] = "workspace:*"
	}
	for name, version := range providers {
		dependencies[name] = version
	}
	manifest := map[string]any{
		"name":                "omniview-feature-" + plan.WorkspaceID,
		"private":             true,
		"packageManager":      "pnpm@" + Version,
		"omniviewWorkspaceID": plan.WorkspaceID,
		"dependencies":        dependencies,
	}
	rawManifest, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return Plan{}, err
	}
	config, err := yaml.Marshal(policy)
	if err != nil {
		return Plan{}, err
	}
	// The seed describes the generated root, not any one source root.
	main := lock[len(lock)-1]
	main["overrides"] = overrides
	aggregate := map[string]any{}
	host, _ := w.RepositoryPath("omniview")
	importers := mapping(main["importers"])
	hostImporter := mapping(importers[relative(plan.Root, host)])
	for name, specifier := range dependencies {
		version := ""
		if path, local := plan.Targets[name]; local {
			version = "link:" + relative(plan.Root, path)
		} else {
			// A range (even an exact-looking one) without its source lock is
			// first-resolution input, not fabricated frozen dependency evidence.
			for _, section := range []string{"dependencies", "devDependencies", "optionalDependencies"} {
				if value, ok := mapping(mapping(hostImporter[section])[name])["version"].(string); ok {
					version = value
					break
				}
			}
			if version == "" {
				continue
			}
		}
		aggregate[name] = map[string]any{"specifier": specifier, "version": version}
	}
	importers["."] = map[string]any{"dependencies": aggregate}
	main["importers"] = importers
	lockBytes, err := encodeDocuments(lock)
	if err != nil {
		return Plan{}, err
	}
	plan.Files = []File{
		{Path: filepath.Join(plan.Root, "package.json"), Data: append(rawManifest, '\n')},
		{Path: filepath.Join(plan.Root, "pnpm-workspace.yaml"), Data: config},
		{Path: filepath.Join(plan.Root, "pnpm-lock.yaml"), Data: lockBytes},
	}
	return plan, nil
}
func validateTargets(plan Plan) error {
	names := map[string][]Package{}
	byPath := map[string]Package{}
	for _, pkg := range plan.Packages {
		names[pkg.Name] = append(names[pkg.Name], pkg)
		byPath[pkg.Path] = pkg
	}
	for name, path := range plan.Targets {
		pkg, selected := byPath[path]
		if !selected || pkg.Name != name {
			return refusal("managed target %s is not an actual selected package", name)
		}
		if len(names[name]) != 1 {
			return refusal("ambiguous exported managed-target name %s", name)
		}
		if name == "react" || name == "react-dom" {
			return refusal("React providers must use the selected host registry lock, not path links")
		}
	}
	for name, packages := range names {
		if len(packages) > 1 {
			for _, pkg := range packages {
				if !pkg.Private {
					return refusal("ambiguous public package name %s", name)
				}
			}
		}
	}
	return nil
}

// Validate checks topology, not freshness, so stopped unlink/recovery can
// preserve source edits. CheckInputs is a separate mandatory installation and
// runtime gate; generated bytes are attested by the canonical link journal.
func Validate(w devcontract.ResolvedWorkspace, plan Plan) error {
	if err := workspace(w); err != nil {
		return err
	}
	if plan.SchemaVersion != 1 || plan.Version != Version || plan.Root != w.Root || plan.WorkspaceID != w.Manifest.WorkspaceID {
		return refusal("composition does not match the registered workspace")
	}
	if len(plan.Roots) == 0 || len(plan.Packages) == 0 {
		return refusal("composition has no selected roots/packages")
	}
	rootPaths := map[string]bool{}
	host, _ := w.RepositoryPath("omniview")
	for _, root := range plan.Roots {
		if root.Version != Version {
			return refusal("incompatible selected root pin")
		}
		if _, err := repository(w, root.Path); err != nil {
			return err
		}
		if rootPaths[root.Path] {
			return refusal("duplicate composition root")
		}
		rootPaths[root.Path] = true
		for name, path := range root.Targets {
			if plan.Targets[name] != path {
				return refusal("root target does not match selected composition target %s", name)
			}
		}
	}
	if !rootPaths[host] {
		return refusal("composition does not select the host root")
	}
	seen := map[string]bool{}
	for _, pkg := range plan.Packages {
		if _, err := repository(w, pkg.Path); err != nil {
			return err
		}
		if seen[pkg.Path] {
			return refusal("duplicate selected package")
		}
		seen[pkg.Path] = true
	}
	if err := validateTargets(plan); err != nil {
		return err
	}
	if len(plan.Files) != 0 {
		if len(plan.Files) != 3 {
			return refusal("unexpected generated file set")
		}
		seen := map[string]bool{}
		for _, file := range plan.Files {
			name := filepath.Base(file.Path)
			if file.Path != filepath.Join(w.Root, name) || (name != "package.json" && name != "pnpm-workspace.yaml" && name != "pnpm-lock.yaml") || seen[name] {
				return refusal("unexpected generated file path")
			}
			if err := exactPath(file.Path); err != nil {
				return err
			}
			seen[name] = true
		}
	}
	return nil
}

func CheckInputs(plan Plan) error {
	if plan.SchemaVersion != 1 || plan.Version != Version || len(plan.SourceHashes) == 0 {
		return refusal("missing or incompatible composition inputs")
	}
	if err := validateTargets(plan); err != nil {
		return err
	}
	if err := exactPath(plan.Root); err != nil {
		return err
	}
	raw, err := os.ReadFile(filepath.Join(plan.Root, "workspace.json"))
	if err != nil {
		return refusal("registered workspace manifest is unavailable")
	}
	var manifest devcontract.WorkspaceManifest
	if json.Unmarshal(raw, &manifest) != nil {
		return refusal("invalid registered workspace manifest")
	}
	workspace := devcontract.ResolvedWorkspace{Root: plan.Root, ManifestPath: filepath.Join(plan.Root, "workspace.json"), Manifest: manifest}
	if manifest.WorkspaceID != plan.WorkspaceID {
		return refusal("workspace identity changed")
	}
	current, err := discover(workspace, plan.Roots)
	if err != nil {
		return err
	}
	reconciled, err := reconcile(workspace, current)
	if err != nil {
		return err
	}
	if err := mergeInputHashes(current.hashes, reconciled.inputHashes); err != nil {
		return err
	}
	if !reflect.DeepEqual(current.hashes, plan.SourceHashes) || !reflect.DeepEqual(current.packages, plan.Packages) {
		return refusal("source manifests/configs/locks changed; stop and reconfigure composition")
	}
	for key := range plan.SourceHashes {
		if filepath.IsAbs(key) || filepath.ToSlash(filepath.Clean(key)) != key || !within(plan.Root, filepath.Join(plan.Root, key)) {
			return refusal("invalid source fingerprint path")
		}
	}
	return nil
}

func decodeDocuments(raw []byte) ([]map[string]any, error) {
	dec := yaml.NewDecoder(bytes.NewReader(raw))
	var docs []map[string]any
	for {
		var m map[string]any
		e := dec.Decode(&m)
		if e != nil {
			if e == io.EOF {
				break
			}
			return nil, refusal("invalid YAML source document")
		}
		if m == nil {
			return nil, refusal("empty YAML source document")
		}
		docs = append(docs, m)
	}
	return docs, nil
}
func encodeDocuments(docs []map[string]any) ([]byte, error) {
	var out bytes.Buffer
	// Native pnpm recognizes its metadata/application stream only when the
	// first document is explicit; otherwise it parses as single-document YAML
	// and discards the entire seed as a broken lockfile.
	if len(docs) > 1 {
		out.WriteString("---\n")
	}
	enc := yaml.NewEncoder(&out)
	enc.SetIndent(2)
	for _, doc := range docs {
		if e := enc.Encode(doc); e != nil {
			return nil, e
		}
	}
	if e := enc.Close(); e != nil {
		return nil, e
	}
	return out.Bytes(), nil
}
func mapping(value any) map[string]any { m, _ := value.(map[string]any); return m }
