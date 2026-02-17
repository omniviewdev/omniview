package resourcers

import (
	"context"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/service/cloudfront"

	"github.com/omniviewdev/aws-plugin/pkg/plugin/resource/clients"
)

// ===== CloudFront Distribution =====

// ListCloudFrontDistributions lists all CloudFront distributions globally.
func ListCloudFrontDistributions(ctx context.Context, client *clients.Client) ([]map[string]interface{}, error) {
	svc := cloudfront.NewFromConfig(client.Config)
	results := make([]map[string]interface{}, 0)

	var marker *string
	for {
		output, err := svc.ListDistributions(ctx, &cloudfront.ListDistributionsInput{
			Marker: marker,
		})
		if err != nil {
			return nil, fmt.Errorf("failed to list CloudFront distributions: %w", err)
		}

		if output.DistributionList != nil {
			for _, dist := range output.DistributionList.Items {
				m, err := StructToMap(dist)
				if err != nil {
					return nil, fmt.Errorf("failed to convert CloudFront distribution to map: %w", err)
				}
				results = append(results, m)
			}

			if output.DistributionList.IsTruncated != nil && *output.DistributionList.IsTruncated {
				marker = output.DistributionList.NextMarker
			} else {
				break
			}
		} else {
			break
		}
	}

	return results, nil
}

// GetCloudFrontDistribution gets a single CloudFront distribution by ID.
func GetCloudFrontDistribution(ctx context.Context, client *clients.Client, id string) (map[string]interface{}, error) {
	svc := cloudfront.NewFromConfig(client.Config)

	result, err := svc.GetDistribution(ctx, &cloudfront.GetDistributionInput{
		Id: &id,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get CloudFront distribution %s: %w", id, err)
	}

	m, err := StructToMap(result.Distribution)
	if err != nil {
		return nil, fmt.Errorf("failed to convert CloudFront distribution to map: %w", err)
	}

	return m, nil
}

// ===== CloudFront CachePolicy =====

// ListCloudFrontCachePolicies lists all CloudFront cache policies globally.
func ListCloudFrontCachePolicies(ctx context.Context, client *clients.Client) ([]map[string]interface{}, error) {
	svc := cloudfront.NewFromConfig(client.Config)
	results := make([]map[string]interface{}, 0)

	output, err := svc.ListCachePolicies(ctx, &cloudfront.ListCachePoliciesInput{})
	if err != nil {
		return nil, fmt.Errorf("failed to list CloudFront cache policies: %w", err)
	}

	if output.CachePolicyList != nil {
		for _, item := range output.CachePolicyList.Items {
			m, err := StructToMap(item)
			if err != nil {
				return nil, fmt.Errorf("failed to convert CloudFront cache policy to map: %w", err)
			}
			results = append(results, m)
		}
	}

	return results, nil
}

// GetCloudFrontCachePolicy gets a single CloudFront cache policy by ID.
func GetCloudFrontCachePolicy(ctx context.Context, client *clients.Client, id string) (map[string]interface{}, error) {
	svc := cloudfront.NewFromConfig(client.Config)

	result, err := svc.GetCachePolicy(ctx, &cloudfront.GetCachePolicyInput{
		Id: &id,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get CloudFront cache policy %s: %w", id, err)
	}

	m, err := StructToMap(result.CachePolicy)
	if err != nil {
		return nil, fmt.Errorf("failed to convert CloudFront cache policy to map: %w", err)
	}

	return m, nil
}
