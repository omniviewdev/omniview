package resourcers

import (
	"context"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/service/secretsmanager"

	"github.com/omniviewdev/aws-plugin/pkg/plugin/resource/clients"
)

// ===== Secrets Manager Secret =====

// ListSecrets lists all secrets in the given region.
func ListSecrets(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := secretsmanager.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	paginator := secretsmanager.NewListSecretsPaginator(svc, &secretsmanager.ListSecretsInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list secrets in %s: %w", region, err)
		}
		for _, secret := range page.SecretList {
			m, err := StructToMap(secret)
			if err != nil {
				return nil, fmt.Errorf("failed to convert secret to map: %w", err)
			}
			m["Region"] = region
			results = append(results, m)
		}
	}

	return results, nil
}

// GetSecret gets a single secret by name in the given region.
// Note: This uses DescribeSecret, NOT GetSecretValue, to avoid exposing secret data.
func GetSecret(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := secretsmanager.NewFromConfig(client.ConfigForRegion(region))

	output, err := svc.DescribeSecret(ctx, &secretsmanager.DescribeSecretInput{
		SecretId: &id,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get secret %s in %s: %w", id, region, err)
	}

	m, err := StructToMap(output)
	if err != nil {
		return nil, fmt.Errorf("failed to convert secret to map: %w", err)
	}
	m["Region"] = region

	return m, nil
}
