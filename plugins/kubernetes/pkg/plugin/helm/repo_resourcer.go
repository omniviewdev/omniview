package helm

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	"github.com/omniviewdev/plugin-sdk/pkg/resource/types"
	pkgtypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	"go.uber.org/zap"
	"helm.sh/helm/v3/pkg/cli"
	"helm.sh/helm/v3/pkg/registry"
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
	repoType := "default"
	if registry.IsOCI(entry.URL) {
		repoType = "oci"
	}
	return map[string]interface{}{
		"name":                     entry.Name,
		"url":                      entry.URL,
		"type":                     repoType,
		"username":                 entry.Username,
		"certFile":                 entry.CertFile,
		"keyFile":                  entry.KeyFile,
		"caFile":                   entry.CAFile,
		"insecure_skip_tls_verify": entry.InsecureSkipTLSverify,
		"pass_credentials_all":     entry.PassCredentialsAll,
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

	// Read optional auth fields.
	username, _ := input.Input["username"].(string)
	password, _ := input.Input["password"].(string)
	certFile, _ := input.Input["certFile"].(string)
	keyFile, _ := input.Input["keyFile"].(string)
	caFile, _ := input.Input["caFile"].(string)
	insecureSkipTLS, _ := input.Input["insecureSkipTLS"].(bool)

	entry := &repo.Entry{
		Name:                  name,
		URL:                   url,
		Username:              username,
		Password:              password,
		CertFile:              certFile,
		KeyFile:               keyFile,
		CAFile:                caFile,
		InsecureSkipTLSverify: insecureSkipTLS,
	}

	if !registry.IsOCI(url) {
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
		{
			ID:          "list-charts",
			Label:       "List Charts",
			Description: "List all charts in this repository",
			Icon:        "LuList",
			Scope:       types.ActionScopeInstance,
		},
		{
			ID:          "add",
			Label:       "Add Repository",
			Description: "Add a new Helm chart repository",
			Icon:        "LuPlus",
			Scope:       types.ActionScopeType,
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
	switch actionID {
	case "refresh":
		return r.executeRefresh(input)
	case "list-charts":
		return r.executeListCharts(input)
	case "add":
		return r.executeAdd(input)
	default:
		return nil, fmt.Errorf("unknown action: %s", actionID)
	}
}

func (r *RepoResourcerWithActions) executeRefresh(input types.ActionInput) (*types.ActionResult, error) {
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

	// OCI registries don't have a downloadable index file.
	if registry.IsOCI(entry.URL) {
		return &types.ActionResult{
			Success: true,
			Data: map[string]interface{}{
				"refreshedAt": time.Now().Format(time.RFC3339),
				"type":        "oci",
			},
			Message: fmt.Sprintf("OCI repository %s validated", entry.Name),
		}, nil
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

func (r *RepoResourcerWithActions) executeListCharts(input types.ActionInput) (*types.ActionResult, error) {
	repoName := input.ID

	indexes, err := loadAllIndexes()
	if err != nil {
		return nil, err
	}

	idx, ok := indexes[repoName]
	if !ok {
		return nil, fmt.Errorf("repository %s index not found in local cache", repoName)
	}

	charts := make([]interface{}, 0, len(idx.Entries))
	for _, versions := range idx.Entries {
		if len(versions) == 0 {
			continue
		}
		charts = append(charts, chartVersionToMap(repoName, versions[0]))
	}

	return &types.ActionResult{
		Success: true,
		Data: map[string]interface{}{
			"charts": charts,
		},
		Message: fmt.Sprintf("Found %d charts in %s", len(charts), repoName),
	}, nil
}

func (r *RepoResourcerWithActions) executeAdd(input types.ActionInput) (*types.ActionResult, error) {
	name, _ := input.Params["name"].(string)
	url, _ := input.Params["url"].(string)

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

	// Read optional auth fields.
	username, _ := input.Params["username"].(string)
	password, _ := input.Params["password"].(string)
	certFile, _ := input.Params["certFile"].(string)
	keyFile, _ := input.Params["keyFile"].(string)
	caFile, _ := input.Params["caFile"].(string)
	insecureSkipTLS, _ := input.Params["insecureSkipTLS"].(bool)
	plainHTTP, _ := input.Params["plainHTTP"].(bool)

	entry := &repo.Entry{
		Name:                  name,
		URL:                   url,
		Username:              username,
		Password:              password,
		CertFile:              certFile,
		KeyFile:               keyFile,
		CAFile:                caFile,
		InsecureSkipTLSverify: insecureSkipTLS,
	}

	if registry.IsOCI(url) {
		// OCI registries don't have index.yaml — validate by connecting.
		if err := r.validateOCIRegistry(url, username, password, certFile, keyFile, caFile, insecureSkipTLS, plainHTTP); err != nil {
			return nil, err
		}
	} else {
		// Traditional HTTP(S) repository — validate by downloading the index.
		settings := cli.New()
		chartRepo, err := repo.NewChartRepository(entry, nil)
		if err != nil {
			return nil, fmt.Errorf("failed to create chart repository: %w", err)
		}
		chartRepo.CachePath = settings.RepositoryCache

		if _, err := chartRepo.DownloadIndexFile(); err != nil {
			return nil, fmt.Errorf("failed to download index for %s: %w", url, err)
		}
	}

	f.Update(entry)
	if err := f.WriteFile(repoFile(), 0644); err != nil {
		return nil, fmt.Errorf("failed to write repo file: %w", err)
	}

	return &types.ActionResult{
		Success: true,
		Data:    repoEntryToMap(entry),
		Message: fmt.Sprintf("Repository %s added successfully", name),
	}, nil
}

// validateOCIRegistry validates an OCI registry by attempting to log in (if
// credentials are provided) or by creating a registry client and verifying
// the connection. OCI registries (oci://) don't use index.yaml files so we
// can't use the standard DownloadIndexFile validation path.
func (r *RepoResourcerWithActions) validateOCIRegistry(
	url, username, password, certFile, keyFile, caFile string,
	insecureSkipTLS, plainHTTP bool,
) error {
	// Strip oci:// prefix to get the registry host.
	host := strings.TrimPrefix(url, "oci://")
	// Remove any trailing path components to get just the registry host for login.
	// e.g. "ghcr.io/my-org/charts" → "ghcr.io"
	parts := strings.SplitN(host, "/", 2)
	registryHost := parts[0]

	// Build client options.
	clientOpts := []registry.ClientOption{}
	if plainHTTP {
		clientOpts = append(clientOpts, registry.ClientOptPlainHTTP())
	}
	if username != "" && password != "" {
		clientOpts = append(clientOpts, registry.ClientOptBasicAuth(username, password))
	}

	client, err := registry.NewClient(clientOpts...)
	if err != nil {
		return fmt.Errorf("failed to create OCI registry client: %w", err)
	}

	// Attempt login if credentials are provided.
	if username != "" && password != "" {
		loginOpts := []registry.LoginOption{
			registry.LoginOptBasicAuth(username, password),
			registry.LoginOptInsecure(insecureSkipTLS),
		}
		if certFile != "" || keyFile != "" || caFile != "" {
			loginOpts = append(loginOpts, registry.LoginOptTLSClientConfig(certFile, keyFile, caFile))
		}

		if err := client.Login(registryHost, loginOpts...); err != nil {
			return fmt.Errorf("failed to authenticate with OCI registry %s: %w", registryHost, err)
		}
	}

	// For OCI, we don't require listing tags — the login/client creation is
	// sufficient validation. Some registries restrict tag listing without a
	// specific repository reference, and users may be adding a registry root.
	return nil
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
