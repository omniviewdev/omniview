package helm

import (
	"encoding/json"
	"fmt"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	"github.com/omniviewdev/plugin-sdk/pkg/resource/types"
	pkgtypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	"go.uber.org/zap"
	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/chart/loader"
	"helm.sh/helm/v3/pkg/cli"
	"helm.sh/helm/v3/pkg/release"
)

// ReleaseResourcer implements Resourcer[clients.ClientSet] and ActionResourcer[clients.ClientSet]
// for helm::v1::Release.
type ReleaseResourcer struct {
	log         *zap.SugaredLogger
	helmService *HelmService
}

// Compile-time checks.
var (
	_ types.Resourcer[clients.ClientSet]      = (*ReleaseResourcer)(nil)
	_ types.ActionResourcer[clients.ClientSet] = (*ReleaseResourcer)(nil)
)

// NewReleaseResourcer creates a new ReleaseResourcer.
func NewReleaseResourcer(logger *zap.SugaredLogger, svc *HelmService) *ReleaseResourcer {
	return &ReleaseResourcer{
		log:         logger.Named("HelmReleaseResourcer"),
		helmService: svc,
	}
}

func (r *ReleaseResourcer) getConfig(
	ctx *pkgtypes.PluginContext,
	client *clients.ClientSet,
	namespace string,
) (*action.Configuration, error) {
	if ctx.Connection == nil {
		return nil, fmt.Errorf("no connection in context")
	}
	if namespace == "" {
		namespace = "default"
	}
	return r.helmService.GetActionConfig(ctx.Connection.ID, client.RESTConfig, namespace)
}

// releaseToMap converts a Helm release to a map for the SDK.
func releaseToMap(rel *release.Release) map[string]interface{} {
	data, err := json.Marshal(rel)
	if err != nil {
		return map[string]interface{}{"name": rel.Name, "namespace": rel.Namespace}
	}
	var result map[string]interface{}
	if err := json.Unmarshal(data, &result); err != nil {
		return map[string]interface{}{"name": rel.Name, "namespace": rel.Namespace}
	}
	return result
}

// ================================= CRUD ================================= //

func (r *ReleaseResourcer) Get(
	ctx *pkgtypes.PluginContext,
	client *clients.ClientSet,
	_ types.ResourceMeta,
	input types.GetInput,
) (*types.GetResult, error) {
	cfg, err := r.getConfig(ctx, client, input.Namespace)
	if err != nil {
		return nil, err
	}

	get := action.NewGet(cfg)
	rel, err := get.Run(input.ID)
	if err != nil {
		return nil, fmt.Errorf("failed to get release %s: %w", input.ID, err)
	}

	return &types.GetResult{
		Result:  releaseToMap(rel),
		Success: true,
	}, nil
}

func (r *ReleaseResourcer) List(
	ctx *pkgtypes.PluginContext,
	client *clients.ClientSet,
	_ types.ResourceMeta,
	input types.ListInput,
) (*types.ListResult, error) {
	// List across all requested namespaces, or all namespaces if none specified.
	namespaces := input.Namespaces
	if len(namespaces) == 0 {
		namespaces = []string{""}
	}

	var allReleases []map[string]interface{}
	for _, ns := range namespaces {
		cfg, err := r.getConfig(ctx, client, ns)
		if err != nil {
			r.log.Warnw("failed to get config for namespace", "namespace", ns, "error", err)
			continue
		}

		list := action.NewList(cfg)
		list.AllNamespaces = ns == ""
		list.StateMask = action.ListAll

		releases, err := list.Run()
		if err != nil {
			r.log.Warnw("failed to list releases", "namespace", ns, "error", err)
			continue
		}

		for _, rel := range releases {
			allReleases = append(allReleases, releaseToMap(rel))
		}
	}

	return &types.ListResult{
		Result:  allReleases,
		Success: true,
	}, nil
}

func (r *ReleaseResourcer) Find(
	ctx *pkgtypes.PluginContext,
	client *clients.ClientSet,
	meta types.ResourceMeta,
	input types.FindInput,
) (*types.FindResult, error) {
	// Find is like List with filtering — delegate to List for now.
	listResult, err := r.List(ctx, client, meta, types.ListInput{
		Namespaces: input.Namespaces,
	})
	if err != nil {
		return nil, err
	}
	return &types.FindResult{
		Result:  listResult.Result,
		Success: listResult.Success,
	}, nil
}

func (r *ReleaseResourcer) Create(
	ctx *pkgtypes.PluginContext,
	client *clients.ClientSet,
	_ types.ResourceMeta,
	input types.CreateInput,
) (*types.CreateResult, error) {
	cfg, err := r.getConfig(ctx, client, input.Namespace)
	if err != nil {
		return nil, err
	}

	chartRef, _ := input.Input["chart"].(string)
	releaseName, _ := input.Input["name"].(string)
	valuesYAML, _ := input.Input["values"].(map[string]interface{})

	if chartRef == "" {
		return nil, fmt.Errorf("chart reference is required")
	}

	// Locate and load the chart.
	settings := cli.New()
	settings.SetNamespace(input.Namespace)

	chartPath, err := (&action.ChartPathOptions{}).LocateChart(chartRef, settings)
	if err != nil {
		return nil, fmt.Errorf("failed to locate chart %s: %w", chartRef, err)
	}

	chart, err := loader.Load(chartPath)
	if err != nil {
		return nil, fmt.Errorf("failed to load chart %s: %w", chartPath, err)
	}

	install := action.NewInstall(cfg)
	install.ReleaseName = releaseName
	install.Namespace = input.Namespace
	install.CreateNamespace = true

	rel, err := install.Run(chart, valuesYAML)
	if err != nil {
		return nil, fmt.Errorf("failed to install release: %w", err)
	}

	return &types.CreateResult{
		Result:  releaseToMap(rel),
		Success: true,
	}, nil
}

func (r *ReleaseResourcer) Update(
	_ *pkgtypes.PluginContext,
	_ *clients.ClientSet,
	_ types.ResourceMeta,
	_ types.UpdateInput,
) (*types.UpdateResult, error) {
	// Update is not directly supported — use the "upgrade" action instead.
	return nil, fmt.Errorf("use the 'upgrade' action to update a release")
}

func (r *ReleaseResourcer) Delete(
	ctx *pkgtypes.PluginContext,
	client *clients.ClientSet,
	_ types.ResourceMeta,
	input types.DeleteInput,
) (*types.DeleteResult, error) {
	cfg, err := r.getConfig(ctx, client, input.Namespace)
	if err != nil {
		return nil, err
	}

	uninstall := action.NewUninstall(cfg)
	resp, err := uninstall.Run(input.ID)
	if err != nil {
		return nil, fmt.Errorf("failed to uninstall release %s: %w", input.ID, err)
	}

	return &types.DeleteResult{
		Result:  releaseToMap(resp.Release),
		Success: true,
	}, nil
}

// ================================= ACTIONS ================================= //

func (r *ReleaseResourcer) GetActions(
	_ *pkgtypes.PluginContext,
	_ *clients.ClientSet,
	_ types.ResourceMeta,
) ([]types.ActionDescriptor, error) {
	return []types.ActionDescriptor{
		{
			ID:          "upgrade",
			Label:       "Upgrade Release",
			Description: "Upgrade an installed release with new chart or values",
			Icon:        "LuArrowUpCircle",
			Scope:       types.ActionScopeInstance,
		},
		{
			ID:          "rollback",
			Label:       "Rollback Release",
			Description: "Rollback a release to a previous revision",
			Icon:        "LuUndo2",
			Scope:       types.ActionScopeInstance,
		},
		{
			ID:          "get-values",
			Label:       "Get Values",
			Description: "Get the computed values for a release",
			Icon:        "LuFileText",
			Scope:       types.ActionScopeInstance,
		},
		{
			ID:          "get-manifest",
			Label:       "Get Manifest",
			Description: "Get the rendered manifest for a release",
			Icon:        "LuFileCode",
			Scope:       types.ActionScopeInstance,
		},
		{
			ID:          "get-notes",
			Label:       "Get Notes",
			Description: "Get the release notes",
			Icon:        "LuStickyNote",
			Scope:       types.ActionScopeInstance,
		},
		{
			ID:          "get-hooks",
			Label:       "Get Hooks",
			Description: "Get the release hooks",
			Icon:        "LuAnchor",
			Scope:       types.ActionScopeInstance,
		},
		{
			ID:          "get-history",
			Label:       "Get History",
			Description: "Get the revision history for a release",
			Icon:        "LuHistory",
			Scope:       types.ActionScopeInstance,
		},
	}, nil
}

func (r *ReleaseResourcer) ExecuteAction(
	ctx *pkgtypes.PluginContext,
	client *clients.ClientSet,
	_ types.ResourceMeta,
	actionID string,
	input types.ActionInput,
) (*types.ActionResult, error) {
	cfg, err := r.getConfig(ctx, client, input.Namespace)
	if err != nil {
		return nil, err
	}

	switch actionID {
	case "upgrade":
		return r.executeUpgrade(cfg, input)
	case "rollback":
		return r.executeRollback(cfg, input)
	case "get-values":
		return r.executeGetValues(cfg, input)
	case "get-manifest":
		return r.executeGetManifest(cfg, input)
	case "get-notes":
		return r.executeGetNotes(cfg, input)
	case "get-hooks":
		return r.executeGetHooks(cfg, input)
	case "get-history":
		return r.executeGetHistory(cfg, input)
	default:
		return nil, fmt.Errorf("unknown action: %s", actionID)
	}
}

func (r *ReleaseResourcer) StreamAction(
	_ *pkgtypes.PluginContext,
	_ *clients.ClientSet,
	_ types.ResourceMeta,
	_ string,
	_ types.ActionInput,
	_ chan types.ActionEvent,
) error {
	return fmt.Errorf("streaming actions not yet implemented for releases")
}

// ================================= ACTION IMPLEMENTATIONS ================================= //

func (r *ReleaseResourcer) executeUpgrade(
	cfg *action.Configuration,
	input types.ActionInput,
) (*types.ActionResult, error) {
	chartRef, _ := input.Params["chart"].(string)
	values, _ := input.Params["values"].(map[string]interface{})
	reuseValues, _ := input.Params["reuse_values"].(bool)

	if chartRef == "" {
		return nil, fmt.Errorf("chart reference is required for upgrade")
	}

	settings := cli.New()
	settings.SetNamespace(input.Namespace)

	chartPath, err := (&action.ChartPathOptions{}).LocateChart(chartRef, settings)
	if err != nil {
		return nil, fmt.Errorf("failed to locate chart %s: %w", chartRef, err)
	}

	chart, err := loader.Load(chartPath)
	if err != nil {
		return nil, fmt.Errorf("failed to load chart %s: %w", chartPath, err)
	}

	upgrade := action.NewUpgrade(cfg)
	upgrade.Namespace = input.Namespace
	upgrade.ReuseValues = reuseValues

	rel, err := upgrade.Run(input.ID, chart, values)
	if err != nil {
		return nil, fmt.Errorf("failed to upgrade release: %w", err)
	}

	return &types.ActionResult{
		Success: true,
		Data:    releaseToMap(rel),
		Message: fmt.Sprintf("Release %s upgraded to revision %d", rel.Name, rel.Version),
	}, nil
}

func (r *ReleaseResourcer) executeRollback(
	cfg *action.Configuration,
	input types.ActionInput,
) (*types.ActionResult, error) {
	revisionF, _ := input.Params["revision"].(float64)
	revision := int(revisionF)

	rollback := action.NewRollback(cfg)
	rollback.Version = revision

	if err := rollback.Run(input.ID); err != nil {
		return nil, fmt.Errorf("failed to rollback release: %w", err)
	}

	return &types.ActionResult{
		Success: true,
		Message: fmt.Sprintf("Release %s rolled back to revision %d", input.ID, revision),
	}, nil
}

func (r *ReleaseResourcer) executeGetValues(
	cfg *action.Configuration,
	input types.ActionInput,
) (*types.ActionResult, error) {
	getValues := action.NewGetValues(cfg)
	allValues, _ := input.Params["all"].(bool)
	getValues.AllValues = allValues

	values, err := getValues.Run(input.ID)
	if err != nil {
		return nil, fmt.Errorf("failed to get values: %w", err)
	}

	return &types.ActionResult{
		Success: true,
		Data:    values,
	}, nil
}

func (r *ReleaseResourcer) executeGetManifest(
	cfg *action.Configuration,
	input types.ActionInput,
) (*types.ActionResult, error) {
	get := action.NewGet(cfg)
	rel, err := get.Run(input.ID)
	if err != nil {
		return nil, fmt.Errorf("failed to get release: %w", err)
	}

	return &types.ActionResult{
		Success: true,
		Data: map[string]interface{}{
			"manifest": rel.Manifest,
		},
	}, nil
}

func (r *ReleaseResourcer) executeGetNotes(
	cfg *action.Configuration,
	input types.ActionInput,
) (*types.ActionResult, error) {
	get := action.NewGet(cfg)
	rel, err := get.Run(input.ID)
	if err != nil {
		return nil, fmt.Errorf("failed to get release: %w", err)
	}

	notes := ""
	if rel.Info != nil {
		notes = rel.Info.Notes
	}

	return &types.ActionResult{
		Success: true,
		Data: map[string]interface{}{
			"notes": notes,
		},
	}, nil
}

func (r *ReleaseResourcer) executeGetHooks(
	cfg *action.Configuration,
	input types.ActionInput,
) (*types.ActionResult, error) {
	get := action.NewGet(cfg)
	rel, err := get.Run(input.ID)
	if err != nil {
		return nil, fmt.Errorf("failed to get release: %w", err)
	}

	hooks := make([]map[string]interface{}, 0, len(rel.Hooks))
	for _, hook := range rel.Hooks {
		h := map[string]interface{}{
			"name":   hook.Name,
			"kind":   hook.Kind,
			"path":   hook.Path,
			"weight": hook.Weight,
		}
		events := make([]string, 0, len(hook.Events))
		for _, e := range hook.Events {
			events = append(events, string(e))
		}
		h["events"] = events
		hooks = append(hooks, h)
	}

	return &types.ActionResult{
		Success: true,
		Data: map[string]interface{}{
			"hooks": hooks,
		},
	}, nil
}

func (r *ReleaseResourcer) executeGetHistory(
	cfg *action.Configuration,
	input types.ActionInput,
) (*types.ActionResult, error) {
	history := action.NewHistory(cfg)
	maxF, ok := input.Params["max"].(float64)
	if ok && maxF > 0 {
		history.Max = int(maxF)
	}

	releases, err := history.Run(input.ID)
	if err != nil {
		return nil, fmt.Errorf("failed to get history: %w", err)
	}

	revisions := make([]map[string]interface{}, 0, len(releases))
	for _, rel := range releases {
		revisions = append(revisions, releaseToMap(rel))
	}

	return &types.ActionResult{
		Success: true,
		Data: map[string]interface{}{
			"revisions": revisions,
		},
	}, nil
}
