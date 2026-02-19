package helm

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	"github.com/omniviewdev/plugin-sdk/pkg/resource/types"
	pkgtypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	"go.uber.org/zap"
	"helm.sh/helm/v3/pkg/cli"
	"helm.sh/helm/v3/pkg/repo"
)

// RepoResourcer implements Resourcer[clients.ClientSet] for helm::v1::Repository.
type RepoResourcer struct {
	log *zap.SugaredLogger
}

var _ types.Resourcer[clients.ClientSet] = (*RepoResourcer)(nil)

// NewRepoResourcer creates a new RepoResourcer.
func NewRepoResourcer(logger *zap.SugaredLogger) *RepoResourcer {
	return &RepoResourcer{
		log: logger.Named("HelmRepoResourcer"),
	}
}

func repoFile() string {
	settings := cli.New()
	return settings.RepositoryConfig
}

func loadRepoFile() (*repo.File, error) {
	path := repoFile()
	f, err := repo.LoadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return repo.NewFile(), nil
		}
		return nil, fmt.Errorf("failed to load repo file: %w", err)
	}
	return f, nil
}

func repoEntryToMap(entry *repo.Entry) map[string]interface{} {
	return map[string]interface{}{
		"name":                  entry.Name,
		"url":                   entry.URL,
		"username":              entry.Username,
		"certFile":              entry.CertFile,
		"keyFile":               entry.KeyFile,
		"caFile":                entry.CAFile,
		"insecure_skip_tls_verify": entry.InsecureSkipTLSverify,
		"pass_credentials_all":  entry.PassCredentialsAll,
	}
}

func (r *RepoResourcer) Get(
	_ *pkgtypes.PluginContext,
	_ *clients.ClientSet,
	_ types.ResourceMeta,
	input types.GetInput,
) (*types.GetResult, error) {
	f, err := loadRepoFile()
	if err != nil {
		return nil, err
	}

	for _, entry := range f.Repositories {
		if entry.Name == input.ID {
			return &types.GetResult{
				Result:  repoEntryToMap(entry),
				Success: true,
			}, nil
		}
	}

	return nil, fmt.Errorf("repository %s not found", input.ID)
}

func (r *RepoResourcer) List(
	_ *pkgtypes.PluginContext,
	_ *clients.ClientSet,
	_ types.ResourceMeta,
	_ types.ListInput,
) (*types.ListResult, error) {
	f, err := loadRepoFile()
	if err != nil {
		return nil, err
	}

	result := make([]map[string]interface{}, 0, len(f.Repositories))
	for _, entry := range f.Repositories {
		result = append(result, repoEntryToMap(entry))
	}

	return &types.ListResult{
		Result:  result,
		Success: true,
	}, nil
}

func (r *RepoResourcer) Find(
	ctx *pkgtypes.PluginContext,
	client *clients.ClientSet,
	meta types.ResourceMeta,
	input types.FindInput,
) (*types.FindResult, error) {
	listResult, err := r.List(ctx, client, meta, types.ListInput{})
	if err != nil {
		return nil, err
	}
	return &types.FindResult{
		Result:  listResult.Result,
		Success: listResult.Success,
	}, nil
}

func (r *RepoResourcer) Create(
	_ *pkgtypes.PluginContext,
	_ *clients.ClientSet,
	_ types.ResourceMeta,
	input types.CreateInput,
) (*types.CreateResult, error) {
	name, _ := input.Input["name"].(string)
	url, _ := input.Input["url"].(string)

	if name == "" || url == "" {
		return nil, fmt.Errorf("name and url are required")
	}

	f, err := loadRepoFile()
	if err != nil {
		return nil, err
	}

	if f.Has(name) {
		return nil, fmt.Errorf("repository %s already exists", name)
	}

	entry := &repo.Entry{
		Name: name,
		URL:  url,
	}

	// Download the index to validate the repo.
	settings := cli.New()
	chartRepo, err := repo.NewChartRepository(entry, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create chart repository: %w", err)
	}
	chartRepo.CachePath = settings.RepositoryCache

	if _, err := chartRepo.DownloadIndexFile(); err != nil {
		return nil, fmt.Errorf("failed to download index for %s: %w", url, err)
	}

	f.Update(entry)
	if err := f.WriteFile(repoFile(), 0644); err != nil {
		return nil, fmt.Errorf("failed to write repo file: %w", err)
	}

	return &types.CreateResult{
		Result:  repoEntryToMap(entry),
		Success: true,
	}, nil
}

func (r *RepoResourcer) Update(
	_ *pkgtypes.PluginContext,
	_ *clients.ClientSet,
	_ types.ResourceMeta,
	_ types.UpdateInput,
) (*types.UpdateResult, error) {
	return nil, fmt.Errorf("use the 'refresh' action to update a repository")
}

func (r *RepoResourcer) Delete(
	_ *pkgtypes.PluginContext,
	_ *clients.ClientSet,
	_ types.ResourceMeta,
	input types.DeleteInput,
) (*types.DeleteResult, error) {
	f, err := loadRepoFile()
	if err != nil {
		return nil, err
	}

	if !f.Remove(input.ID) {
		return nil, fmt.Errorf("repository %s not found", input.ID)
	}

	if err := f.WriteFile(repoFile(), 0644); err != nil {
		return nil, fmt.Errorf("failed to write repo file: %w", err)
	}

	// Also remove cached index.
	settings := cli.New()
	indexPath := filepath.Join(settings.RepositoryCache, input.ID+"-index.yaml")
	_ = os.Remove(indexPath)

	return &types.DeleteResult{
		Result:  map[string]interface{}{"name": input.ID},
		Success: true,
	}, nil
}

// RepoActionResourcer implements ActionResourcer for repos.
type RepoActionResourcer struct {
	inner *RepoResourcer
}

var _ types.ActionResourcer[clients.ClientSet] = (*RepoResourcerWithActions)(nil)

// RepoResourcerWithActions combines RepoResourcer with action support.
type RepoResourcerWithActions struct {
	RepoResourcer
}

func NewRepoResourcerWithActions(logger *zap.SugaredLogger) *RepoResourcerWithActions {
	return &RepoResourcerWithActions{
		RepoResourcer: *NewRepoResourcer(logger),
	}
}

func (r *RepoResourcerWithActions) GetActions(
	_ *pkgtypes.PluginContext,
	_ *clients.ClientSet,
	_ types.ResourceMeta,
) ([]types.ActionDescriptor, error) {
	return []types.ActionDescriptor{
		{
			ID:          "refresh",
			Label:       "Refresh Repository",
			Description: "Re-download the repository index",
			Icon:        "LuRefreshCw",
			Scope:       types.ActionScopeInstance,
		},
	}, nil
}

func (r *RepoResourcerWithActions) ExecuteAction(
	_ *pkgtypes.PluginContext,
	_ *clients.ClientSet,
	_ types.ResourceMeta,
	actionID string,
	input types.ActionInput,
) (*types.ActionResult, error) {
	if actionID != "refresh" {
		return nil, fmt.Errorf("unknown action: %s", actionID)
	}

	f, err := loadRepoFile()
	if err != nil {
		return nil, err
	}

	var entry *repo.Entry
	for _, e := range f.Repositories {
		if e.Name == input.ID {
			entry = e
			break
		}
	}
	if entry == nil {
		return nil, fmt.Errorf("repository %s not found", input.ID)
	}

	settings := cli.New()
	chartRepo, err := repo.NewChartRepository(entry, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create chart repository: %w", err)
	}
	chartRepo.CachePath = settings.RepositoryCache

	indexPath, err := chartRepo.DownloadIndexFile()
	if err != nil {
		return nil, fmt.Errorf("failed to refresh %s: %w", entry.Name, err)
	}

	return &types.ActionResult{
		Success: true,
		Data: map[string]interface{}{
			"indexPath":   indexPath,
			"refreshedAt": time.Now().Format(time.RFC3339),
		},
		Message: fmt.Sprintf("Repository %s refreshed", entry.Name),
	}, nil
}

func (r *RepoResourcerWithActions) StreamAction(
	_ *pkgtypes.PluginContext,
	_ *clients.ClientSet,
	_ types.ResourceMeta,
	_ string,
	_ types.ActionInput,
	_ chan types.ActionEvent,
) error {
	return fmt.Errorf("streaming actions not supported for repositories")
}
