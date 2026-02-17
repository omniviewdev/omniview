package resourcers

import (
	"context"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/service/apigatewayv2"

	"github.com/omniviewdev/aws-plugin/pkg/plugin/resource/clients"
)

// ===== API Gateway HTTP API =====

// ListAPIGatewayAPIs lists all API Gateway v2 HTTP APIs in the given region.
func ListAPIGatewayAPIs(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := apigatewayv2.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	output, err := svc.GetApis(ctx, &apigatewayv2.GetApisInput{})
	if err != nil {
		return nil, fmt.Errorf("failed to list API Gateway APIs in %s: %w", region, err)
	}

	for _, api := range output.Items {
		m, err := StructToMap(api)
		if err != nil {
			return nil, fmt.Errorf("failed to convert API Gateway API to map: %w", err)
		}
		m["Region"] = region
		results = append(results, m)
	}

	return results, nil
}

// GetAPIGatewayAPI gets a single API Gateway v2 HTTP API by ID in the given region.
func GetAPIGatewayAPI(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := apigatewayv2.NewFromConfig(client.ConfigForRegion(region))

	output, err := svc.GetApi(ctx, &apigatewayv2.GetApiInput{
		ApiId: &id,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get API Gateway API %s in %s: %w", id, region, err)
	}

	m, err := StructToMap(output)
	if err != nil {
		return nil, fmt.Errorf("failed to convert API Gateway API to map: %w", err)
	}
	m["Region"] = region

	return m, nil
}

// ===== API Gateway Stage =====

// ListAPIGatewayStages lists all stages across all APIs in the given region.
func ListAPIGatewayStages(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := apigatewayv2.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	apisOutput, err := svc.GetApis(ctx, &apigatewayv2.GetApisInput{})
	if err != nil {
		return nil, fmt.Errorf("failed to list API Gateway APIs in %s: %w", region, err)
	}

	for _, api := range apisOutput.Items {
		stagesOutput, err := svc.GetStages(ctx, &apigatewayv2.GetStagesInput{
			ApiId: api.ApiId,
		})
		if err != nil {
			continue
		}
		for _, stage := range stagesOutput.Items {
			m, err := StructToMap(stage)
			if err != nil {
				continue
			}
			m["Region"] = region
			m["ApiId"] = *api.ApiId
			results = append(results, m)
		}
	}

	return results, nil
}

// GetAPIGatewayStage gets a single API Gateway stage by ID in the given region.
// The id must be in the format "apiId/stageName".
func GetAPIGatewayStage(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := apigatewayv2.NewFromConfig(client.ConfigForRegion(region))

	// Parse "apiId/stageName"
	var apiID, stageName string
	for i := 0; i < len(id); i++ {
		if id[i] == '/' {
			apiID = id[:i]
			stageName = id[i+1:]
			break
		}
	}
	if apiID == "" || stageName == "" {
		return nil, fmt.Errorf("invalid API Gateway stage ID %q: expected format apiId/stageName", id)
	}

	output, err := svc.GetStage(ctx, &apigatewayv2.GetStageInput{
		ApiId:     &apiID,
		StageName: &stageName,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get API Gateway stage %s in %s: %w", id, region, err)
	}

	m, err := StructToMap(output)
	if err != nil {
		return nil, fmt.Errorf("failed to convert API Gateway stage to map: %w", err)
	}
	m["Region"] = region
	m["ApiId"] = apiID

	return m, nil
}

// ===== API Gateway Domain Name =====

// ListAPIGatewayDomainNames lists all API Gateway domain names in the given region.
func ListAPIGatewayDomainNames(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := apigatewayv2.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	output, err := svc.GetDomainNames(ctx, &apigatewayv2.GetDomainNamesInput{})
	if err != nil {
		return nil, fmt.Errorf("failed to list API Gateway domain names in %s: %w", region, err)
	}

	for _, dn := range output.Items {
		m, err := StructToMap(dn)
		if err != nil {
			return nil, fmt.Errorf("failed to convert API Gateway domain name to map: %w", err)
		}
		m["Region"] = region
		results = append(results, m)
	}

	return results, nil
}

// GetAPIGatewayDomainName gets a single API Gateway domain name in the given region.
func GetAPIGatewayDomainName(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := apigatewayv2.NewFromConfig(client.ConfigForRegion(region))

	output, err := svc.GetDomainName(ctx, &apigatewayv2.GetDomainNameInput{
		DomainName: &id,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get API Gateway domain name %s in %s: %w", id, region, err)
	}

	m, err := StructToMap(output)
	if err != nil {
		return nil, fmt.Errorf("failed to convert API Gateway domain name to map: %w", err)
	}
	m["Region"] = region

	return m, nil
}
