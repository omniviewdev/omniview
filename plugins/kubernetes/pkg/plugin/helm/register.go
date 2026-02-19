package helm

import (
	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	"github.com/omniviewdev/plugin-sdk/pkg/resource/types"
	"go.uber.org/zap"
)

var (
	// ReleaseMeta is the resource meta for helm::v1::Release.
	ReleaseMeta = types.ResourceMeta{
		Group:       "helm",
		Version:     "v1",
		Kind:        "Release",
		Description: "Installed Helm releases",
	}

	// RepoMeta is the resource meta for helm::v1::Repository.
	RepoMeta = types.ResourceMeta{
		Group:       "helm",
		Version:     "v1",
		Kind:        "Repository",
		Description: "Helm chart repositories",
	}
)

// HelmResourceGroup returns the resource group for Helm resources.
func HelmResourceGroup() types.ResourceGroup {
	return types.ResourceGroup{
		ID:   "helm",
		Name: "Helm",
		Icon: "SiHelm",
	}
}

// HelmResourceDefinitions returns the resource definitions for Helm resources.
func HelmResourceDefinitions() map[string]types.ResourceDefinition {
	return map[string]types.ResourceDefinition{
		ReleaseMeta.String(): {
			IDAccessor:        "name",
			NamespaceAccessor: "namespace",
			MemoizerAccessor:  "name",
			SupportedOperations: []types.OperationType{
				types.OperationTypeGet,
				types.OperationTypeList,
				types.OperationTypeCreate,
				types.OperationTypeDelete,
			},
			ColumnDefs: []types.ColumnDef{
				{
					ID:       "name",
					Header:   "Name",
					Accessors: "name",
				},
				{
					ID:        "namespace",
					Header:    "Namespace",
					Accessors: "namespace",
				},
				{
					ID:        "chart",
					Header:    "Chart",
					Accessors: "chart.metadata.name",
				},
				{
					ID:        "app_version",
					Header:    "App Version",
					Accessors: "chart.metadata.appVersion",
				},
				{
					ID:        "revision",
					Header:    "Revision",
					Accessors: "version",
				},
				{
					ID:        "status",
					Header:    "Status",
					Accessors: "info.status",
					ColorMap: map[string]string{
						"deployed":        "success",
						"failed":          "danger",
						"pending-install": "warning",
						"pending-upgrade": "warning",
						"pending-rollback": "warning",
						"superseded":      "neutral",
						"uninstalling":    "warning",
						"uninstalled":     "neutral",
					},
				},
				{
					ID:        "updated",
					Header:    "Updated",
					Accessors: "info.last_deployed",
					Formatter: types.CellValueFormatterAge,
				},
			},
		},
		RepoMeta.String(): {
			IDAccessor:       "name",
			MemoizerAccessor: "name",
			SupportedOperations: []types.OperationType{
				types.OperationTypeGet,
				types.OperationTypeList,
				types.OperationTypeCreate,
				types.OperationTypeDelete,
			},
			ColumnDefs: []types.ColumnDef{
				{
					ID:        "name",
					Header:    "Name",
					Accessors: "name",
				},
				{
					ID:        "url",
					Header:    "URL",
					Accessors: "url",
				},
			},
		},
	}
}

// HelmResourcers returns the resourcer implementations for Helm resources.
func HelmResourcers(logger *zap.SugaredLogger, svc *HelmService) map[types.ResourceMeta]types.Resourcer[clients.ClientSet] {
	return map[types.ResourceMeta]types.Resourcer[clients.ClientSet]{
		ReleaseMeta: NewReleaseResourcer(logger, svc),
		RepoMeta:    NewRepoResourcerWithActions(logger),
	}
}
