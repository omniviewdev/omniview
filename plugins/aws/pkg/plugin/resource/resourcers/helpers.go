package resourcers

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"

	"github.com/omniviewdev/aws-plugin/pkg/plugin/resource/clients"
	pkgtypes "github.com/omniviewdev/plugin-sdk/pkg/resource/types"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// StructToMap converts any struct to a map[string]interface{} using JSON marshal/unmarshal.
func StructToMap(v interface{}) (map[string]interface{}, error) {
	data, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	var result map[string]interface{}
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, err
	}
	return result, nil
}

// ----- Regional Resourcer (region-scoped AWS resources) -----

// RegionalListFunc lists resources in a specific region.
type RegionalListFunc = func(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error)

// RegionalGetFunc gets a single resource by ID in a specific region.
type RegionalGetFunc = func(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error)

// RegionalResourcer implements the Resourcer interface for region-scoped AWS resources.
// It automatically fans out List calls across all regions in parallel.
type RegionalResourcer struct {
	list RegionalListFunc
	get  RegionalGetFunc
}

// NewRegionalResourcer creates a new regional resourcer.
func NewRegionalResourcer(list RegionalListFunc, get RegionalGetFunc) pkgtypes.Resourcer[clients.Client] {
	return &RegionalResourcer{list: list, get: get}
}

func (r *RegionalResourcer) List(
	ctx *types.PluginContext,
	client *clients.Client,
	_ pkgtypes.ResourceMeta,
	input pkgtypes.ListInput,
) (*pkgtypes.ListResult, error) {
	regions := client.Regions
	if len(input.Namespaces) > 0 {
		regions = input.Namespaces
	}

	var (
		mu         sync.Mutex
		allResults []map[string]interface{}
		wg         sync.WaitGroup
	)

	for _, reg := range regions {
		wg.Add(1)
		go func(region string) {
			defer wg.Done()
			results, err := r.list(ctx.Context, client, region)
			if err != nil {
				return // skip region on error
			}
			mu.Lock()
			allResults = append(allResults, results...)
			mu.Unlock()
		}(reg)
	}
	wg.Wait()

	if allResults == nil {
		allResults = []map[string]interface{}{}
	}

	return &pkgtypes.ListResult{Success: true, Result: allResults}, nil
}

func (r *RegionalResourcer) Get(
	ctx *types.PluginContext,
	client *clients.Client,
	_ pkgtypes.ResourceMeta,
	input pkgtypes.GetInput,
) (*pkgtypes.GetResult, error) {
	region := input.Namespace
	if region == "" {
		return nil, fmt.Errorf("region (namespace) is required for Get")
	}
	result, err := r.get(ctx.Context, client, region, input.ID)
	if err != nil {
		return nil, err
	}
	return &pkgtypes.GetResult{Success: true, Result: result}, nil
}

func (r *RegionalResourcer) Find(
	ctx *types.PluginContext,
	client *clients.Client,
	meta pkgtypes.ResourceMeta,
	input pkgtypes.FindInput,
) (*pkgtypes.FindResult, error) {
	listResult, err := r.List(ctx, client, meta, pkgtypes.ListInput{Namespaces: input.Namespaces})
	if err != nil {
		return nil, err
	}
	return &pkgtypes.FindResult{Success: true, Result: listResult.Result}, nil
}

func (r *RegionalResourcer) Create(
	_ *types.PluginContext,
	_ *clients.Client,
	_ pkgtypes.ResourceMeta,
	_ pkgtypes.CreateInput,
) (*pkgtypes.CreateResult, error) {
	return nil, fmt.Errorf("create not implemented for this resource")
}

func (r *RegionalResourcer) Update(
	_ *types.PluginContext,
	_ *clients.Client,
	_ pkgtypes.ResourceMeta,
	_ pkgtypes.UpdateInput,
) (*pkgtypes.UpdateResult, error) {
	return nil, fmt.Errorf("update not implemented for this resource")
}

func (r *RegionalResourcer) Delete(
	_ *types.PluginContext,
	_ *clients.Client,
	_ pkgtypes.ResourceMeta,
	_ pkgtypes.DeleteInput,
) (*pkgtypes.DeleteResult, error) {
	return nil, fmt.Errorf("delete not implemented for this resource")
}

// ----- Global Resourcer (non-region-scoped AWS resources) -----

// GlobalListFunc lists resources globally (not scoped to a region).
type GlobalListFunc = func(ctx context.Context, client *clients.Client) ([]map[string]interface{}, error)

// GlobalGetFunc gets a single global resource by ID.
type GlobalGetFunc = func(ctx context.Context, client *clients.Client, id string) (map[string]interface{}, error)

// GlobalResourcer implements the Resourcer interface for global AWS resources
// like IAM, Route53, CloudFront, etc.
type GlobalResourcer struct {
	list GlobalListFunc
	get  GlobalGetFunc
}

// NewGlobalResourcer creates a new global resourcer.
func NewGlobalResourcer(list GlobalListFunc, get GlobalGetFunc) pkgtypes.Resourcer[clients.Client] {
	return &GlobalResourcer{list: list, get: get}
}

func (r *GlobalResourcer) List(
	ctx *types.PluginContext,
	client *clients.Client,
	_ pkgtypes.ResourceMeta,
	_ pkgtypes.ListInput,
) (*pkgtypes.ListResult, error) {
	results, err := r.list(ctx.Context, client)
	if err != nil {
		return nil, err
	}
	if results == nil {
		results = []map[string]interface{}{}
	}
	return &pkgtypes.ListResult{Success: true, Result: results}, nil
}

func (r *GlobalResourcer) Get(
	ctx *types.PluginContext,
	client *clients.Client,
	_ pkgtypes.ResourceMeta,
	input pkgtypes.GetInput,
) (*pkgtypes.GetResult, error) {
	result, err := r.get(ctx.Context, client, input.ID)
	if err != nil {
		return nil, err
	}
	return &pkgtypes.GetResult{Success: true, Result: result}, nil
}

func (r *GlobalResourcer) Find(
	ctx *types.PluginContext,
	client *clients.Client,
	meta pkgtypes.ResourceMeta,
	input pkgtypes.FindInput,
) (*pkgtypes.FindResult, error) {
	listResult, err := r.List(ctx, client, meta, pkgtypes.ListInput{})
	if err != nil {
		return nil, err
	}
	return &pkgtypes.FindResult{Success: true, Result: listResult.Result}, nil
}

func (r *GlobalResourcer) Create(
	_ *types.PluginContext,
	_ *clients.Client,
	_ pkgtypes.ResourceMeta,
	_ pkgtypes.CreateInput,
) (*pkgtypes.CreateResult, error) {
	return nil, fmt.Errorf("create not implemented for this resource")
}

func (r *GlobalResourcer) Update(
	_ *types.PluginContext,
	_ *clients.Client,
	_ pkgtypes.ResourceMeta,
	_ pkgtypes.UpdateInput,
) (*pkgtypes.UpdateResult, error) {
	return nil, fmt.Errorf("update not implemented for this resource")
}

func (r *GlobalResourcer) Delete(
	_ *types.PluginContext,
	_ *clients.Client,
	_ pkgtypes.ResourceMeta,
	_ pkgtypes.DeleteInput,
) (*pkgtypes.DeleteResult, error) {
	return nil, fmt.Errorf("delete not implemented for this resource")
}
