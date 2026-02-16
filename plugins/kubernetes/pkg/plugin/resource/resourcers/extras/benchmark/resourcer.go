package benchmark

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	pkgtypes "github.com/omniviewdev/plugin-sdk/pkg/resource/types"
	"github.com/omniviewdev/plugin-sdk/pkg/types"

	// benchmarker powered by fairwinds polaris
	conf "github.com/fairwindsops/polaris/pkg/config"
	"github.com/fairwindsops/polaris/pkg/kube"
	"github.com/fairwindsops/polaris/pkg/validator"
)

type ClusterBenchmarker struct{}

var _ pkgtypes.Resourcer[clients.ClientSet] = (*ClusterBenchmarker)(nil)

// ============================ ACTION METHODS ============================ //.

func (cb *ClusterBenchmarker) Get(
	_ *types.PluginContext,
	client *clients.ClientSet,
	_ pkgtypes.ResourceMeta,
	input pkgtypes.GetInput,
) (*pkgtypes.GetResult, error) {
	return nil, nil
}

// List returns a map of resources for the provided cluster contexts.
func (s *ClusterBenchmarker) List(
	pctx *types.PluginContext,
	client *clients.ClientSet,
	_ pkgtypes.ResourceMeta,
	_ pkgtypes.ListInput,
) (*pkgtypes.ListResult, error) {
	result := &pkgtypes.ListResult{Success: false, Result: nil}

	config := createPolarisConf()
	resources, err := createPolarisResourceProvider(pctx.Context, config, client)
	if err != nil {
		return result, err
	}

	auditData, err := validator.RunAudit(config, resources)
	if err != nil {
		return result, err
	}
	// Convert the struct to JSON
	jsonData, err := json.Marshal(ToBenchmarkResults(auditData))
	if err != nil {
		return result, err
	}

	var data map[string]any
	if err := json.Unmarshal(jsonData, &data); err != nil {
		return result, err
	}

	result.Success = true
	result.Result = []map[string]any{data}

	return result, nil
}

// Find returns a resource by name and namespace.
// TODO - implement, for now this just does list
func (s *ClusterBenchmarker) Find(
	_ *types.PluginContext,
	client *clients.ClientSet,
	_ pkgtypes.ResourceMeta,
	_ pkgtypes.FindInput,
) (*pkgtypes.FindResult, error) {
	return &pkgtypes.FindResult{Success: true, Result: nil}, nil
}

// Create creates a new resource in the given resource namespace.
func (s *ClusterBenchmarker) Create(
	ctx *types.PluginContext,
	client *clients.ClientSet,
	_ pkgtypes.ResourceMeta,
	input pkgtypes.CreateInput,
) (*pkgtypes.CreateResult, error) {
	return nil, fmt.Errorf("create operation not supported")
}

func (s *ClusterBenchmarker) Update(
	ctx *types.PluginContext,
	client *clients.ClientSet,
	_ pkgtypes.ResourceMeta,
	input pkgtypes.UpdateInput,
) (*pkgtypes.UpdateResult, error) {
	return nil, fmt.Errorf("update operation not supported")
}

func (s *ClusterBenchmarker) Delete(
	ctx *types.PluginContext,
	client *clients.ClientSet,
	_ pkgtypes.ResourceMeta,
	input pkgtypes.DeleteInput,
) (*pkgtypes.DeleteResult, error) {
	return nil, fmt.Errorf("delete operation not supported")
}

// ============================ PRIVATE METHODS ============================ //.

func createPolarisConf() conf.Configuration {
	conf, _ := conf.MergeConfigAndParseFile("", true)
	return conf
}

func createPolarisResourceProvider(
	ctx context.Context,
	c conf.Configuration,
	client *clients.ClientSet,
) (*kube.ResourceProvider, error) {
	return kube.CreateResourceProviderFromAPI(
		ctx,
		client.Clientset,
		client.RESTConfig.Host,
		client.DynamicClient,
		c,
	)
}
