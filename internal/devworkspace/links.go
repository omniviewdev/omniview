package devworkspace

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"

	"github.com/google/uuid"
	"github.com/omniviewdev/omniview/internal/devcompose"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devoutputs"
	"github.com/omniviewdev/omniview/internal/devsession"
)

const linkedSDK = "github.com/omniviewdev/plugin-sdk"

// LinkProtocolEvidence is emitted by TestLinkPinnedProtocolProbe, not inferred
// from the existence of node_modules symlinks. Keep the gate fail-closed until
// the pinned-version live-dist and peer probe has actually been run.
type LinkProtocolEvidence struct {
	Protocol   string   `json:"protocol"`
	Versions   []string `json:"versions"`
	AtomicDist bool     `json:"atomicDist"`
	Peers      bool     `json:"peers"`
	Runtime    bool     `json:"runtime"`
}

func supportedPNPMVersion(version string) bool {
	return version == devcompose.Version
}

func (e LinkProtocolEvidence) validate() error {
	if e.Protocol != "workspace" || len(e.Versions) != 1 || e.Versions[0] != devcompose.Version || !e.AtomicDist || !e.Peers || !e.Runtime {
		return devcontract.Fail(3, "link_protocol_unproved", "run the native pnpm12 composition live-dist/recursive-peer probe; historical independent-root evidence cannot authorize this workspace")
	}
	return nil
}

func (e LinkProtocolEvidence) validateRoots(roots []linkRoot) error {
	if err := e.validate(); err != nil {
		return err
	}
	for _, root := range roots {
		found := false
		for _, version := range e.Versions {
			if root.Version == version {
				found = true
				break
			}
		}
		if !found {
			return devcontract.Fail(3, "link_protocol_unproved", "protocol evidence does not cover selected pnpm "+root.Version)
		}
	}
	return nil
}

type LinkOptions struct {
	Evidence LinkProtocolEvidence
}

type LinkResolution struct {
	Consumer string `json:"consumer"`
	Package  string `json:"package"`
	Expected string `json:"expected"`
	Resolved string `json:"resolved,omitempty"`
	Version  string `json:"version,omitempty"`
	Problem  string `json:"problem,omitempty"`
}

type LinkReport struct {
	WorkspaceID     string                       `json:"workspaceID"`
	Protocol        string                       `json:"protocol"`
	Phase           string                       `json:"phase"`
	Resolutions     []LinkResolution             `json:"resolutions"`
	SeedConvergence []devcompose.LockConvergence `json:"seedConvergence,omitempty"`
}

type linkRoot = devcompose.Root

type linkConsumer struct {
	Path    string            `json:"path"`
	Targets map[string]string `json:"targets"`
}

type linkPlan struct {
	Roots       []linkRoot       `json:"roots"`
	Consumers   []linkConsumer   `json:"consumers"`
	GoRoots     []string         `json:"goRoots"`
	SDK         string           `json:"sdk,omitempty"`
	Composition *devcompose.Plan `json:"composition,omitempty"`
}

type linkFile struct {
	Path           string      `json:"path"`
	Original       []byte      `json:"original"`
	OriginalExists bool        `json:"originalExists"`
	OriginalHash   string      `json:"originalHash"`
	Applied        []byte      `json:"applied"`
	AppliedHash    string      `json:"appliedHash"`
	Mode           os.FileMode `json:"mode"`
	// Pending means an external installer may have changed this file before a
	// crash. Never guess ownership of those bytes during recovery.
	Pending bool `json:"pending,omitempty"`
}

type linkJournal struct {
	SchemaVersion int                           `json:"schemaVersion"`
	WorkspaceID   string                        `json:"workspaceID"`
	Root          string                        `json:"root"`
	Phase         string                        `json:"phase"`
	Manifest      devcontract.WorkspaceManifest `json:"manifest"`
	Evidence      LinkProtocolEvidence          `json:"evidence"`
	Plan          linkPlan                      `json:"plan"`
	Files         []linkFile                    `json:"files"`
}

func readLinkPackage(path string) (map[string]any, error) {
	raw, err := os.ReadFile(filepath.Join(path, "package.json"))
	if err != nil {
		return nil, err
	}
	var p map[string]any
	if err = json.Unmarshal(raw, &p); err != nil {
		return nil, err
	}
	return p, nil
}

func pinnedLinkVersion(path string) (string, error) {
	p, err := readLinkPackage(path)
	if err != nil {
		return "", err
	}
	pm, _ := p["packageManager"].(string)
	if pm == "" {
		return "", devcontract.Fail(3, "unsupported_package_manager", "selected JavaScript root must declare pnpm@"+devcompose.Version)
	}
	if !strings.HasPrefix(pm, "pnpm@") {
		return "", devcontract.Fail(3, "unsupported_package_manager", "selected consumer does not declare pnpm")
	}
	version := strings.Split(strings.TrimPrefix(pm, "pnpm@"), "+")[0]
	if !supportedPNPMVersion(version) {
		return "", devcontract.Fail(3, "unproved_pnpm_version", "selected pnpm version is outside the protocol probe")
	}
	return version, nil
}

func ownedLinkDirectory(root, path string) error {
	rel, err := filepath.Rel(root, path)
	if err != nil {
		return err
	}
	if _, err = safeLinkPath(root, rel); err != nil {
		return err
	}
	_, err = safeLinkPath(root, filepath.Join(rel, "package.json"))
	return err
}

func makeLinkPlan(w Workspace) (linkPlan, error) {
	var p linkPlan
	repos := map[string]string{}
	for _, r := range w.Manifest.Repositories {
		path := filepath.Join(w.Root, r.Directory)
		if err := ownedLinkDirectory(w.Root, path); err != nil {
			return p, err
		}
		repos[r.ID] = path
	}
	host := repos["omniview"]
	if host == "" {
		return p, devcontract.Fail(2, "missing_host", "workspace has no host repository")
	}
	targets := map[string]string{}
	addPackages := func(root string, paths []string) error {
		for _, rel := range paths {
			path := filepath.Join(root, rel)
			if err := ownedLinkDirectory(w.Root, path); err != nil {
				return err
			}
			pkg, err := readLinkPackage(path)
			if err != nil {
				return err
			}
			name, _ := pkg["name"].(string)
			if name == "" {
				return devcontract.Fail(2, "invalid_package", "selected local package has no name")
			}
			targets[name] = path
		}
		return nil
	}
	if w.Manifest.Links.UIRepositoryID != nil {
		root := repos[*w.Manifest.Links.UIRepositoryID]
		if root == "" {
			return p, devcontract.Fail(2, "missing_ui", "selected UI repository is absent")
		}
		if err := addPackages(root, []string{"packages/base-ui", "packages/ai-ui", "packages/editors"}); err != nil {
			return p, err
		}
	}
	if w.Manifest.Links.HostPackages {
		if err := addPackages(host, []string{"packages/omniviewdev-providers", "packages/omniviewdev-runtime", "packages/omniviewdev-vite-plugin"}); err != nil {
			return p, err
		}
	}
	var err error
	appendRoot := func(path string) error {
		if err := ownedLinkDirectory(w.Root, path); err != nil {
			return err
		}
		version, err := pinnedLinkVersion(path)
		if err != nil {
			return err
		}
		p.Roots = append(p.Roots, linkRoot{Path: path, Version: version, Targets: targets})
		return nil
	}
	if err = appendRoot(host); err != nil {
		return p, err
	}
	// Refuse redirected known host package directories even before discovery.
	for _, rel := range []string{"packages/omniviewdev-runtime", "packages/omniviewdev-providers", "packages/omniviewdev-vite-plugin"} {
		path := filepath.Join(host, rel)
		if err := ownedLinkDirectory(w.Root, path); err != nil {
			return p, err
		}
	}
	if w.Manifest.Links.UIRepositoryID != nil {
		ui := repos[*w.Manifest.Links.UIRepositoryID]
		if err = appendRoot(ui); err != nil {
			return p, err
		}
	}
	p.GoRoots = append(p.GoRoots, host)
	seen := map[string]bool{host: true}
	for _, plugin := range w.Manifest.Plugins {
		root := repos[plugin.RepositoryID]
		if root == "" {
			return p, devcontract.Fail(2, "missing_plugin_repository", "selected plugin source is absent")
		}
		if seen[root] {
			continue
		}
		seen[root] = true
		frontend := root
		if err := ownedLinkDirectory(w.Root, filepath.Join(root, "ui")); err != nil {
			return p, err
		}
		if _, e := os.Stat(filepath.Join(root, "ui/package.json")); e == nil {
			frontend = filepath.Join(root, "ui")
		}
		if _, e := os.Stat(filepath.Join(frontend, "package.json")); e == nil {
			if err = appendRoot(frontend); err != nil {
				return p, err
			}
		} else if !os.IsNotExist(e) {
			return p, e
		}
		if _, e := os.Stat(filepath.Join(root, "go.mod")); e == nil {
			p.GoRoots = append(p.GoRoots, root)
		}
	}
	if w.Manifest.Links.SDKRepositoryID != nil {
		p.SDK = repos[*w.Manifest.Links.SDKRepositoryID]
	}
	composition, err := devcompose.New(w.ResolvedWorkspace, p.Roots, targets)
	if err != nil {
		return p, err
	}
	p.Composition = &composition
	p.Roots = composition.Roots
	p.Consumers = make([]linkConsumer, 0, len(composition.Packages))
	for _, pkg := range composition.Packages {
		p.Consumers = append(p.Consumers, linkConsumer{Path: pkg.Path, Targets: composition.Targets})
	}
	if err := validateLinkedPeerContracts(w, p); err != nil {
		return p, err
	}
	return p, nil
}

type linkBuildCacheKey struct{}
type linkCommandOwnerKey struct{}
type linkToolchainKey struct{}

// Prepare outside linkWorkspace's profile guard: that guard is deliberately
// non-reentrant. Read-only/protocol commands never acquire an active profile lock.
func (m *Manager) linkCommandContext(ctx context.Context, name string) (context.Context, error) {
	w, err := m.Inspect(ctx, name)
	if err != nil {
		return nil, err
	}
	var plan linkPlan
	if journal, journalErr := loadLinkJournal(w); journalErr == nil {
		// Recovery retains recorded composition authority without adopting edited
		// source inputs; source freshness is checked separately before execution.
		plan = journal.Plan
	} else if !os.IsNotExist(journalErr) {
		return nil, journalErr
	} else {
		plan, err = makeLinkPlan(w)
		if err != nil {
			return nil, err
		}
	}
	generation := uuid.NewString()
	cache, err := prepareWorkspaceBuildCache(ctx, w, m.options.Home, generation)
	if err != nil {
		return nil, err
	}
	graph := &BuildGraph{workspace: w, plan: plan, options: BuildOptions{Generation: generation}}
	ctx = context.WithValue(ctx, linkToolchainKey{}, graph)
	ctx = context.WithValue(ctx, linkBuildCacheKey{}, cache)
	return context.WithValue(ctx, linkCommandOwnerKey{}, devsession.ProcessOwner{WorkspaceID: w.Manifest.WorkspaceID, Generation: generation, Role: "dependency-command", Source: w.Root}), nil
}

const dependencyCommandExitCode = 5

// linkCommand deliberately ignores ambient go.work, GOFLAGS and package-manager
// selectors. Every pnpm call uses the exact native12 composition launcher, and
// only this recorded composition runner may change dependencies through it.
func linkCommand(ctx context.Context, dir, program string, args ...string) ([]byte, error) {
	pnpm := program == "pnpm"
	if pnpm {
		graph, ok := ctx.Value(linkToolchainKey{}).(*BuildGraph)
		if !ok {
			return nil, fmt.Errorf("native pnpm requires the selected workspace toolchain context")
		}
		selected, argv, err := graph.PNPMCommand(ctx, devcompose.Version, args...)
		if err != nil {
			return nil, err
		}
		program, args = selected, argv
	}
	owner, owned := ctx.Value(linkCommandOwnerKey{}).(devsession.ProcessOwner)
	var cmd *exec.Cmd
	if owned {
		cmd = exec.Command(program, args...)
	} else {
		cmd = exec.CommandContext(ctx, program, args...)
	}
	cmd.Dir = dir
	for _, entry := range os.Environ() {
		key, _, _ := strings.Cut(entry, "=")
		if workspaceRootEnvironment(key) || key == compositionInstallEnvironment {
			continue
		}
		if key != "GOWORK" && key != "GOFLAGS" && key != "NODE_PATH" && key != "GOCACHE" && key != "OMNIVIEW_PNPM_NODE_PATH" {
			cmd.Env = append(cmd.Env, entry)
		}
	}
	cmd.Env = append(cmd.Env, "GOWORK=off", "GOFLAGS=", "OMNIVIEW_PNPM_NODE_PATH=")
	if pnpm {
		cmd.Env = append(cmd.Env, compositionInstallEnvironment+"=1")
	}
	if cache, ok := ctx.Value(linkBuildCacheKey{}).(string); ok {
		cmd.Env = append(cmd.Env, "GOCACHE="+cache)
	}
	var out bytes.Buffer
	cmd.Stdout = &out
	var diagnostic bytes.Buffer
	cmd.Stderr = &diagnostic
	var err error
	if owned {
		owner.Source = dir
		err = RunRepositoryCommand(ctx, cmd, owner)
	} else {
		err = cmd.Run()
	}
	if err != nil {
		evidence := ""
		if graph, ok := ctx.Value(linkToolchainKey{}).(*BuildGraph); ok {
			evidence = filepath.Join(graph.workspace.Root, ".local", "dependency-command-error.json")
			record := struct {
				WorkspaceID string   `json:"workspaceID"`
				Directory   string   `json:"directory"`
				Program     string   `json:"program"`
				Arguments   []string `json:"arguments"`
				Stdout      string   `json:"stdout"`
				Stderr      string   `json:"stderr"`
			}{graph.workspace.Manifest.WorkspaceID, dir, program, args, out.String(), diagnostic.String()}
			if saveErr := saveLaunchJSON(evidence, record); saveErr != nil {
				return nil, errors.Join(devcontract.Fail(dependencyCommandExitCode, "link_command_failed",
					"dependency command failed and private diagnostics could not be retained"), saveErr)
			}
		}
		if errors.Is(err, errOwnedCommandUncertain) {
			return nil, errors.Join(errOwnedCommandUncertain, devcontract.Fail(5, "link_command_failed", "dependency command subtree termination is unproven; ownership intent retained"))
		}
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, devcontract.Fail(dependencyCommandExitCode, "link_command_failed", fmt.Sprintf(
			"%s failed in %s; private diagnostics: %s (contents withheld; may contain credentials); "+
				"preserve evidence and run workspace recover", program, dir, evidence))
	}
	return out.Bytes(), nil
}

func linkSDK(ctx context.Context, dir string, original []byte, sdk string) ([]byte, error) {
	f, err := os.CreateTemp(dir, ".omniview-go-*.mod")
	if err != nil {
		return nil, err
	}
	name := f.Name()
	defer os.Remove(name)
	if _, err = f.Write(original); err != nil {
		_ = f.Close()
		return nil, err
	}
	if err = f.Close(); err != nil {
		return nil, err
	}
	raw, err := linkCommand(ctx, dir, "go", "mod", "edit", "-json", name)
	if err != nil {
		return nil, err
	}
	var info struct {
		Replace []struct {
			Old, New struct{ Path, Version string }
		}
	}
	if err = json.Unmarshal(raw, &info); err != nil {
		return nil, err
	}
	matching := false
	for _, r := range info.Replace {
		if r.Old.Path != linkedSDK {
			continue
		}
		target := r.New.Path
		if !filepath.IsAbs(target) {
			target = filepath.Join(dir, target)
		}
		canonical, e := devcontract.CanonicalPath(target)
		if e != nil || r.New.Version != "" || canonical != sdk || r.Old.Version != "" {
			return nil, devcontract.Fail(4, "link_conflict", "existing SDK replacement conflicts with selected feature SDK")
		}
		matching = true
	}
	if matching {
		return original, nil
	}
	if _, err = linkCommand(ctx, dir, "go", "mod", "edit", "-replace="+linkedSDK+"="+sdk, name); err != nil {
		return nil, err
	}
	return os.ReadFile(name)
}

func linkHash(data []byte, exists bool) string {
	if !exists {
		return "absent"
	}
	digest := sha256.Sum256(data)
	return hex.EncodeToString(digest[:])
}

func safeLinkPath(root, relative string) (string, error) {
	path := filepath.Join(root, relative)
	if filepath.IsAbs(relative) || !inside(root, path) {
		return "", devcontract.Fail(4, "invalid_link_journal", "dependency file escapes workspace")
	}
	canonical, err := devcontract.CanonicalPath(path)
	if err != nil {
		return "", err
	}
	if canonical != path {
		return "", devcontract.Fail(4, "link_conflict", "dependency file path was redirected through a symlink")
	}
	return path, nil
}

func snapshotLinkFile(root, path string) (linkFile, error) {
	rel, err := filepath.Rel(root, path)
	if err != nil {
		return linkFile{}, err
	}
	path, err = safeLinkPath(root, rel)
	if err != nil {
		return linkFile{}, err
	}
	e := linkFile{Path: rel, Mode: 0644}
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		e.OriginalHash = "absent"
		e.AppliedHash = "absent"
		return e, nil
	}
	if err != nil {
		return e, err
	}
	stat, err := os.Stat(path)
	if err != nil {
		return e, err
	}
	if !stat.Mode().IsRegular() {
		return e, devcontract.Fail(4, "link_conflict", "dependency file is not regular")
	}
	e.Mode = stat.Mode().Perm()
	e.Original = data
	e.OriginalExists = true
	e.OriginalHash = linkHash(data, true)
	e.Applied = data
	e.AppliedHash = e.OriginalHash
	return e, nil
}

func writeLinkFile(root string, e linkFile, data []byte, exists bool) error {
	path, err := safeLinkPath(root, e.Path)
	if err != nil {
		return err
	}
	if !exists {
		if err = os.Remove(path); os.IsNotExist(err) {
			return nil
		}
		if err != nil {
			return err
		}
		return syncDirectory(filepath.Dir(path))
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".link-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if err = f.Chmod(e.Mode); err == nil {
		_, err = f.Write(data)
	}
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	if err = os.Rename(f.Name(), path); err != nil {
		return err
	}
	return syncDirectory(filepath.Dir(path))
}

func saveLinkJournal(j *linkJournal) error {
	return atomicJSON(filepath.Join(j.Root, ".local/links.json"), j)
}

func loadLinkJournal(w Workspace) (*linkJournal, error) {
	path, err := safeLinkPath(w.Root, ".local/links.json")
	if err != nil {
		return nil, err
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var j linkJournal
	if err = json.Unmarshal(raw, &j); err != nil {
		return nil, err
	}
	if j.SchemaVersion != 2 || j.Root != w.Root || j.WorkspaceID != w.Manifest.WorkspaceID || j.Plan.Composition == nil {
		return nil, devcontract.Fail(4, "invalid_link_journal", "dependency journal is unsupported or belongs to another workspace; restore the prior CLI's overlay before configuring native pnpm12")
	}
	if err = devcompose.Validate(w.ResolvedWorkspace, *j.Plan.Composition); err != nil {
		return nil, err
	}
	if err = j.Evidence.validateRoots(j.Plan.Roots); err != nil {
		return nil, err
	}
	if (j.Phase != "applying" && j.Phase != "linked" && j.Phase != "unlinking") || len(j.Plan.Roots) == 0 || len(j.Plan.Roots) != len(j.Plan.Composition.Roots) {
		return nil, devcontract.Fail(4, "invalid_link_journal", "dependency journal has no matching composition roots or lifecycle phase")
	}
	allowed := map[string]bool{}
	for _, name := range []string{"package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml"} {
		allowed[name] = true
	}
	for index, r := range j.Plan.Roots {
		if r.Path != j.Plan.Composition.Roots[index].Path || r.Version != j.Plan.Composition.Roots[index].Version {
			return nil, devcontract.Fail(4, "invalid_link_journal", "dependency roots differ from composition authority")
		}
		rel, e := filepath.Rel(w.Root, r.Path)
		if e != nil {
			return nil, e
		}
		if _, e = safeLinkPath(w.Root, rel); e != nil {
			return nil, e
		}
		if !supportedPNPMVersion(r.Version) {
			return nil, devcontract.Fail(4, "invalid_link_journal", "unexpected pinned package manager")
		}
	}
	for _, root := range j.Plan.GoRoots {
		rel, e := filepath.Rel(w.Root, root)
		if e != nil {
			return nil, e
		}
		if _, e = safeLinkPath(w.Root, rel); e != nil {
			return nil, e
		}
		for _, name := range []string{"go.mod", "go.sum"} {
			allowed[filepath.Join(rel, name)] = true
		}
	}
	for _, c := range j.Plan.Consumers {
		rel, e := filepath.Rel(w.Root, c.Path)
		if e != nil {
			return nil, e
		}
		if _, e = safeLinkPath(w.Root, rel); e != nil {
			return nil, e
		}
		for _, target := range c.Targets {
			rel, e = filepath.Rel(w.Root, target)
			if e != nil {
				return nil, e
			}
			if !inside(w.Root, filepath.Join(w.Root, rel)) {
				return nil, devcontract.Fail(4, "invalid_link_journal", "dependency target escapes workspace")
			}
		}
	}
	seen := map[string]bool{}
	for _, e := range j.Files {
		if _, err = safeLinkPath(w.Root, e.Path); err != nil {
			return nil, err
		}
		if !allowed[e.Path] || seen[e.Path] || e.OriginalHash != linkHash(e.Original, e.OriginalExists) || (e.AppliedHash != "absent" && e.AppliedHash != linkHash(e.Applied, true)) {
			return nil, devcontract.Fail(4, "invalid_link_journal", "dependency journal content hash or owned path mismatch")
		}
		seen[e.Path] = true
	}
	for _, name := range []string{"package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml"} {
		if !seen[name] {
			return nil, devcontract.Fail(4, "invalid_link_journal", "composition generated file intent is incomplete")
		}
	}
	return &j, nil
}

func checkLinkFiles(root string, j *linkJournal) error {
	for _, e := range j.Files {
		if j.Phase == "linked" && e.Pending {
			return devcontract.Fail(4, "link_conflict", "linked composition has an unfinished output intent")
		}
		current, err := snapshotLinkFile(root, filepath.Join(root, e.Path))
		if err != nil {
			return err
		}
		hash := current.OriginalHash
		if e.Pending && hash != e.AppliedHash {
			return devcontract.Fail(4, "link_conflict", "interrupted installer left unverified dependency changes: "+e.Path)
		}
		if j.Phase == "linked" && hash != e.AppliedHash {
			return devcontract.Fail(4, "link_conflict", "dependency file changed after linking: "+e.Path)
		}
		if hash != e.AppliedHash && hash != e.OriginalHash {
			return devcontract.Fail(4, "link_conflict", "dependency file changed after linking: "+e.Path)
		}
	}
	return nil
}

func applyLinkFiles(j *linkJournal) error {
	unchanged := func(e linkFile) error {
		current, err := snapshotLinkFile(j.Root, filepath.Join(j.Root, e.Path))
		if err != nil {
			return err
		}
		if current.OriginalHash != e.OriginalHash {
			return devcontract.Fail(4, "link_conflict", "dependency file changed during link planning: "+e.Path)
		}
		return nil
	}
	// SDK planning invokes external Go commands. Recheck every original before
	// saving intent or writing any prepared bytes, including files not modified.
	if j.Plan.Composition != nil {
		if err := devcompose.CheckInputs(*j.Plan.Composition); err != nil {
			return err
		}
	}
	for _, e := range j.Files {
		if err := unchanged(e); err != nil {
			return err
		}
	}
	if err := saveLinkJournal(j); err != nil {
		return err
	}
	for _, e := range j.Files {
		if e.AppliedHash == e.OriginalHash {
			continue
		}
		// Also catch saves between the all-file preflight and this file's write.
		if err := unchanged(e); err != nil {
			return err
		}
		if err := writeLinkFile(j.Root, e, e.Applied, e.AppliedHash != "absent"); err != nil {
			return err
		}
	}
	return nil
}

func restoreLinkFiles(root string, j *linkJournal) error {
	// Preflight every file before restoring any; user edits never cause a partial
	// restore of otherwise unchanged files.
	if err := checkLinkFiles(root, j); err != nil {
		return err
	}
	for _, e := range j.Files {
		if err := writeLinkFile(root, e, e.Original, e.OriginalExists); err != nil {
			return err
		}
	}
	return nil
}

func (m *Manager) linkWorkspace(ctx context.Context, name string) (Workspace, func(), error) {
	unlock, err := lockRoot(m.Root)
	if err != nil {
		return Workspace{}, nil, err
	}
	w, err := m.Inspect(ctx, name)
	if err != nil {
		unlock()
		return w, nil, err
	}
	j, err := loadJournal(w.Root)
	if err == nil {
		err = checkManifest(w.Root, j)
	}
	if err == nil {
		for i := range j.Resources {
			if j.Resources[i].Removed {
				continue
			}
			if err = verifyWorktree(ctx, &j.Resources[i], false); err != nil {
				break
			}
		}
	}
	if err != nil {
		unlock()
		return w, nil, err
	}
	stopUnlock, err := m.lockStopped(ctx, w.ResolvedWorkspace)
	if err != nil {
		unlock()
		return w, nil, err
	}
	return w, func() { stopUnlock(); unlock() }, nil
}

// The aggregate lock is acquired only after both the installer and recursive
// audit terminate successfully. A failed/uncertain producer never authorizes
// new lock bytes; its pending intent remains available for explicit recovery.
func installComposition(ctx context.Context, w devcontract.ResolvedWorkspace, j *linkJournal, run func(context.Context, string, string, ...string) ([]byte, error)) error {
	if w.Root != j.Root || w.Manifest.WorkspaceID != j.WorkspaceID || !sameManifest(w.Manifest, j.Manifest) || j.Plan.Composition == nil {
		return devcontract.Fail(4, "link_conflict", "installer workspace differs from its composition journal")
	}
	p := *j.Plan.Composition
	if err := devcompose.Validate(w, p); err != nil {
		return err
	}
	if err := devcompose.CheckInputs(p); err != nil {
		return err
	}
	if err := checkLinkFiles(j.Root, j); err != nil {
		return err
	}
	lock := -1
	for i := range j.Files {
		if j.Files[i].Path == "pnpm-lock.yaml" {
			lock = i
			j.Files[i].Pending = true
		}
	}
	if lock < 0 {
		return devcontract.Fail(4, "invalid_link_journal", "composition has no aggregate lock intent")
	}
	if err := saveLinkJournal(j); err != nil {
		return err
	}
	writer, err := devoutputs.BeginCompositionInstall(ctx, w, p)
	if err != nil {
		return err
	}
	_, runErr := run(ctx, p.Root, "pnpm", "install", "--ignore-scripts", "--strict-peer-dependencies", "--no-frozen-lockfile")
	if runErr == nil {
		_, runErr = run(ctx, p.Root, "pnpm", "-r", "peers", "check", "--json", "--lockfile-only")
	}
	if errors.Is(runErr, errOwnedCommandUncertain) {
		return runErr
	}
	runErr = errors.Join(runErr, writer.Finish(context.WithoutCancel(ctx)))
	// Snapshot all non-output inputs after the *last* actual child exits.
	runErr = errors.Join(runErr, devcompose.CheckInputs(p))
	for i, e := range j.Files {
		if i == lock {
			continue
		}
		current, err := snapshotLinkFile(j.Root, filepath.Join(j.Root, e.Path))
		if err != nil {
			return errors.Join(runErr, err)
		}
		if current.OriginalHash != e.AppliedHash {
			return errors.Join(runErr, devcontract.Fail(4, "link_conflict", "dependency configuration changed while composition commands were running: "+e.Path))
		}
	}
	current, err := snapshotLinkFile(j.Root, filepath.Join(j.Root, "pnpm-lock.yaml"))
	if err != nil {
		return errors.Join(runErr, err)
	}
	if runErr == nil || current.OriginalHash == j.Files[lock].AppliedHash {
		j.Files[lock].Applied, j.Files[lock].AppliedHash = current.Original, current.OriginalHash
		j.Files[lock].Pending = false
	}
	return errors.Join(runErr, saveLinkJournal(j))
}

// Link installs one feature composition and independent actual Go replacements.
// Source package manifests, policies and lockfiles remain standalone inputs.
func (m *Manager) Link(ctx context.Context, name string, opts LinkOptions) (LinkReport, error) {
	if err := opts.Evidence.validate(); err != nil {
		return LinkReport{}, err
	}
	scoped, err := m.linkCommandContext(ctx, name)
	if err != nil {
		return LinkReport{}, err
	}
	ctx = scoped
	w, unlock, err := m.linkWorkspace(ctx, name)
	if err != nil {
		return LinkReport{}, err
	}
	defer unlock()
	j, err := loadLinkJournal(w)
	if err == nil {
		if err = j.Evidence.validateRoots(j.Plan.Roots); err != nil {
			return LinkReport{}, err
		}
		if !sameManifest(j.Manifest, w.Manifest) {
			return LinkReport{}, devcontract.Fail(4, "link_conflict", "workspace selection changed; unlink before linking new selections")
		}
		if err = checkLinkFiles(w.Root, j); err != nil {
			return LinkReport{}, err
		}
		if j.Phase == "linked" {
			if err = devcompose.CheckInputs(*j.Plan.Composition); err != nil {
				return LinkReport{}, err
			}
			if _, err = linkCommand(ctx, w.Root, "pnpm", "-r", "peers", "check", "--json", "--lockfile-only"); err != nil {
				return LinkReport{}, err
			}
			if err = errors.Join(devcompose.CheckInputs(*j.Plan.Composition), checkLinkFiles(w.Root, j)); err != nil {
				return LinkReport{}, err
			}
			return LinkReport{WorkspaceID: j.WorkspaceID, Protocol: j.Evidence.Protocol, Phase: j.Phase, SeedConvergence: j.Plan.Composition.Convergence}, nil
		}
		return LinkReport{}, devcontract.Fail(4, "link_interrupted", "unlink the interrupted dependency transaction before retrying")
	}
	if !os.IsNotExist(err) {
		return LinkReport{}, err
	}
	plan, err := makeLinkPlan(w)
	if err != nil {
		return LinkReport{}, err
	}
	if err = opts.Evidence.validateRoots(plan.Roots); err != nil {
		return LinkReport{}, err
	}
	j = &linkJournal{SchemaVersion: 2, WorkspaceID: w.Manifest.WorkspaceID, Root: w.Root, Phase: "applying", Manifest: w.Manifest, Evidence: opts.Evidence, Plan: plan}
	add := func(path string, transform func([]byte) ([]byte, error)) error {
		e, err := snapshotLinkFile(w.Root, path)
		if err != nil {
			return err
		}
		if transform != nil {
			e.Applied, err = transform(e.Original)
			if err != nil {
				return err
			}
			e.AppliedHash = linkHash(e.Applied, true)
		}
		j.Files = append(j.Files, e)
		return nil
	}
	for _, generated := range plan.Composition.Files {
		e, snapshotErr := snapshotLinkFile(w.Root, generated.Path)
		if snapshotErr != nil {
			return LinkReport{}, snapshotErr
		}
		if e.OriginalExists {
			return LinkReport{}, devcontract.Fail(4, "link_conflict", "aggregate dependency file already exists without composition ownership: "+e.Path)
		}
		e.Applied, e.AppliedHash = generated.Data, linkHash(generated.Data, true)
		j.Files = append(j.Files, e)
	}
	if plan.SDK != "" {
		for _, root := range plan.GoRoots {
			if err = add(filepath.Join(root, "go.mod"), func(raw []byte) ([]byte, error) { return linkSDK(ctx, root, raw, plan.SDK) }); err != nil {
				return LinkReport{}, err
			}
			if err = add(filepath.Join(root, "go.sum"), nil); err != nil {
				return LinkReport{}, err
			}
		}
	}
	if err = applyLinkFiles(j); err != nil {
		return LinkReport{}, err
	}
	if err = installComposition(ctx, w.ResolvedWorkspace, j, linkCommand); err != nil {
		return LinkReport{WorkspaceID: j.WorkspaceID, Protocol: j.Evidence.Protocol, Phase: j.Phase, SeedConvergence: j.Plan.Composition.Convergence}, err
	}
	j.Phase = "linked"
	if err = saveLinkJournal(j); err != nil {
		return LinkReport{}, err
	}
	// Missing exports are legitimate before bootstrap; full resolution belongs
	// after the selected producers have published their distributions.
	return LinkReport{WorkspaceID: j.WorkspaceID, Protocol: j.Evidence.Protocol, Phase: j.Phase, SeedConvergence: j.Plan.Composition.Convergence}, nil
}

// Unlink restores only attested aggregate/Go files and owned outputs. It does not
// independently reinstall any source root or modify its standalone lockfile.
func (m *Manager) Unlink(ctx context.Context, name string) (LinkReport, error) {
	w, unlock, err := m.linkWorkspace(ctx, name)
	if err != nil {
		return LinkReport{}, err
	}
	defer unlock()
	j, err := loadLinkJournal(w)
	if os.IsNotExist(err) {
		return LinkReport{WorkspaceID: w.Manifest.WorkspaceID, Phase: "unlinked"}, nil
	}
	if err != nil {
		return LinkReport{}, err
	}
	if err = checkLinkFiles(w.Root, j); err != nil {
		return LinkReport{}, err
	}
	j.Phase = "unlinking"
	if err = saveLinkJournal(j); err != nil {
		return LinkReport{}, err
	}
	if err = restoreLinkFiles(w.Root, j); err != nil {
		return LinkReport{}, err
	}
	if err = devoutputs.Restore(ctx, w.ResolvedWorkspace); err != nil {
		return LinkReport{}, err
	}
	if err = os.Remove(filepath.Join(w.Root, ".local/links.json")); err != nil {
		return LinkReport{}, err
	}
	return LinkReport{WorkspaceID: w.Manifest.WorkspaceID, Protocol: j.Evidence.Protocol, Phase: "unlinked"}, nil
}

// ResetModulesReport lists the deleted dependency trees. Phase is the link
// phase the reset ran in: "linked" reinstalls through the recorded composition
// writer; "unlinking" only deletes, leaving the interrupted unlink/remove to
// be rerun.
type ResetModulesReport struct {
	WorkspaceID string   `json:"workspaceID"`
	Phase       string   `json:"phase"`
	Removed     []string `json:"removed"`
	Reinstalled bool     `json:"reinstalled"`
}

// ResetModules is the explicit recovery for an externally changed dependency
// tree. In a stopped, linked workspace it deletes every owned modules tree and
// dependency cache (plus stray node_modules at the selected package roots), then
// reinstalls them through the recorded composition writer. During an
// interrupted unlink it only deletes them so the teardown can resume. It never
// adopts foreign bytes and leaves every other repository output untouched.
func (m *Manager) ResetModules(ctx context.Context, name string) (ResetModulesReport, error) {
	w, err := m.Inspect(ctx, name)
	if err != nil {
		return ResetModulesReport{}, err
	}
	// Delete-only recovery never runs the installer or prepares its toolchain.
	// resetModules rechecks the phase under the lifecycle lock.
	if j, journalErr := loadLinkJournal(w); journalErr == nil && j.Phase == "unlinking" {
		return m.resetModules(ctx, name, nil)
	}
	scoped, err := m.linkCommandContext(ctx, name)
	if err != nil {
		return ResetModulesReport{}, err
	}
	return m.resetModules(scoped, name, linkCommand)
}

func (m *Manager) resetModules(ctx context.Context, name string, run func(context.Context, string, string, ...string) ([]byte, error)) (ResetModulesReport, error) {
	w, unlock, err := m.linkWorkspace(ctx, name)
	if err != nil {
		return ResetModulesReport{}, err
	}
	defer unlock()
	j, err := loadLinkJournal(w)
	if os.IsNotExist(err) {
		return ResetModulesReport{}, devcontract.Fail(4, "link_required", "workspace dependencies are not linked; link the workspace before resetting modules")
	}
	if err != nil {
		return ResetModulesReport{}, err
	}
	report := ResetModulesReport{WorkspaceID: w.Manifest.WorkspaceID, Phase: j.Phase}
	var roots []string
	if j.Plan.Composition != nil {
		roots = append(roots, j.Plan.Composition.Root)
		for _, pkg := range j.Plan.Composition.Packages {
			roots = append(roots, pkg.Path)
		}
	}
	for _, consumer := range j.Plan.Consumers {
		roots = append(roots, consumer.Path)
	}
	if j.Phase == "unlinking" {
		// The overlay is partially restored: never reinstall into it. Deleting
		// the dependency trees lets the interrupted unlink/remove resume.
		report.Removed, err = devoutputs.ResetDependencyTrees(ctx, w.ResolvedWorkspace, roots, true)
		return report, err
	}
	if j.Phase != "linked" || j.Plan.Composition == nil {
		return ResetModulesReport{}, devcontract.Fail(4, "link_interrupted", "dependency link is not complete (phase "+j.Phase+"); unlink the interrupted dependency transaction before resetting modules")
	}
	if run == nil {
		return ResetModulesReport{}, devcontract.Fail(4, "link_conflict", "dependency link phase changed during reset-modules; rerun it")
	}
	if !sameManifest(j.Manifest, w.Manifest) {
		return ResetModulesReport{}, devcontract.Fail(4, "link_conflict", "workspace selection changed; unlink before resetting modules")
	}
	// Preflight the reinstall inputs before deleting anything.
	if err = checkLinkFiles(w.Root, j); err != nil {
		return ResetModulesReport{}, err
	}
	if err = devcompose.CheckInputs(*j.Plan.Composition); err != nil {
		return ResetModulesReport{}, err
	}
	if report.Removed, err = devoutputs.ResetDependencyTrees(ctx, w.ResolvedWorkspace, roots, false); err != nil {
		return report, err
	}
	// Same intent phase as Link: an interrupted reinstall is never "linked".
	j.Phase = "applying"
	if err = saveLinkJournal(j); err != nil {
		return report, err
	}
	err = installComposition(ctx, w.ResolvedWorkspace, j, run)
	for _, e := range j.Files {
		if e.Pending {
			// Unverified lock bytes remain explicit unlink recovery.
			return report, err
		}
	}
	// The attested lock is unchanged or reattested; a failed reinstall stays
	// retryable by rerunning reset-modules.
	j.Phase = "linked"
	if err = errors.Join(err, saveLinkJournal(j)); err != nil {
		return report, err
	}
	report.Reinstalled = true
	return report, nil
}

func (m *Manager) InspectLinks(ctx context.Context, name string) (LinkReport, error) {
	w, err := m.Inspect(ctx, name)
	if err != nil {
		return LinkReport{}, err
	}
	j, err := loadLinkJournal(w)
	if os.IsNotExist(err) {
		return LinkReport{WorkspaceID: w.Manifest.WorkspaceID, Phase: "unlinked"}, nil
	}
	if err != nil {
		return LinkReport{}, err
	}
	report := LinkReport{WorkspaceID: j.WorkspaceID, Protocol: j.Evidence.Protocol, Phase: j.Phase, SeedConvergence: j.Plan.Composition.Convergence}
	if err = checkLinkFiles(w.Root, j); err != nil {
		return report, err
	}
	if j.Phase != "linked" {
		return report, nil
	}
	if err = devcompose.CheckInputs(*j.Plan.Composition); err != nil {
		return report, err
	}
	return inspectLinkPlan(ctx, j), nil
}

// LinkEvidence retrieves static native12 protocol proof for stopped
// unlink/reconfigure/relink. It does not attest current source-input readiness:
// Installed and graph/install gates independently require fresh source hashes.
// Workspace identity, completed phase and generated/Go CAS remain mandatory.
func (m *Manager) LinkEvidence(ctx context.Context, name string) (LinkProtocolEvidence, error) {
	w, err := m.Inspect(ctx, name)
	if err != nil {
		return LinkProtocolEvidence{}, err
	}
	j, err := loadLinkJournal(w)
	if err != nil {
		return LinkProtocolEvidence{}, err
	}
	if !sameManifest(j.Manifest, w.Manifest) {
		return LinkProtocolEvidence{}, devcontract.Fail(4, "link_conflict", "workspace selection changed since dependency linking")
	}
	if err = checkLinkFiles(w.Root, j); err != nil {
		return LinkProtocolEvidence{}, err
	}
	if j.Plan.Composition == nil {
		return LinkProtocolEvidence{}, devcontract.Fail(4, "link_interrupted", "dependency composition is absent")
	}
	if j.Phase != "linked" {
		return LinkProtocolEvidence{}, devcontract.Fail(4, "link_interrupted", "dependency link transaction is incomplete")
	}
	if err = j.Evidence.validateRoots(j.Plan.Roots); err != nil {
		return LinkProtocolEvidence{}, err
	}
	return j.Evidence, nil
}

// Resolve package manifests by walking from the resolved public entry rather
// than requiring package.json exports (the UI packages do not all expose it).
const linkResolveScript = `import fs from 'node:fs';import path from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';
const [consumer,specifier,name=specifier]=process.argv.slice(1);
let entry=fileURLToPath(import.meta.resolve(specifier,pathToFileURL(path.join(consumer,'package.json')).href)),dir=path.dirname(fs.realpathSync(entry));
for(;;){const p=path.join(dir,'package.json');if(fs.existsSync(p)){const j=JSON.parse(fs.readFileSync(p));if(j.name===name){console.log(JSON.stringify({path:dir,version:j.version||''}));break;}}const up=path.dirname(dir);if(up===dir)throw Error('manifest not found');dir=up;}`

func inspectLinkPlan(ctx context.Context, j *linkJournal) LinkReport {
	report := LinkReport{WorkspaceID: j.WorkspaceID, Protocol: j.Evidence.Protocol, Phase: j.Phase, Resolutions: []LinkResolution{}, SeedConvergence: j.Plan.Composition.Convergence}
	for _, consumer := range j.Plan.Consumers {
		pkg, err := readLinkPackage(consumer.Path)
		if err != nil {
			report.Resolutions = append(report.Resolutions, LinkResolution{Consumer: consumer.Path, Problem: err.Error()})
			continue
		}
		names := map[string]bool{"react": true, "react-dom": true}
		for _, group := range []string{"dependencies", "devDependencies", "peerDependencies"} {
			if deps, ok := pkg[group].(map[string]any); ok {
				for name := range deps {
					if _, ok = consumer.Targets[name]; ok {
						names[name] = true
					}
				}
			}
		}
		ordered := make([]string, 0, len(names))
		for name := range names {
			ordered = append(ordered, name)
		}
		sort.Strings(ordered)
		for _, name := range ordered {
			target := consumer.Targets[name]
			if name == "react" || name == "react-dom" {
				target = filepath.Join(j.Root, "node_modules", name)
			}
			if target == "" {
				continue
			}
			expected, e := devcontract.CanonicalPath(target)
			specifiers := []string{name}
			if name == "@omniviewdev/runtime" {
				for _, subpath := range []string{"api", "models", "runtime"} {
					specifiers = append(specifiers, name+"/"+subpath)
				}
			}
			for _, specifier := range specifiers {
				r := LinkResolution{Consumer: consumer.Path, Package: specifier, Expected: expected}
				if e != nil {
					r.Problem = e.Error()
				} else {
					raw, resolveErr := linkCommand(ctx, consumer.Path, "node", "--experimental-import-meta-resolve", "--input-type=module", "-e", linkResolveScript, consumer.Path, specifier, name)
					var result struct{ Path, Version string }
					if resolveErr != nil {
						r.Problem = resolveErr.Error()
					} else if resolveErr = json.Unmarshal(raw, &result); resolveErr != nil {
						r.Problem = "invalid node resolution response"
					} else {
						r.Resolved = result.Path
						r.Version = result.Version
						if r.Resolved != r.Expected {
							r.Problem = "resolved package is not the selected feature package"
						}
					}
				}
				report.Resolutions = append(report.Resolutions, r)
			}
		}
	}
	if j.Plan.SDK != "" {
		for _, root := range j.Plan.GoRoots {
			r := LinkResolution{Consumer: root, Package: linkedSDK, Expected: j.Plan.SDK}
			raw, err := linkCommand(ctx, root, "go", "list", "-m", "-json", linkedSDK)
			var module struct {
				Dir, Version string
				Replace      *struct{ Dir, Path, Version string }
			}
			if err != nil {
				r.Problem = err.Error()
			} else if err = json.Unmarshal(raw, &module); err != nil {
				r.Problem = "invalid Go resolution response"
			} else {
				r.Resolved = module.Dir
				r.Version = module.Version
				if module.Replace == nil || module.Replace.Version != "" {
					r.Problem = "SDK does not use a local replacement"
				} else {
					actual, e := devcontract.CanonicalPath(module.Replace.Dir)
					if e != nil || actual != j.Plan.SDK {
						r.Problem = "SDK replacement is not the selected feature SDK"
					}
				}
			}
			report.Resolutions = append(report.Resolutions, r)
		}
	}
	return report
}
