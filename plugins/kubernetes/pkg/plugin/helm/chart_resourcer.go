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
	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/chart/loader"
	"helm.sh/helm/v3/pkg/cli"
	"helm.sh/helm/v3/pkg/repo"
)

// ChartResourcer implements a read-only Resourcer for helm::v1::Chart.
// It reads chart metadata from Helm's local repo index cache files.
type ChartResourcer struct {
	log *zap.SugaredLogger
}

var (
	_ types.Resourcer[clients.ClientSet]      = (*ChartResourcerWithActions)(nil)
	_ types.ActionResourcer[clients.ClientSet] = (*ChartResourcerWithActions)(nil)
)

// NewChartResourcer creates a new ChartResourcer.
func NewChartResourcer(logger *zap.SugaredLogger) *ChartResourcer {
	return &ChartResourcer{
		log: logger.Named("HelmChartResourcer"),
	}
}

// loadAllIndexes loads all repo index files from the Helm cache directory.
func loadAllIndexes() (map[string]*repo.IndexFile, error) {
	f, err := loadRepoFile()
	if err != nil {
		return nil, err
	}

	settings := cli.New()
	cachePath := settings.RepositoryCache

	indexes := make(map[string]*repo.IndexFile, len(f.Repositories))
	for _, entry := range f.Repositories {
		indexPath := filepath.Join(cachePath, entry.Name+"-index.yaml")
		if _, statErr := os.Stat(indexPath); os.IsNotExist(statErr) {
			continue
		}
		idx, loadErr := repo.LoadIndexFile(indexPath)
		if loadErr != nil {
			continue
		}
		indexes[entry.Name] = idx
	}

	return indexes, nil
}

// chartVersionToMap converts a ChartVersion into a flat map suitable for the SDK.
// All slice values must use []interface{} (not typed slices) for structpb compatibility.
func chartVersionToMap(repoName string, cv *repo.ChartVersion) map[string]interface{} {
	m := map[string]interface{}{
		"id":          repoName + "/" + cv.Name,
		"name":        cv.Name,
		"description": cv.Description,
		"version":     cv.Version,
		"appVersion":  cv.AppVersion,
		"repository":  repoName,
		"deprecated":  cv.Deprecated,
		"type":        cv.Type,
	}

	if cv.Icon != "" {
		m["icon"] = cv.Icon
	}
	if cv.Home != "" {
		m["home"] = cv.Home
	}
	if len(cv.Keywords) > 0 {
		keywords := make([]interface{}, len(cv.Keywords))
		for i, kw := range cv.Keywords {
			keywords[i] = kw
		}
		m["keywords"] = keywords
	}
	if cv.KubeVersion != "" {
		m["kubeVersion"] = cv.KubeVersion
	}
	if len(cv.Maintainers) > 0 {
		maintainers := make([]interface{}, 0, len(cv.Maintainers))
		for _, maint := range cv.Maintainers {
			entry := map[string]interface{}{"name": maint.Name}
			if maint.Email != "" {
				entry["email"] = maint.Email
			}
			if maint.URL != "" {
				entry["url"] = maint.URL
			}
			maintainers = append(maintainers, entry)
		}
		m["maintainers"] = maintainers
	}

	return m
}

func (r *ChartResourcer) Get(
	_ *pkgtypes.PluginContext,
	_ *clients.ClientSet,
	_ types.ResourceMeta,
	input types.GetInput,
) (*types.GetResult, error) {
	parts := strings.SplitN(input.ID, "/", 2)
	if len(parts) != 2 {
		return nil, fmt.Errorf("chart ID must be in the form repo/chart, got %q", input.ID)
	}
	repoName, chartName := parts[0], parts[1]

	indexes, err := loadAllIndexes()
	if err != nil {
		return nil, err
	}

	idx, ok := indexes[repoName]
	if !ok {
		return nil, fmt.Errorf("repository %s not found in local cache", repoName)
	}

	versions, found := idx.Entries[chartName]
	if !found || len(versions) == 0 {
		return nil, fmt.Errorf("chart %s not found in repository %s", chartName, repoName)
	}

	// Return the latest version as the main entry, plus all versions.
	result := chartVersionToMap(repoName, versions[0])

	allVersions := make([]interface{}, 0, len(versions))
	for _, v := range versions {
		entry := map[string]interface{}{
			"version":    v.Version,
			"appVersion": v.AppVersion,
			"created":    v.Created.Format(time.RFC3339),
			"deprecated": v.Deprecated,
		}
		if v.Description != "" {
			entry["description"] = v.Description
		}
		if v.KubeVersion != "" {
			entry["kubeVersion"] = v.KubeVersion
		}
		if v.Home != "" {
			entry["home"] = v.Home
		}
		if v.Icon != "" {
			entry["icon"] = v.Icon
		}
		if v.Type != "" {
			entry["type"] = v.Type
		}
		allVersions = append(allVersions, entry)
	}
	result["versions"] = allVersions
	result["totalVersions"] = len(allVersions)

	return &types.GetResult{
		Result:  result,
		Success: true,
	}, nil
}

func (r *ChartResourcer) List(
	_ *pkgtypes.PluginContext,
	_ *clients.ClientSet,
	_ types.ResourceMeta,
	_ types.ListInput,
) (*types.ListResult, error) {
	indexes, err := loadAllIndexes()
	if err != nil {
		return nil, err
	}

	var charts []map[string]interface{}
	for repoName, idx := range indexes {
		for _, versions := range idx.Entries {
			if len(versions) == 0 {
				continue
			}
			// Use the latest (first) version for list display.
			charts = append(charts, chartVersionToMap(repoName, versions[0]))
		}
	}

	return &types.ListResult{
		Result:  charts,
		Success: true,
	}, nil
}

func (r *ChartResourcer) Find(
	ctx *pkgtypes.PluginContext,
	client *clients.ClientSet,
	meta types.ResourceMeta,
	_ types.FindInput,
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

func (r *ChartResourcer) Create(
	_ *pkgtypes.PluginContext,
	_ *clients.ClientSet,
	_ types.ResourceMeta,
	_ types.CreateInput,
) (*types.CreateResult, error) {
	return nil, fmt.Errorf("creating charts is not supported")
}

func (r *ChartResourcer) Update(
	_ *pkgtypes.PluginContext,
	_ *clients.ClientSet,
	_ types.ResourceMeta,
	_ types.UpdateInput,
) (*types.UpdateResult, error) {
	return nil, fmt.Errorf("updating charts is not supported")
}

func (r *ChartResourcer) Delete(
	_ *pkgtypes.PluginContext,
	_ *clients.ClientSet,
	_ types.ResourceMeta,
	_ types.DeleteInput,
) (*types.DeleteResult, error) {
	return nil, fmt.Errorf("deleting charts is not supported")
}

// ChartResourcerWithActions combines ChartResourcer with action support.
type ChartResourcerWithActions struct {
	ChartResourcer
}

// NewChartResourcerWithActions creates a new ChartResourcerWithActions.
func NewChartResourcerWithActions(logger *zap.SugaredLogger) *ChartResourcerWithActions {
	return &ChartResourcerWithActions{
		ChartResourcer: *NewChartResourcer(logger),
	}
}

func (r *ChartResourcerWithActions) GetActions(
	_ *pkgtypes.PluginContext,
	_ *clients.ClientSet,
	_ types.ResourceMeta,
) ([]types.ActionDescriptor, error) {
	return []types.ActionDescriptor{
		{
			ID:          "get-values",
			Label:       "Get Default Values",
			Description: "Get the default values.yaml for this chart",
			Icon:        "LuFileText",
			Scope:       types.ActionScopeInstance,
		},
		{
			ID:          "get-readme",
			Label:       "Get README",
			Description: "Get the README for this chart",
			Icon:        "LuBookOpen",
			Scope:       types.ActionScopeInstance,
		},
		{
			ID:          "get-versions",
			Label:       "Get All Versions",
			Description: "Get all available versions of this chart",
			Icon:        "LuList",
			Scope:       types.ActionScopeInstance,
		},
		{
			ID:          "get-chart-detail",
			Label:       "Get Chart Detail",
			Description: "Get values, readme, versions, and dependencies for a chart in one call",
			Icon:        "LuInfo",
			Scope:       types.ActionScopeInstance,
		},
	}, nil
}

func (r *ChartResourcerWithActions) ExecuteAction(
	_ *pkgtypes.PluginContext,
	_ *clients.ClientSet,
	_ types.ResourceMeta,
	actionID string,
	input types.ActionInput,
) (*types.ActionResult, error) {
	parts := strings.SplitN(input.ID, "/", 2)
	if len(parts) != 2 {
		return nil, fmt.Errorf("chart ID must be in the form repo/chart, got %q", input.ID)
	}
	repoName, chartName := parts[0], parts[1]

	switch actionID {
	case "get-values":
		return r.executeGetValues(repoName, chartName, input)
	case "get-readme":
		return r.executeGetReadme(repoName, chartName, input)
	case "get-versions":
		return r.executeGetVersions(repoName, chartName)
	case "get-chart-detail":
		return r.executeGetChartDetail(repoName, chartName, input)
	default:
		return nil, fmt.Errorf("unknown action: %s", actionID)
	}
}

func (r *ChartResourcerWithActions) executeGetValues(repoName, chartName string, input types.ActionInput) (*types.ActionResult, error) {
	chartRef := repoName + "/" + chartName

	settings := cli.New()
	version, _ := input.Params["version"].(string)

	chartPathOpts := &action.ChartPathOptions{Version: version}
	chartPath, err := chartPathOpts.LocateChart(chartRef, settings)
	if err != nil {
		return nil, fmt.Errorf("failed to locate chart %s: %w", chartRef, err)
	}

	ch, err := loader.Load(chartPath)
	if err != nil {
		return nil, fmt.Errorf("failed to load chart %s: %w", chartPath, err)
	}

	values := ""
	for _, f := range ch.Raw {
		if f.Name == "values.yaml" {
			values = string(f.Data)
			break
		}
	}

	return &types.ActionResult{
		Success: true,
		Data: map[string]interface{}{
			"values": values,
		},
	}, nil
}

func (r *ChartResourcerWithActions) executeGetReadme(repoName, chartName string, input types.ActionInput) (*types.ActionResult, error) {
	chartRef := repoName + "/" + chartName

	settings := cli.New()
	version, _ := input.Params["version"].(string)

	chartPathOpts := &action.ChartPathOptions{Version: version}
	chartPath, err := chartPathOpts.LocateChart(chartRef, settings)
	if err != nil {
		return nil, fmt.Errorf("failed to locate chart %s: %w", chartRef, err)
	}

	ch, err := loader.Load(chartPath)
	if err != nil {
		return nil, fmt.Errorf("failed to load chart %s: %w", chartPath, err)
	}

	readme := ""
	for _, f := range ch.Files {
		if strings.EqualFold(f.Name, "readme.md") || strings.EqualFold(f.Name, "readme.txt") || strings.EqualFold(f.Name, "readme") {
			readme = string(f.Data)
			break
		}
	}

	return &types.ActionResult{
		Success: true,
		Data: map[string]interface{}{
			"readme": readme,
		},
	}, nil
}

func (r *ChartResourcerWithActions) executeGetVersions(repoName, chartName string) (*types.ActionResult, error) {
	indexes, err := loadAllIndexes()
	if err != nil {
		return nil, err
	}

	idx, ok := indexes[repoName]
	if !ok {
		return nil, fmt.Errorf("repository %s not found in local cache", repoName)
	}

	versions, found := idx.Entries[chartName]
	if !found {
		return nil, fmt.Errorf("chart %s not found in repository %s", chartName, repoName)
	}

	allVersions := make([]interface{}, 0, len(versions))
	for _, v := range versions {
		entry := map[string]interface{}{
			"version":    v.Version,
			"appVersion": v.AppVersion,
			"created":    v.Created.Format(time.RFC3339),
			"deprecated": v.Deprecated,
		}
		if v.Description != "" {
			entry["description"] = v.Description
		}
		if v.KubeVersion != "" {
			entry["kubeVersion"] = v.KubeVersion
		}
		if v.Digest != "" {
			entry["digest"] = v.Digest
		}
		if v.Home != "" {
			entry["home"] = v.Home
		}
		if v.Icon != "" {
			entry["icon"] = v.Icon
		}
		if v.Type != "" {
			entry["type"] = v.Type
		}
		allVersions = append(allVersions, entry)
	}

	return &types.ActionResult{
		Success: true,
		Data: map[string]interface{}{
			"versions": allVersions,
			"total":    len(allVersions),
		},
	}, nil
}

func (r *ChartResourcerWithActions) executeGetChartDetail(repoName, chartName string, input types.ActionInput) (*types.ActionResult, error) {
	chartRef := repoName + "/" + chartName

	settings := cli.New()
	version, _ := input.Params["version"].(string)

	// Load the chart archive to get values and readme.
	chartPathOpts := &action.ChartPathOptions{Version: version}
	chartPath, err := chartPathOpts.LocateChart(chartRef, settings)
	if err != nil {
		return nil, fmt.Errorf("failed to locate chart %s: %w", chartRef, err)
	}

	ch, err := loader.Load(chartPath)
	if err != nil {
		return nil, fmt.Errorf("failed to load chart %s: %w", chartPath, err)
	}

	// Extract values.yaml
	values := ""
	for _, f := range ch.Raw {
		if f.Name == "values.yaml" {
			values = string(f.Data)
			break
		}
	}

	// Extract README
	readme := ""
	for _, f := range ch.Files {
		if strings.EqualFold(f.Name, "readme.md") || strings.EqualFold(f.Name, "readme.txt") || strings.EqualFold(f.Name, "readme") {
			readme = string(f.Data)
			break
		}
	}

	// Extract dependencies
	var deps []interface{}
	if ch.Metadata != nil && len(ch.Metadata.Dependencies) > 0 {
		deps = make([]interface{}, 0, len(ch.Metadata.Dependencies))
		for _, d := range ch.Metadata.Dependencies {
			entry := map[string]interface{}{
				"name":       d.Name,
				"repository": d.Repository,
			}
			if d.Version != "" {
				entry["version"] = d.Version
			}
			if d.Condition != "" {
				entry["condition"] = d.Condition
			}
			deps = append(deps, entry)
		}
	}

	// Get all versions from the index
	versionsResult, err := r.executeGetVersions(repoName, chartName)
	if err != nil {
		return nil, err
	}

	return &types.ActionResult{
		Success: true,
		Data: map[string]interface{}{
			"values":       values,
			"readme":       readme,
			"versions":     versionsResult.Data["versions"],
			"total":        versionsResult.Data["total"],
			"dependencies": deps,
		},
	}, nil
}

func (r *ChartResourcerWithActions) StreamAction(
	_ *pkgtypes.PluginContext,
	_ *clients.ClientSet,
	_ types.ResourceMeta,
	_ string,
	_ types.ActionInput,
	_ chan types.ActionEvent,
) error {
	return fmt.Errorf("streaming actions not supported for charts")
}
