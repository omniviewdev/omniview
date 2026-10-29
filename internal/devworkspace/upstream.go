package devworkspace

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"hash"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"gopkg.in/yaml.v3"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devoutputs"
	"github.com/omniviewdev/omniview/internal/devsource"
)

const (
	upstreamExitUsage     = 2
	upstreamExitBlocked   = 4
	upstreamFetchTimeout  = 30 * time.Second
	updateBlocked         = "blocked"
	updateBehind          = "behind"
	updatePinned          = "pinned"
	updateAvailable       = "update_available"
	upstreamMissing       = "upstream_missing"
	updateDivergent       = "divergent"
	upstreamWorkspaceFile = "pnpm-workspace.yaml"
	upstreamLockfile      = "pnpm-lock.yaml"
)

type UpdatePlan struct {
	WorkspaceID              string                 `json:"workspaceID"`
	OperationID              string                 `json:"operationID"`
	Result                   string                 `json:"result"`
	Repositories             []RepositoryUpdatePlan `json:"repositories"`
	CompositionFingerprint   string                 `json:"compositionFingerprint"`
	ConfigurationFingerprint string                 `json:"configurationFingerprint"`
	DependencyChanged        bool                   `json:"dependencyChanged"`
	NextCommand              string                 `json:"nextCommand,omitempty"`
	NextArgv                 []string               `json:"nextArgv,omitempty"`
}

type RepositoryUpdatePlan struct {
	ID                   string                        `json:"id"`
	SelectionKind        string                        `json:"selectionKind"`
	Remote               string                        `json:"remote,omitempty"`
	Branch               string                        `json:"branch,omitempty"`
	OldSHA               string                        `json:"oldSHA"`
	TargetSHA            string                        `json:"targetSHA,omitempty"`
	ActualHEAD           string                        `json:"actualHEAD,omitempty"`
	Classification       string                        `json:"classification"`
	TreesEqual           bool                          `json:"treesEqual"`
	BlockerPaths         []string                      `json:"blockerPaths,omitempty"`
	BlockedReason        string                        `json:"blockedReason,omitempty"`
	ConfigurationChoices []UpstreamConfigurationChoice `json:"configurationChoices,omitempty"`
}

type UpstreamConfigurationChoice struct {
	Remote      string   `json:"remote"`
	Branch      string   `json:"branch"`
	NextArgv    []string `json:"nextArgv"`
	NextCommand string   `json:"nextCommand"`
}

// ResolveRepositoryUpstream migrates only explicit remote-qualified selections.
// A plain local branch never acquires remote semantics through name guessing.
func ResolveRepositoryUpstream(
	ctx context.Context, common string, repository devcontract.Repository,
) (*devcontract.RepositoryUpstream, error) {
	if repository.Upstream != nil {
		configured := *repository.Upstream
		if err := configured.Validate(); err != nil {
			return nil, err
		}
		if _, err := git(ctx, common, "", "remote", "get-url", configured.Remote); err != nil {
			return nil, devcontract.Fail(upstreamExitBlocked, upstreamMissing, "configured upstream remote is missing")
		}
		return &configured, nil
	}
	var absent *devcontract.RepositoryUpstream
	if IsPinnedRef(repository.BaseRef) || strings.HasPrefix(repository.BaseRef, "refs/heads/") ||
		strings.HasPrefix(repository.BaseRef, "refs/tags/") {
		return absent, nil
	}
	ref := strings.TrimPrefix(repository.BaseRef, "refs/remotes/")
	remote, branch, ok := strings.Cut(ref, "/")
	if !ok {
		return absent, nil
	}
	upstream := devcontract.RepositoryUpstream{Remote: remote, Branch: "refs/heads/" + branch}
	if err := upstream.Validate(); err != nil {
		return nil, err
	}
	remotes, err := git(ctx, common, "", "remote")
	if err != nil {
		return nil, err
	}
	for _, name := range strings.Split(remotes, "\n") {
		if name == remote {
			return &upstream, nil
		}
	}
	return absent, nil
}

func UpdateConfigurationFingerprint(manifest devcontract.WorkspaceManifest) string {
	raw, _ := json.Marshal(manifest)
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

// PlanUpdate fetches selected branches but never changes a checkout, journal or runtime.
// Mutation authority and captured-state revalidation remain the apply transaction's job.
func (m *Manager) PlanUpdate(ctx context.Context, name string, options UpdateOptions) (UpdatePlan, error) {
	var plan UpdatePlan
	w, err := m.Inspect(ctx, name)
	if err != nil {
		return plan, err
	}
	j, err := loadJournal(w.Root)
	if err != nil {
		return plan, err
	}
	if j.WorkspaceID != w.Manifest.WorkspaceID || !sameManifest(j.Manifest, w.Manifest) {
		return plan, devcontract.Fail(upstreamExitBlocked, "ownership_changed",
			"workspace manifest differs from ownership journal")
	}
	selected, err := selectedUpdateRepositories(w.Manifest, options.Repositories)
	if err != nil {
		return plan, err
	}
	plan.WorkspaceID = w.Manifest.WorkspaceID
	plan.OperationID = uuid.NewString()
	plan.Result = "up_to_date"
	overlays, err := plannerOwnedOverlays(ctx, w)
	if err != nil {
		return plan, err
	}
	plan.ConfigurationFingerprint = UpdateConfigurationFingerprint(w.Manifest)
	fingerprint := sha256.New()
	mapping, _ := json.Marshal(struct {
		Links   devcontract.Links    `json:"Links"`
		Plugins []devcontract.Plugin `json:"Plugins"`
	}{w.Manifest.Links, w.Manifest.Plugins})
	fingerprint.Write(mapping)
	if err = m.planUpdateCohort(ctx, name, w, j.Resources, selected, overlays, fingerprint, &plan); err != nil {
		return plan, err
	}
	plan.CompositionFingerprint = hex.EncodeToString(fingerprint.Sum(nil))
	if updatePlanBlocked(plan) {
		plan.Result = updateBlocked
		plan.NextArgv = []string{"omniview-dev", "workspace", "update", name, "--root", m.Root, "--check", "--json"}
		plan.NextCommand = shellCommand(plan.NextArgv)
	}
	return plan, nil
}

func (m *Manager) planUpdateCohort(
	ctx context.Context, name string, w Workspace, resources []resource,
	selected map[string]bool, overlays map[string]string, fingerprint hash.Hash, plan *UpdatePlan,
) error {
	for _, repository := range w.Manifest.Repositories {
		owned := ownedUpdateResource(resources, repository.ID)
		if len(selected) > 0 && !selected[repository.ID] {
			fingerprintErr := fingerprintUnselectedRepository(ctx, fingerprint, owned, repository.ID)
			if fingerprintErr != nil {
				return fingerprintErr
			}
			continue
		}
		p, err := m.planOwnedRepository(ctx, name, w, owned, repository, overlays)
		if err != nil {
			return err
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if p.Classification == updateBehind {
			plan.Result = updateAvailable
		}
		if fingerprintPlannedRepository(ctx, fingerprint, owned, &p) {
			plan.DependencyChanged = true
		}
		plan.Repositories = append(plan.Repositories, p)
	}
	return nil
}

func selectedUpdateRepositories(manifest devcontract.WorkspaceManifest, ids []string) (map[string]bool, error) {
	selected := make(map[string]bool, len(ids))
	for _, id := range ids {
		selected[id] = true
	}
	known := make(map[string]bool, len(manifest.Repositories))
	for _, repository := range manifest.Repositories {
		known[repository.ID] = true
	}
	for id := range selected {
		if !known[id] {
			return nil, devcontract.Fail(upstreamExitUsage, "unknown_repository",
				"update repository is not selected in workspace")
		}
	}
	return selected, nil
}

func ownedUpdateResource(resources []resource, id string) *resource {
	for i := range resources {
		if resources[i].Repository.ID == id && !resources[i].Removed {
			return &resources[i]
		}
	}
	return nil
}

func newRepositoryUpdatePlan(repository devcontract.Repository) RepositoryUpdatePlan {
	var plan RepositoryUpdatePlan
	plan.ID = repository.ID
	plan.OldSHA = repository.BaseCommit
	plan.SelectionKind = "branch"
	return plan
}

func fingerprintUnselectedRepository(ctx context.Context, fingerprint hash.Hash, owned *resource, id string) error {
	if owned == nil {
		return nil
	}
	head := refValue(ctx, owned.Path, "HEAD")
	inputs, err := upstreamDependencyFingerprint(ctx, owned.CommonDir, head)
	if err != nil {
		return devcontract.Fail(upstreamExitBlocked, "dependency_inputs_unreadable",
			"cannot inspect unselected composition source")
	}
	fmt.Fprintf(fingerprint, "%s\x00%s\x00", id, inputs)
	return nil
}

func (m *Manager) planOwnedRepository(
	ctx context.Context, name string, w Workspace, owned *resource,
	repository devcontract.Repository, overlays map[string]string,
) (RepositoryUpdatePlan, error) {
	if owned == nil {
		p := newRepositoryUpdatePlan(repository)
		p.Classification = followUnreachable
		p.BlockedReason = "ownership_changed"
		return p, nil
	}
	p := m.planRepository(ctx, w, *owned, repository, overlays)
	if p.BlockedReason != "upstream_not_configured" {
		return p, nil
	}
	remotes, err := git(ctx, owned.CommonDir, "", "remote")
	if err != nil {
		return p, err
	}
	branch := strings.TrimPrefix(repository.BaseRef, "refs/heads/")
	for _, remote := range strings.Split(remotes, "\n") {
		if remote == "" {
			continue
		}
		argv := []string{
			"omniview-dev", "workspace", "edit", name, "--root", m.Root,
			"--upstream", repository.ID + "=" + remote + "/" + branch,
		}
		p.ConfigurationChoices = append(p.ConfigurationChoices, UpstreamConfigurationChoice{
			Remote: remote, Branch: "refs/heads/" + branch, NextArgv: argv, NextCommand: shellCommand(argv),
		})
	}
	return p, nil
}

func fingerprintPlannedRepository(
	ctx context.Context, fingerprint hash.Hash, owned *resource, p *RepositoryUpdatePlan,
) bool {
	if owned == nil || p.ActualHEAD == "" {
		return false
	}
	old, err := upstreamDependencyFingerprint(ctx, owned.CommonDir, p.ActualHEAD)
	if err != nil {
		p.BlockedReason = "dependency_inputs_unreadable"
	}
	target := p.TargetSHA
	if target == "" {
		target = p.ActualHEAD
	}
	next, err := upstreamDependencyFingerprint(ctx, owned.CommonDir, target)
	if err != nil {
		p.BlockedReason = "dependency_inputs_unreadable"
	}
	fmt.Fprintf(fingerprint, "%s\x00%s\x00", p.ID, next)
	return old != next
}

func updatePlanBlocked(plan UpdatePlan) bool {
	for _, repository := range plan.Repositories {
		if repository.BlockedReason != "" {
			return true
		}
	}
	return false
}

func (m *Manager) planRepository(
	ctx context.Context, w Workspace, r resource, repository devcontract.Repository, overlays map[string]string,
) RepositoryUpdatePlan {
	p := newRepositoryUpdatePlan(repository)
	if err := verifyWorktree(ctx, &r, false); err != nil {
		p.Classification = followUnreachable
		p.BlockedReason = "ownership_changed"
		return p
	}
	p.ActualHEAD = refValue(ctx, r.Path, "HEAD")
	paths, err := upstreamDirtyPaths(ctx, r, overlays)
	if err != nil {
		p.BlockedReason = "git_state_unreadable"
	}
	p.BlockerPaths = paths
	if len(paths) > 0 {
		p.BlockedReason = "dirty_worktree"
	}
	if IsPinnedRef(repository.BaseRef) {
		p.SelectionKind = "commit"
		p.Classification = updatePinned
		p.TargetSHA = p.ActualHEAD
		return p
	}
	tag := strings.TrimPrefix(repository.BaseRef, "refs/tags/")
	if refValue(ctx, r.CommonDir, "refs/tags/"+tag) != "" {
		p.SelectionKind = "tag"
		p.Classification = updatePinned
		p.TargetSHA = p.ActualHEAD
		return p
	}
	return planTrackingRepository(ctx, w, r, repository, p)
}

func planTrackingRepository(
	ctx context.Context, w Workspace, r resource, repository devcontract.Repository, p RepositoryUpdatePlan,
) RepositoryUpdatePlan {
	upstream, err := ResolveRepositoryUpstream(ctx, r.CommonDir, repository)
	if err != nil {
		p.Classification = upstreamMissing
		p.BlockedReason = upstreamMissing
		return p
	}
	if upstream == nil {
		p.Classification = upstreamMissing
		p.BlockedReason = "upstream_not_configured"
		return p
	}
	p.Remote, p.Branch = upstream.Remote, upstream.Branch
	fetchCtx, cancel := context.WithTimeout(ctx, upstreamFetchTimeout)
	defer cancel()
	tracking := "refs/remotes/" + upstream.Remote + "/" + strings.TrimPrefix(upstream.Branch, "refs/heads/")
	err = fetchSelectedBranch(fetchCtx, r.CommonDir, upstream.Remote,
		strings.TrimPrefix(upstream.Branch, "refs/heads/"), tracking)
	if err != nil {
		p.Classification = followUnreachable
		p.BlockedReason = "upstream_fetch_failed"
		var failure *devcontract.Error
		if errors.As(err, &failure) && failure.Code == upstreamMissing {
			p.Classification = upstreamMissing
			p.BlockedReason = upstreamMissing
		}
		return p
	}
	p.TargetSHA = refValue(ctx, r.CommonDir, tracking+"^{commit}")
	if p.TargetSHA == "" {
		p.Classification = upstreamMissing
		p.BlockedReason = upstreamMissing
		return p
	}
	p.TreesEqual = refValue(ctx, r.CommonDir, p.ActualHEAD+"^{tree}") ==
		refValue(ctx, r.CommonDir, p.TargetSHA+"^{tree}")
	classifyUpstreamAncestry(ctx, r, &p)
	validatePlannedSDK(ctx, w, r, repository.ID, &p)
	validatePlannedPlugins(ctx, w, r, repository.ID, &p)
	return p
}

func classifyUpstreamAncestry(ctx context.Context, r resource, p *RepositoryUpdatePlan) {
	if p.ActualHEAD == p.TargetSHA {
		p.Classification = "current"
		return
	}
	if _, err := git(ctx, r.CommonDir, "", "merge-base", "--is-ancestor", p.ActualHEAD, p.TargetSHA); err == nil {
		p.Classification = updateBehind
		return
	}
	if _, err := git(ctx, r.CommonDir, "", "merge-base", "--is-ancestor", p.TargetSHA, p.ActualHEAD); err == nil {
		p.Classification = "ahead"
		if p.BlockedReason == "" {
			p.BlockedReason = "user_commits"
		}
		return
	}
	p.Classification = updateDivergent
	if p.BlockedReason == "" {
		p.BlockedReason = "non_fast_forward"
	}
}

func validatePlannedSDK(ctx context.Context, w Workspace, r resource, id string, p *RepositoryUpdatePlan) {
	if w.Manifest.Links.SDKRepositoryID == nil || id != *w.Manifest.Links.SDKRepositoryID ||
		p.ActualHEAD == p.TargetSHA {
		return
	}
	launch, err := LoadLaunchOptions(w)
	if err != nil || launch.ReviewedSDKRevision == "" {
		p.BlockedReason = "reviewed_sdk_required"
		return
	}
	err = devsource.VerifyUpstreamCommit(ctx, r.CommonDir, launch.ReviewedSDKRevision, p.TargetSHA,
		devsource.VerifyOptions{AllowIsolationCoreChanges: launch.AllowIsolationSourceChanges})
	if err != nil {
		p.BlockedReason = "sdk_source_untrusted"
	}
}

func validatePlannedPlugins(ctx context.Context, w Workspace, r resource, id string, p *RepositoryUpdatePlan) {
	for _, plugin := range w.Manifest.Plugins {
		if plugin.RepositoryID != id {
			continue
		}
		raw, err := git(ctx, r.CommonDir, "", "show", p.TargetSHA+":plugin.yaml")
		var meta struct {
			ID string `yaml:"id"`
		}
		if err != nil || yaml.Unmarshal([]byte(raw), &meta) != nil || meta.ID != plugin.ID {
			p.BlockedReason = "plugin_identity_changed"
			p.BlockerPaths = append(p.BlockerPaths, "plugin.yaml")
		}
	}
}

// Hash tree entries, not checkout overlays or generated member lockfiles. Object
// IDs bind both policy bytes and path identity without reading private contents.
func upstreamDependencyFingerprint(ctx context.Context, common, commit string) (string, error) {
	entries, err := git(ctx, common, "", "ls-tree", "-rz", "--full-tree", commit)
	if err != nil {
		return "", err
	}
	records := strings.Split(entries, "\x00")
	workspaceRoots := map[string]bool{".": true}
	for _, entry := range records {
		_, path, ok := strings.Cut(entry, "\t")
		if ok && filepath.Base(path) == upstreamWorkspaceFile {
			workspaceRoots[filepath.Dir(path)] = true
		}
	}
	hash := sha256.New()
	for _, entry := range records {
		_, path, ok := strings.Cut(entry, "\t")
		if !ok {
			continue
		}
		base := filepath.Base(path)
		authority := upstreamDependencyAuthority(path)
		if base == upstreamLockfile && workspaceRoots[filepath.Dir(path)] {
			authority = true
		}
		if authority {
			fmt.Fprintln(hash, entry)
		}
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func upstreamDependencyAuthority(path string) bool {
	switch filepath.Base(path) {
	case "package.json", "go.mod", "go.sum", "go.work", "go.work.sum", upstreamWorkspaceFile,
		".npmrc", ".pnpmfile.cjs", ".pnpmfile.mjs", ".node-version", ".nvmrc":
		return true
	default:
		return strings.HasSuffix(path, ".patch")
	}
}

func upstreamDirtyPaths(ctx context.Context, r resource, overlays map[string]string) ([]string, error) {
	dirty, err := git(ctx, r.Path, "", "status", "--porcelain=v2", "-z", "--untracked-files=all", "--ignored=matching")
	if err != nil {
		return nil, err
	}
	var paths []string
	records := strings.Split(dirty, "\x00")
	for i := 0; i < len(records); i++ {
		record := records[i]
		if record == "" {
			continue
		}
		path, xy, parseErr := parseUpstreamStatusRecord(record)
		if parseErr != nil {
			return nil, parseErr
		}
		if upstreamStatusOwned(r.Path, path, xy, record[0], overlays) {
			continue
		}
		paths = append(paths, path)
		if record[0] == '2' {
			i++
			if i < len(records) {
				paths = append(paths, records[i])
			}
		}
	}
	sort.Strings(paths)
	return paths, nil
}

func parseUpstreamStatusRecord(record string) (string, string, error) {
	const (
		untrackedPrefixLength = 3
		ordinaryFields        = 9
		renamedFields         = 10
		unmergedFields        = 11
	)
	switch record[0] {
	case '?', '!':
		if len(record) < untrackedPrefixLength {
			return "", "", devcontract.Fail(upstreamExitBlocked, "git_state_unreadable", "malformed Git status")
		}
		return record[2:], "", nil
	case '1', '2', 'u':
		count := ordinaryFields
		if record[0] == '2' {
			count = renamedFields
		}
		if record[0] == 'u' {
			count = unmergedFields
		}
		fields := strings.SplitN(record, " ", count)
		if len(fields) != count {
			return "", "", devcontract.Fail(upstreamExitBlocked, "git_state_unreadable", "malformed Git status")
		}
		return fields[count-1], fields[1], nil
	default:
		return "", "", devcontract.Fail(upstreamExitBlocked, "git_state_unreadable", "unknown Git status")
	}
}

func upstreamStatusOwned(root, path, xy string, kind byte, overlays map[string]string) bool {
	if xy == ".M" && overlays[filepath.Join(root, path)] != "" {
		return true
	}
	if xy != ".M" && xy != ".D" && kind != '?' && kind != '!' {
		return false
	}
	full := filepath.Join(root, filepath.FromSlash(strings.TrimSuffix(path, "/")))
	for boundary, ownership := range overlays {
		if ownership == "owned_output" && (full == boundary || inside(boundary, full)) {
			return true
		}
	}
	return false
}

func plannerCleanWorktree(ctx context.Context, w Workspace, r resource) error {
	overlays, err := plannerOwnedOverlays(ctx, w)
	if err != nil {
		return err
	}
	paths, err := upstreamDirtyPaths(ctx, r, overlays)
	if err != nil {
		return err
	}
	if len(paths) > 0 {
		return devcontract.Fail(upstreamExitBlocked, "dirty_worktree",
			"worktree has authored or unknown changes: "+strings.Join(paths, ", "))
	}
	return nil
}

func plannerOwnedOverlays(ctx context.Context, w Workspace) (map[string]string, error) {
	overlays := map[string]string{}
	links, err := loadLinkJournal(w)
	if err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	if err == nil {
		if links.Phase != "linked" {
			return nil, devcontract.Fail(upstreamExitBlocked, "link_conflict",
				"dependency overlay transaction is unfinished")
		}
		for _, file := range links.Files {
			current, e := snapshotLinkFile(w.Root, filepath.Join(w.Root, file.Path))
			if e != nil {
				return nil, e
			}
			if !file.Pending && current.OriginalHash == file.AppliedHash {
				overlays[filepath.Join(w.Root, file.Path)] = file.AppliedHash
			}
		}
	}
	paths, err := devoutputs.ValidatedOwnedPaths(ctx, w.ResolvedWorkspace)
	if err != nil {
		return nil, err
	}
	for _, path := range paths {
		overlays[path] = "owned_output"
	}
	return overlays, nil
}
