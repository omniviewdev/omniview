package resourcers

import (
	"context"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/service/kms"

	"github.com/omniviewdev/aws-plugin/pkg/plugin/resource/clients"
)

// ===== KMS Key =====

// ListKMSKeys lists all KMS keys in the given region.
func ListKMSKeys(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := kms.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	paginator := kms.NewListKeysPaginator(svc, &kms.ListKeysInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list KMS keys in %s: %w", region, err)
		}
		for _, key := range page.Keys {
			describeOutput, err := svc.DescribeKey(ctx, &kms.DescribeKeyInput{
				KeyId: key.KeyId,
			})
			if err != nil {
				continue
			}
			m, err := StructToMap(describeOutput.KeyMetadata)
			if err != nil {
				continue
			}
			m["Region"] = region
			results = append(results, m)
		}
	}

	return results, nil
}

// GetKMSKey gets a single KMS key by ID in the given region.
func GetKMSKey(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := kms.NewFromConfig(client.ConfigForRegion(region))

	output, err := svc.DescribeKey(ctx, &kms.DescribeKeyInput{
		KeyId: &id,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get KMS key %s in %s: %w", id, region, err)
	}

	m, err := StructToMap(output.KeyMetadata)
	if err != nil {
		return nil, fmt.Errorf("failed to convert KMS key to map: %w", err)
	}
	m["Region"] = region

	return m, nil
}

// ===== KMS Alias =====

// ListKMSAliases lists all KMS aliases in the given region.
func ListKMSAliases(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := kms.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	paginator := kms.NewListAliasesPaginator(svc, &kms.ListAliasesInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list KMS aliases in %s: %w", region, err)
		}
		for _, alias := range page.Aliases {
			m, err := StructToMap(alias)
			if err != nil {
				return nil, fmt.Errorf("failed to convert KMS alias to map: %w", err)
			}
			m["Region"] = region
			results = append(results, m)
		}
	}

	return results, nil
}

// GetKMSAlias gets a single KMS alias by name in the given region.
func GetKMSAlias(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := kms.NewFromConfig(client.ConfigForRegion(region))

	output, err := svc.ListAliases(ctx, &kms.ListAliasesInput{})
	if err != nil {
		return nil, fmt.Errorf("failed to list KMS aliases in %s: %w", region, err)
	}

	for _, alias := range output.Aliases {
		if alias.AliasName != nil && *alias.AliasName == id {
			m, err := StructToMap(alias)
			if err != nil {
				return nil, fmt.Errorf("failed to convert KMS alias to map: %w", err)
			}
			m["Region"] = region
			return m, nil
		}
	}

	return nil, fmt.Errorf("KMS alias %s not found in %s", id, region)
}
