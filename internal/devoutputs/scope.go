// Package devoutputs owns explicitly selected repository producer outputs. It is
// native-independent and shared by workspace builders and actual process owners.
package devoutputs

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"

	"github.com/google/uuid"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"
	"gopkg.in/yaml.v3"
)

type Producer string

const (
	Distribution Producer = "distribution"
	Bindings     Producer = "bindings"
	Shims        Producer = "shims"
	YAMLWorker   Producer = "yaml-worker"
	modules      Producer = "modules"
	viteCache    Producer = "vite-cache"
	loaderCache  Producer = "vite-loader-cache"
	typeCache    Producer = "typescript-cache"
	loaderFiles  Producer = "vite-loader-files"
)

const filteredOutputMode = "filter"

type scope struct {
	workspace         devcontract.ResolvedWorkspace
	repos, identities map[string]string
	rootIdentity      string
	directory, path   string
}
type specification struct {
	Kind                                         Producer
	Consumer, Target, Repository, Relative, Mode string
}

func contains(root, path string) bool {
	relative, err := filepath.Rel(root, path)
	return err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) && !filepath.IsAbs(relative)
}
func cleanPath(path string) (string, error) {
	if !filepath.IsAbs(path) {
		return "", fmt.Errorf("producer path must be absolute")
	}
	canonical, err := devcontract.CanonicalPath(path)
	if err != nil {
		return "", err
	}
	if canonical != filepath.Clean(path) {
		return "", fmt.Errorf("producer path or parent was redirected through a symlink: %s", path)
	}
	return canonical, nil
}
func newScope(w devcontract.ResolvedWorkspace) (scope, error) {
	s := scope{workspace: w, repos: map[string]string{}, identities: map[string]string{}}
	id, err := uuid.Parse(w.Manifest.WorkspaceID)
	if err != nil || id == uuid.Nil || id.String() != w.Manifest.WorkspaceID {
		return s, fmt.Errorf("repository outputs require exact workspace UUID")
	}
	root, err := cleanPath(w.Root)
	if err != nil {
		return s, err
	}
	collection := filepath.Dir(filepath.Dir(root))
	if filepath.Dir(root) != filepath.Join(collection, "workspaces") {
		return s, fmt.Errorf("repository outputs require registered workspaces collection")
	}
	s.rootIdentity, err = directoryIdentity(root)
	if err != nil {
		return s, err
	}
	for _, repo := range w.Manifest.Repositories {
		path := filepath.Join(root, repo.Directory)
		if !contains(root, path) || path == root {
			return s, fmt.Errorf("selected repository escapes workspace")
		}
		path, err = cleanPath(path)
		if err != nil {
			return s, err
		}
		s.repos[repo.ID] = path
		identity, e := directoryIdentity(path)
		if os.IsNotExist(e) {
			identity = "absent"
		} else if e != nil {
			return s, e
		}
		s.identities[repo.ID] = identity
	}
	s.directory = filepath.Join(collection, ".omniview-dev", "repository-outputs", w.Manifest.WorkspaceID)
	if _, err = cleanPath(s.directory); err != nil {
		return s, err
	}
	s.path = filepath.Join(s.directory, "journal.json")
	if w.StateRoot != "" {
		state, err := cleanPath(w.StateRoot)
		if err != nil {
			return s, err
		}
		if contains(state, s.directory) || contains(s.directory, state) {
			return s, fmt.Errorf("output metadata overlaps selected state boundary")
		}
	}
	return s, nil
}
func (s scope) repository(path string) (string, string, error) {
	path, err := cleanPath(path)
	if err != nil {
		return "", "", err
	}
	for _, root := range s.repos {
		if contains(root, path) {
			relative, _ := filepath.Rel(root, path)
			for _, part := range strings.Split(filepath.ToSlash(relative), "/") {
				if part == ".git" || part == ".local" {
					return "", "", fmt.Errorf("producer target overlaps repository metadata")
				}
			}
			if s.workspace.StateRoot != "" && (contains(s.workspace.StateRoot, path) || contains(path, s.workspace.StateRoot)) {
				return "", "", fmt.Errorf("producer target overlaps selected state")
			}
			return root, relative, nil
		}
	}
	return "", "", fmt.Errorf("producer target is not in a selected repository")
}
func (s scope) spec(consumer string, kind Producer) (specification, error) {
	var spec specification
	consumer, err := cleanPath(consumer)
	if err != nil {
		return spec, err
	}
	// Only composition installation may introduce this fixed aggregate scope.
	// It is not a selected repository, and carries no Git source authority.
	if consumer == s.workspace.Root && kind == modules {
		target := filepath.Join(consumer, "node_modules")
		if _, err = cleanPath(target); err != nil {
			return spec, err
		}
		if s.workspace.StateRoot != "" && (contains(s.workspace.StateRoot, target) || contains(target, s.workspace.StateRoot)) {
			return spec, fmt.Errorf("aggregate modules overlap selected state")
		}
		return specification{Kind: modules, Consumer: consumer, Target: target, Relative: "node_modules", Mode: "tree"}, nil
	}
	repo, _, err := s.repository(consumer)
	if err != nil {
		return spec, err
	}
	if _, err = os.Stat(filepath.Join(consumer, "package.json")); err != nil {
		return spec, fmt.Errorf("producer consumer has no package manifest: %w", err)
	}
	target, mode := "", "tree"
	switch kind {
	case Distribution:
		target = filepath.Join(consumer, "dist")
	case Bindings:
		if consumer != s.repos["omniview"] {
			return spec, fmt.Errorf("bindings producer must target selected host")
		}
		target = filepath.Join(consumer, "packages/omniviewdev-runtime/src/bindings")
	case Shims:
		if consumer != filepath.Join(s.repos["omniview"], "packages/omniviewdev-vite-plugin") {
			return spec, fmt.Errorf("shim producer must target selected host package")
		}
		target = filepath.Join(consumer, "shims")
	case YAMLWorker:
		if consumer != s.repos["omniview"] {
			return spec, fmt.Errorf("worker producer must target selected host")
		}
		target = filepath.Join(consumer, "ui/providers/monaco/yaml.worker.bundle.js")
		mode = "file"
	case modules:
		target = filepath.Join(consumer, "node_modules")
	case loaderCache:
		target = filepath.Join(consumer, "node_modules/.vite-temp")
	case typeCache:
		target = filepath.Join(consumer, "node_modules/.tmp")
	case loaderFiles:
		target = consumer
		mode = filteredOutputMode
	case viteCache:
		sum := sha256.Sum256([]byte(consumer))
		target = filepath.Join(s.directory, "cache", hex.EncodeToString(sum[:16]))
	default:
		return spec, fmt.Errorf("unknown repository producer")
	}
	if _, err = cleanPath(target); err != nil {
		return spec, err
	}
	relative := ""
	if kind != viteCache {
		_, relative, err = s.repository(target)
		if err != nil {
			return spec, err
		}
	}
	return specification{Kind: kind, Consumer: consumer, Target: target, Repository: repo, Relative: relative, Mode: mode}, nil
}
func runGit(ctx context.Context, repo string, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = repo
	for _, entry := range os.Environ() {
		key, _, _ := strings.Cut(entry, "=")
		switch key {
		case "GOWORK", "GOFLAGS", "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES":
			continue
		}
		cmd.Env = append(cmd.Env, entry)
	}
	cmd.Env = append(cmd.Env, "GOWORK=off", "GOFLAGS=")
	raw, err := cmd.Output()
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, fmt.Errorf("selected source Git %s failed: %w", args[0], err)
	}
	return raw, nil
}
func head(ctx context.Context, repo string) (string, error) {
	raw, err := runGit(ctx, repo, "rev-parse", "HEAD")
	return strings.TrimSpace(string(raw)), err
}

func specHead(ctx context.Context, spec specification) (string, error) {
	if spec.Repository == "" && spec.Kind == modules && spec.Relative == "node_modules" && spec.Mode == "tree" && spec.Target == filepath.Join(spec.Consumer, "node_modules") {
		return "", nil
	}
	return head(ctx, spec.Repository)
}

type committedFile struct {
	Data []byte
	Mode os.FileMode
}

func tracked(ctx context.Context, spec specification) (map[string]committedFile, error) {
	result := map[string]committedFile{}
	if spec.Kind == modules || spec.Kind == viteCache || spec.Kind == loaderCache || spec.Kind == typeCache {
		return result, nil
	}
	raw, err := runGit(ctx, spec.Repository, "ls-tree", "-r", "-z", "HEAD", "--", filepath.ToSlash(spec.Relative))
	if err != nil {
		return nil, err
	}
	for _, record := range bytes.Split(raw, []byte{0}) {
		if len(record) == 0 {
			continue
		}
		metadata, path, ok := bytes.Cut(record, []byte{'\t'})
		if !ok {
			return nil, fmt.Errorf("invalid committed source inventory")
		}
		relative, err := filepath.Rel(spec.Target, filepath.Join(spec.Repository, filepath.FromSlash(string(path))))
		if err != nil {
			return nil, err
		}
		if spec.Mode == filteredOutputMode &&
			(filepath.Dir(relative) != "." || !IsViteConfigTemporaryFile(filepath.Base(relative))) {
			continue
		}
		fields := strings.Fields(string(metadata))
		if len(fields) != 3 || fields[1] != "blob" || (fields[0] != "100644" && fields[0] != "100755") {
			return nil, fmt.Errorf("producer baseline contains a non-regular tracked source file")
		}
		data, err := runGit(ctx, spec.Repository, "cat-file", "blob", fields[2])
		if err != nil {
			return nil, err
		}
		mode := os.FileMode(0644)
		if fields[0] == "100755" {
			mode = 0755
		}
		result[relative] = committedFile{Data: data, Mode: mode}
	}
	return result, nil
}

// IsViteConfigTemporaryFile identifies only Vite's exact source-root loader
// stamp names. Watchers and ownership snapshots share this one convention.
func IsViteConfigTemporaryFile(name string) bool {
	for _, base := range []string{"vite.config.ts", "vite.config.mts", "vite.config.js", "vite.config.mjs", "vite.config.cts", "vite.config.cjs"} {
		if strings.HasPrefix(name, base+".timestamp-") && strings.HasSuffix(name, ".mjs") {
			middle := strings.TrimSuffix(strings.TrimPrefix(name, base+".timestamp-"), ".mjs")
			parts := strings.Split(middle, "-")
			if len(parts) != 2 {
				return false
			}
			for i, part := range parts {
				if part == "" {
					return false
				}
				for _, c := range part {
					if c < '0' || c > '9' {
						if i == 0 || c < 'a' || c > 'f' {
							return false
						}
					}
				}
			}
			return true
		}
	}
	return false
}

func packageRoots(consumer string) ([]string, error) {
	roots := []string{consumer}
	raw, err := os.ReadFile(filepath.Join(consumer, "pnpm-workspace.yaml"))
	if os.IsNotExist(err) {
		return roots, nil
	}
	if err != nil {
		return nil, err
	}
	var doc struct {
		Packages []string `yaml:"packages"`
	}
	if err = yaml.Unmarshal(raw, &doc); err != nil {
		return nil, err
	}
	for i, pattern := range doc.Packages {
		negative := strings.HasPrefix(pattern, "!")
		plain := strings.TrimPrefix(pattern, "!")
		if filepath.IsAbs(plain) || strings.Contains(plain, "\\") {
			return nil, fmt.Errorf("workspace package pattern escapes selected install root")
		}
		for _, part := range strings.Split(plain, "/") {
			if part == ".." {
				return nil, fmt.Errorf("workspace package pattern escapes selected install root")
			}
		}
		plain = strings.TrimPrefix(plain, "./")
		if negative {
			plain = "!" + plain
		}
		doc.Packages[i] = plain
	}
	err = filepath.WalkDir(consumer, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if path == consumer {
			return nil
		}
		if entry.IsDir() && (entry.Name() == "node_modules" || entry.Name() == ".git" || entry.Name() == ".local") {
			return filepath.SkipDir
		}
		rel, _ := filepath.Rel(consumer, path)
		parts := strings.Split(filepath.ToSlash(rel), "/")
		possible := false
		for _, pattern := range doc.Packages {
			plain := strings.TrimPrefix(pattern, "!")
			if strings.HasPrefix(pattern, "!") {
				if strings.HasSuffix(plain, "/**") && matchPackage(strings.Split(plain, "/"), parts) {
					if entry.IsDir() {
						return filepath.SkipDir
					}
					return nil
				}
			} else if packagePrefix(strings.Split(plain, "/"), parts) {
				possible = true
			}
		}
		if !possible {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 {
			info, e := os.Stat(path)
			if e == nil && info.IsDir() {
				return fmt.Errorf("workspace package discovery rejects directory symlinks: %s", path)
			}
			return nil
		}
		if !entry.IsDir() {
			return nil
		}
		if _, e := os.Stat(filepath.Join(path, "package.json")); os.IsNotExist(e) {
			return nil
		} else if e != nil {
			return e
		}
		selected := false
		for _, pattern := range doc.Packages {
			negative := strings.HasPrefix(pattern, "!")
			if matchPackage(strings.Split(strings.TrimPrefix(pattern, "!"), "/"), strings.Split(filepath.ToSlash(rel), "/")) {
				selected = !negative
			}
		}
		if selected {
			roots = append(roots, path)
		}
		return nil
	})
	sort.Strings(roots)
	return roots, err
}
func matchPackage(pattern, parts []string) bool {
	if len(pattern) == 0 {
		return len(parts) == 0
	}
	if pattern[0] == "**" {
		if matchPackage(pattern[1:], parts) {
			return true
		}
		return len(parts) > 0 && matchPackage(pattern, parts[1:])
	}
	if len(parts) == 0 {
		return false
	}
	matched, err := filepath.Match(pattern[0], parts[0])
	return err == nil && matched && matchPackage(pattern[1:], parts[1:])
}

func packagePrefix(pattern, parts []string) bool {
	if len(parts) == 0 {
		return true
	}
	if len(pattern) == 0 {
		return false
	}
	if pattern[0] == "**" {
		return packagePrefix(pattern[1:], parts) || packagePrefix(pattern, parts[1:])
	}
	matched, err := filepath.Match(pattern[0], parts[0])
	return err == nil && matched && packagePrefix(pattern[1:], parts[1:])
}
func readJournal(s scope) (journal, error) {
	j := journal{Version: 1, WorkspaceID: s.workspace.Manifest.WorkspaceID, Root: s.workspace.Root, Repositories: s.repos, RepositoryIdentities: s.identities, Entries: map[string]*outputEntry{}}
	if err := devsession.ValidatePrivateFile(s.path); os.IsNotExist(err) {
		return j, nil
	} else if err != nil {
		return j, err
	}
	raw, err := os.ReadFile(s.path)
	if err != nil {
		return j, err
	}
	if err = json.Unmarshal(raw, &j); err != nil {
		return j, err
	}
	if j.Version != 1 || j.WorkspaceID != s.workspace.Manifest.WorkspaceID || j.Entries == nil {
		return j, fmt.Errorf("repository output journal identity differs")
	}
	if len(j.Entries) == 0 && !j.Restoring {
		j.Root = s.workspace.Root
		j.Repositories = s.repos
		j.RepositoryIdentities = s.identities
		return j, nil
	}
	if j.Root != s.workspace.Root {
		return j, fmt.Errorf("unfinished repository outputs belong to another workspace location")
	}
	if j.RootIdentity != "" {
		actual, err := directoryIdentity(s.workspace.Root)
		if err != nil {
			return j, err
		}
		if actual != j.RootIdentity || actual != s.rootIdentity {
			return j, fmt.Errorf("aggregate feature directory identity changed")
		}
	}
	left, _ := json.Marshal(j.Repositories)
	right, _ := json.Marshal(s.repos)
	if !bytes.Equal(left, right) {
		return j, fmt.Errorf("selected repositories changed before repository outputs were restored")
	}
	left, _ = json.Marshal(j.RepositoryIdentities)
	right, _ = json.Marshal(s.identities)
	if !bytes.Equal(left, right) {
		return j, fmt.Errorf("selected repository directory identity changed")
	}
	for key, entry := range j.Entries {
		if err = validateEntryRecord(entry); err != nil {
			return j, err
		}
		expected, e := s.spec(entry.Spec.Consumer, entry.Spec.Kind)
		if e != nil || expected != entry.Spec || key != entry.Spec.Target+"|"+string(entry.Spec.Kind) {
			return j, fmt.Errorf("repository output journal target is not the selected producer")
		}
		if entry.Spec.Consumer == s.workspace.Root && (j.RootIdentity == "" || entry.Spec.Kind != modules || len(entry.Exclude) != 0) {
			return j, fmt.Errorf("aggregate modules require exact feature identity and immutable store ownership")
		}
		for _, excluded := range entry.Exclude {
			if entry.Spec.Kind != modules || (excluded != ".vite-temp" && excluded != ".tmp") {
				return j, fmt.Errorf("journal contains an unowned cache exclusion")
			}
			kind := cacheKind(excluded)
			child, exists := j.Entries[filepath.Join(entry.Spec.Target, excluded)+"|"+string(kind)]
			if !exists || child.Spec.Consumer != entry.Spec.Consumer || child.Spec.Kind != kind {
				return j, fmt.Errorf("cache exclusion has no independent writer ownership")
			}
		}
	}
	return j, nil
}
