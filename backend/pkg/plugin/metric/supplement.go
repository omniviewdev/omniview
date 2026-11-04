package metric

import (
	"context"
	"encoding/json"
	"sort"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	sdk "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
)

func metricAppliesToResource(definition sdk.MetricDefinition, key string) bool {
	for _, supported := range definition.ResourceKeys {
		if supported == key {
			return true
		}
	}
	return false
}

// Supplement executes the complete native request independently of external
// mapping applicability. Each external group contains only its applicable
// resource kinds and resolved definitions. Neither lane is an error fallback.
func (c *controller) dispatchSupplementalResources(ctx context.Context, req sdk.ResourceSetQueryRequest) (*sdk.ResourceSetQueryResponse, error) {
	native := req
	native.Source = sdk.MetricSourceReference{PluginID: req.ResourcePluginID, ConnectionID: req.ResourceConnectionID, DatasourceUID: "native", DatasourceKind: "native"}
	native.BindingID = ""
	native.Definitions = nil
	native.PublicScope = nil
	native.MappingRevision = "native"
	out, err := c.dispatchResourceSet(ctx, native)
	if err != nil {
		if resourcev2.ErrorCode(err) != "UNSUPPORTED" {
			return nil, err
		}
		unavailable := &sdk.ResourceSetQueryResponse{}
		for _, resource := range native.Resources {
			for _, id := range native.MetricIDs {
				unavailable.Results = append(unavailable.Results, sdk.ResourceMetricResult{ResourceToken: resource.Token, MetricID: id, Status: sdk.MetricStatusUnsupported})
			}
		}
		out, err = normalizeResourceResults(native, unavailable)
		if err != nil {
			return nil, err
		}
	}
	samples := 0
	if err = mergeSupplementalGroup(out, nil, &samples); err != nil {
		return nil, err
	}
	if len(req.Definitions) == 0 {
		return out, nil
	}
	byKind := make(map[string][]sdk.MetricResource)
	for _, resource := range req.Resources {
		byKind[resource.ResourceKey] = append(byKind[resource.ResourceKey], resource)
	}
	keys := make([]string, 0, len(byKind))
	for key := range byKind {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		external := req
		external.Resources = byKind[key]
		external.MetricIDs = nil
		external.Definitions = nil
		for _, definition := range req.Definitions {
			if metricAppliesToResource(definition, key) {
				external.MetricIDs = append(external.MetricIDs, definition.ID)
				external.Definitions = append(external.Definitions, definition)
			}
		}
		if len(external.MetricIDs) == 0 {
			continue
		}
		if err = c.projectMetricResources(ctx, &external); err != nil {
			return nil, err
		}
		response, queryErr := c.dispatchResourceSet(ctx, external)
		if queryErr != nil {
			return nil, queryErr
		}
		if err = mergeSupplementalGroup(out, response, &samples); err != nil {
			return nil, err
		}
	}
	return out, nil
}

// mergeSupplementalGroup enforces cumulative limits before another group runs.
// A nil group checks the initial native response.
func mergeSupplementalGroup(out, group *sdk.ResourceSetQueryResponse, samples *int) error {
	results := out.Results
	if group != nil {
		results = group.Results
		out.Results = append(out.Results, group.Results...)
		out.Warnings = append(out.Warnings, group.Warnings...)
	}
	for _, result := range results {
		if result.Value != nil {
			*samples += metricSampleCount(result.Value)
		}
	}
	if *samples > maxSetSamples {
		return resourcev2.NewError("RESOURCE_LIMIT", "Combined metric sample count exceeds limit.")
	}
	encoded, err := json.Marshal(out)
	if err != nil {
		return err
	}
	if len(encoded) > maxSetResponseBytes {
		return resourcev2.NewError("RESOURCE_LIMIT", "Combined metric response exceeds byte limit.")
	}
	return nil
}
