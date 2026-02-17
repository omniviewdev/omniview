package resourcers

import (
	"context"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/service/lambda"

	"github.com/omniviewdev/aws-plugin/pkg/plugin/resource/clients"
)

// ===== Lambda Function =====

// ListLambdaFunctions lists all Lambda functions in the given region.
func ListLambdaFunctions(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := lambda.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	paginator := lambda.NewListFunctionsPaginator(svc, &lambda.ListFunctionsInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list Lambda functions in %s: %w", region, err)
		}
		for _, fn := range page.Functions {
			m, err := StructToMap(fn)
			if err != nil {
				return nil, fmt.Errorf("failed to convert Lambda function to map: %w", err)
			}
			m["Region"] = region
			results = append(results, m)
		}
	}

	return results, nil
}

// GetLambdaFunction gets a single Lambda function by name in the given region.
func GetLambdaFunction(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := lambda.NewFromConfig(client.ConfigForRegion(region))

	result, err := svc.GetFunction(ctx, &lambda.GetFunctionInput{
		FunctionName: &id,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get Lambda function %s in %s: %w", id, region, err)
	}

	m, err := StructToMap(result.Configuration)
	if err != nil {
		return nil, fmt.Errorf("failed to convert Lambda function to map: %w", err)
	}
	m["Region"] = region

	return m, nil
}

// ===== Lambda Layer =====

// ListLambdaLayers lists all Lambda layers in the given region.
func ListLambdaLayers(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := lambda.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	paginator := lambda.NewListLayersPaginator(svc, &lambda.ListLayersInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list Lambda layers in %s: %w", region, err)
		}
		for _, layer := range page.Layers {
			m, err := StructToMap(layer)
			if err != nil {
				return nil, fmt.Errorf("failed to convert Lambda layer to map: %w", err)
			}
			m["Region"] = region
			results = append(results, m)
		}
	}

	return results, nil
}

// GetLambdaLayer gets a single Lambda layer by name in the given region.
func GetLambdaLayer(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := lambda.NewFromConfig(client.ConfigForRegion(region))

	output, err := svc.ListLayerVersions(ctx, &lambda.ListLayerVersionsInput{
		LayerName: &id,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get Lambda layer %s in %s: %w", id, region, err)
	}

	if len(output.LayerVersions) > 0 {
		m, err := StructToMap(output.LayerVersions[0])
		if err != nil {
			return nil, fmt.Errorf("failed to convert Lambda layer version to map: %w", err)
		}
		m["Region"] = region
		return m, nil
	}

	m := map[string]interface{}{
		"LayerName": id,
		"Region":    region,
	}
	return m, nil
}

// ===== Lambda EventSourceMapping =====

// ListLambdaEventSourceMappings lists all Lambda event source mappings in the given region.
func ListLambdaEventSourceMappings(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := lambda.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	paginator := lambda.NewListEventSourceMappingsPaginator(svc, &lambda.ListEventSourceMappingsInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list Lambda event source mappings in %s: %w", region, err)
		}
		for _, esm := range page.EventSourceMappings {
			m, err := StructToMap(esm)
			if err != nil {
				return nil, fmt.Errorf("failed to convert Lambda event source mapping to map: %w", err)
			}
			m["Region"] = region
			results = append(results, m)
		}
	}

	return results, nil
}

// GetLambdaEventSourceMapping gets a single Lambda event source mapping by UUID in the given region.
func GetLambdaEventSourceMapping(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := lambda.NewFromConfig(client.ConfigForRegion(region))

	result, err := svc.GetEventSourceMapping(ctx, &lambda.GetEventSourceMappingInput{
		UUID: &id,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get Lambda event source mapping %s in %s: %w", id, region, err)
	}

	m, err := StructToMap(result)
	if err != nil {
		return nil, fmt.Errorf("failed to convert Lambda event source mapping to map: %w", err)
	}
	m["Region"] = region

	return m, nil
}
