// Package devworkspace manages registered sources and ownership-safe feature worktrees.
// It has no desktop, native UI, or production-profile dependency.
package devworkspace

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

type SourceSpec struct {
	ID         string `json:"id"`
	Path       string `json:"path"`
	Worktree   string `json:"worktree,omitempty"`
	DefaultRef string `json:"defaultRef,omitempty"`
	Directory  string `json:"directory,omitempty"`
}

type Source struct {
	ID         string `json:"id"`
	CommonDir  string `json:"commonDir"`
	Worktree   string `json:"worktree,omitempty"`
	DefaultRef string `json:"defaultRef"`
	Directory  string `json:"directory"`
}

type Registry struct {
	SchemaVersion int      `json:"schemaVersion"`
	Repositories  []Source `json:"repositories"`
}

type InitOptions struct {
	Root string
	// Sources replaces automatic discovery. Explicit mappings resolve duplicate
	// historical clones; no origin URLs or credentials are written to the registry.
	Sources []SourceSpec
}

func safeID(s string) bool {
	return s != "" && s != "." && s != ".." && !strings.ContainsAny(s, "/\\:\x00\r\n")
}

func git(ctx context.Context, dir string, input string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", append([]string{"-C", dir}, args...)...)
	cmd.WaitDelay = 2 * time.Second
	// Ambient GIT_DIR/GIT_WORK_TREE must not redirect an owned operation.
	for _, e := range os.Environ() {
		key, _, _ := strings.Cut(e, "=")
		if strings.HasPrefix(key, "GIT_") || key == "GOWORK" {
			continue
		}
		cmd.Env = append(cmd.Env, e)
	}
	cmd.Env = append(cmd.Env, "GIT_TERMINAL_PROMPT=0", "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL="+os.DevNull, "GOWORK=off")
	if input != "" {
		cmd.Stdin = strings.NewReader(input)
	}
	out, err := cmd.Output()
	if err != nil {
		if ctx.Err() != nil {
			return "", ctx.Err()
		}
		// Git stderr may contain credential-bearing remote URLs. Never relay it.
		return "", devcontract.Fail(5, "git_failed", fmt.Sprintf("Git %s failed in %s", args[0], dir))
	}
	return strings.TrimSpace(string(out)), nil
}

func resolveCommit(ctx context.Context, common, ref string) (string, error) {
	if strings.TrimSpace(ref) == "" || strings.ContainsAny(ref, "\x00\r\n") {
		return "", devcontract.Fail(2, "invalid_ref", "source ref must be nonempty single-line text")
	}
	return git(ctx, common, "", "rev-parse", "--verify", "--end-of-options", ref+"^{commit}")
}

func sourceFromSpec(ctx context.Context, root string, spec SourceSpec, refresh bool) (Source, error) {
	var s Source
	if !safeID(spec.ID) {
		return s, devcontract.Fail(2, "invalid_repository", "source ID is invalid")
	}
	p := spec.Path
	if !filepath.IsAbs(p) {
		p = filepath.Join(root, p)
	}
	p, err := devcontract.CanonicalPath(p)
	if err != nil {
		return s, err
	}
	common, err := git(ctx, p, "", "rev-parse", "--path-format=absolute", "--git-common-dir")
	if err != nil {
		return s, err
	}
	common, err = devcontract.CanonicalPath(common)
	if err != nil {
		return s, err
	}
	worktree := spec.Worktree
	if worktree == "" {
		bare, e := git(ctx, p, "", "rev-parse", "--is-bare-repository")
		if e != nil {
			return s, e
		}
		if bare == "false" {
			worktree, err = git(ctx, p, "", "rev-parse", "--show-toplevel")
		}
	} else if !filepath.IsAbs(worktree) {
		worktree = filepath.Join(root, worktree)
	}
	if err != nil {
		return s, err
	}
	if worktree != "" {
		worktree, err = devcontract.CanonicalPath(worktree)
		if err != nil {
			return s, err
		}
		c, e := git(ctx, worktree, "", "rev-parse", "--path-format=absolute", "--git-common-dir")
		if e != nil {
			return s, e
		}
		c, e = devcontract.CanonicalPath(c)
		if e != nil || c != common {
			return s, devcontract.Fail(4, "source_mismatch", "source checkout belongs to another Git repository")
		}
	}
	ref := spec.DefaultRef
	if ref == "" {
		ref, err = git(ctx, common, "", "symbolic-ref", "--short", "HEAD")
		if err != nil {
			return s, devcontract.Fail(2, "missing_default_ref", "detached source requires an explicit default ref")
		}
	}
	resolve := resolveCommit
	if refresh {
		resolve = resolveSelectedCommit
	}
	if _, err = resolve(ctx, common, ref); err != nil {
		return s, err
	}
	directory := spec.Directory
	if directory == "" {
		directory = spec.ID
	}
	if !safeID(directory) || directory == ".local" || directory == "workspace.json" {
		return s, devcontract.Fail(2, "invalid_repository_path", "source directory must be a safe single directory name")
	}
	return Source{ID: spec.ID, CommonDir: common, Worktree: worktree, DefaultRef: ref, Directory: directory}, nil
}

func originFingerprint(ctx context.Context, common string) string {
	origin, err := git(ctx, common, "", "config", "--get", "remote.origin.url")
	if err != nil || origin == "" {
		return ""
	}
	if u, e := url.Parse(origin); e == nil && u.Scheme == "file" {
		if u.Host != "" && u.Host != "localhost" {
			return ""
		}
		origin = filepath.FromSlash(u.Path)
		if !filepath.IsAbs(origin) {
			origin = filepath.Join(common, origin)
		}
		if canonical, e := devcontract.CanonicalPath(origin); e == nil {
			origin = canonical
		}
	} else if u, e := url.Parse(origin); e == nil && u.Host != "" {
		// HTTPS/SSH spellings of the same host/path are one source identity;
		// credentials, query strings and transport do not disambiguate clones.
		origin = strings.ToLower(u.Hostname()) + "/" + strings.TrimPrefix(u.Path, "/")
	} else if host, path, ok := strings.Cut(origin, ":"); ok && !strings.ContainsAny(host, "/\\") {
		if _, h, hasUser := strings.Cut(host, "@"); hasUser {
			host = h
		}
		origin = strings.ToLower(host) + "/" + strings.TrimPrefix(path, "/")
	} else {
		if !filepath.IsAbs(origin) {
			origin = filepath.Join(common, origin)
		}
		if canonical, e := devcontract.CanonicalPath(origin); e == nil {
			origin = canonical
		}
	}
	origin = strings.TrimSuffix(strings.TrimSuffix(origin, "/"), ".git")
	sum := sha256.Sum256([]byte(origin))
	return hex.EncodeToString(sum[:])
}

func validateSources(ctx context.Context, sources []Source) error {
	ids, commons, origins, dirs := map[string]bool{}, map[string]bool{}, map[string]bool{}, map[string]bool{}
	for _, s := range sources {
		if ids[s.ID] || commons[s.CommonDir] || dirs[s.Directory] {
			return devcontract.Fail(4, "duplicate_source", "repository ID, common directory or workspace directory has duplicate mappings")
		}
		origin := originFingerprint(ctx, s.CommonDir)
		if origin != "" && origins[origin] {
			return devcontract.Fail(4, "ambiguous_origin", "multiple registered repositories share an origin; register only the intended source")
		}
		ids[s.ID], commons[s.CommonDir], dirs[s.Directory] = true, true, true
		if origin != "" {
			origins[origin] = true
		}
	}
	if !ids["omniview"] {
		return devcontract.Fail(2, "missing_host", "source registry requires omniview")
	}
	return nil
}

func Init(ctx context.Context, opts InitOptions) (Registry, error) {
	var reg Registry
	root, err := devcontract.CanonicalPath(opts.Root)
	if err != nil {
		return reg, err
	}
	if opts.Root == "" {
		return reg, devcontract.Fail(2, "missing_root", "repository root is required")
	}
	unlock, err := lockRoot(root)
	if err != nil {
		return reg, err
	}
	defer unlock()
	specs := opts.Sources
	if len(specs) == 0 {
		defaults := []SourceSpec{{ID: "omniview", Path: "omniview"}, {ID: "plugin-sdk", Path: "plugin-sdk"}, {ID: "kubernetes", Path: "omniview-plugin-kubernetes", Directory: "omniview-plugin-kubernetes"}, {ID: "ui", Path: "ui/.bare", Worktree: "ui/main"}}
		for _, spec := range defaults {
			if _, e := os.Stat(filepath.Join(root, spec.Path)); e == nil {
				specs = append(specs, spec)
			} else if !os.IsNotExist(e) {
				return reg, e
			}
		}
	}
	reg.SchemaVersion = 1
	for _, spec := range specs {
		s, e := sourceFromSpec(ctx, root, spec, true)
		if e != nil {
			return Registry{}, e
		}
		reg.Repositories = append(reg.Repositories, s)
	}
	if err = validateSources(ctx, reg.Repositories); err != nil {
		return Registry{}, err
	}
	path := filepath.Join(root, ".omniview-dev", "repositories.json")
	if data, e := os.ReadFile(path); e == nil {
		var old Registry
		if json.Unmarshal(data, &old) != nil {
			return Registry{}, devcontract.Fail(4, "invalid_registry", "existing registry is invalid; repair it explicitly")
		}
		previous, _ := json.Marshal(old)
		next, _ := json.Marshal(reg)
		if string(previous) != string(next) {
			return Registry{}, devcontract.Fail(4, "registry_exists", "registry already exists with different sources; existing mappings are retained")
		}
		return old, nil
	} else if !os.IsNotExist(e) {
		return Registry{}, e
	}
	return reg, atomicJSON(path, reg)
}

func LoadRegistry(root string) (Registry, error) {
	var reg Registry
	data, err := os.ReadFile(filepath.Join(root, ".omniview-dev", "repositories.json"))
	if err != nil {
		return reg, devcontract.Fail(3, "missing_registry", "initialize the repository root first")
	}
	if err = json.Unmarshal(data, &reg); err != nil || reg.SchemaVersion != 1 {
		return reg, devcontract.Fail(2, "invalid_registry", "invalid repository registry")
	}
	for i, s := range reg.Repositories {
		if !filepath.IsAbs(s.CommonDir) || (s.Worktree != "" && !filepath.IsAbs(s.Worktree)) {
			return reg, devcontract.Fail(2, "invalid_registry", "registry paths must be absolute")
		}
		resolved, e := sourceFromSpec(context.Background(), root, SourceSpec{ID: s.ID, Path: s.CommonDir, Worktree: s.Worktree, DefaultRef: s.DefaultRef, Directory: s.Directory}, false)
		if e != nil {
			return reg, e
		}
		if resolved != s {
			return reg, devcontract.Fail(4, "source_changed", "registered source path changed")
		}
		reg.Repositories[i] = resolved
	}
	return reg, validateSources(context.Background(), reg.Repositories)
}
