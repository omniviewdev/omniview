package devworkspace

import (
	"context"
	"path/filepath"
	"strings"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

// ConfigureUpstreams uses the same owned lifecycle transaction as an edit.
func (m *Manager) ConfigureUpstreams(ctx context.Context, name string, values map[string]string) (Workspace, error) {
	var options EditOptions
	options.Upstreams = values
	return m.Edit(ctx, name, options)
}

// configureManifestUpstreams validates the entire policy before lifecycle mutation.
func configureManifestUpstreams(
	ctx context.Context, registry Registry, manifest *devcontract.WorkspaceManifest, values map[string]string,
) error {
	pending := make(map[string]string, len(values))
	for id, value := range values {
		pending[id] = value
	}
	for i := range manifest.Repositories {
		repository := &manifest.Repositories[i]
		value, supplied := pending[repository.ID]
		if !supplied {
			continue
		}
		delete(pending, repository.ID)
		path := ""
		for _, source := range registry.Repositories {
			if source.ID == repository.ID {
				path = source.CommonDir
				break
			}
		}
		if path == "" {
			return devcontract.Fail(upstreamExitUsage, "unselected_repository", "upstream repository is not registered")
		}
		upstream, err := validateUpstreamSelection(ctx, path, value)
		if err != nil {
			return err
		}
		repository.Upstream = upstream
	}
	if len(pending) > 0 {
		return devcontract.Fail(upstreamExitUsage, "unselected_repository",
			"upstream repository must belong to selected workspace")
	}
	return manifest.Validate()
}

func validateUpstreamSelection(ctx context.Context, path, value string) (*devcontract.RepositoryUpstream, error) {
	remote, branch, ok := strings.Cut(value, "/")
	if !ok || remote == "" || branch == "" || strings.HasPrefix(remote, "-") ||
		strings.ContainsAny(remote, "\\\x00\r\n:") {
		return nil, devcontract.Fail(upstreamExitUsage, "invalid_upstream",
			"upstream must be a named remote and branch: repository=origin/main")
	}
	if !strings.HasPrefix(branch, "refs/heads/") {
		branch = "refs/heads/" + branch
	}
	upstream := &devcontract.RepositoryUpstream{Remote: remote, Branch: branch}
	if err := upstream.Validate(); err != nil {
		return nil, err
	}
	if _, err := git(ctx, path, "", "check-ref-format", branch); err != nil {
		return nil, devcontract.Fail(upstreamExitUsage, "invalid_upstream", "upstream branch is not a valid full branch ref")
	}
	if _, err := git(ctx, path, "", "remote", "get-url", remote); err != nil {
		return nil, devcontract.Fail(upstreamExitUsage, "invalid_upstream",
			"upstream remote is not configured in the selected repository")
	}
	return upstream, nil
}

func (m *Manager) preflightUpstreamEdit(ctx context.Context, before Workspace, options EditOptions) error {
	if len(options.Upstreams) == 0 {
		return nil
	}
	selected := map[string]string{}
	for _, repository := range before.Manifest.Repositories {
		selected[repository.ID] = filepath.Join(before.Root, repository.Directory)
	}
	registry, err := LoadRegistry(ctx, m.Root)
	if err != nil {
		return err
	}
	for _, id := range options.AddRepositories {
		for _, source := range registry.Repositories {
			if source.ID == id {
				selected[id] = source.CommonDir
			}
		}
	}
	for _, id := range options.RemoveRepositories {
		delete(selected, id)
	}
	for id, value := range options.Upstreams {
		path, ok := selected[id]
		if !ok {
			return devcontract.Fail(upstreamExitUsage, "unselected_repository",
				"upstream repository must belong to final workspace selection")
		}
		if _, err = validateUpstreamSelection(ctx, path, value); err != nil {
			return err
		}
	}
	return nil
}
