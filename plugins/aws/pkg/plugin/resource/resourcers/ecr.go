package resourcers

import (
	"context"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/service/ecr"

	"github.com/omniviewdev/aws-plugin/pkg/plugin/resource/clients"
)

// ===== ECR Repository =====

// ListECRRepositories lists all ECR repositories in the given region.
func ListECRRepositories(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := ecr.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	paginator := ecr.NewDescribeRepositoriesPaginator(svc, &ecr.DescribeRepositoriesInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list ECR repositories in %s: %w", region, err)
		}
		for _, repo := range page.Repositories {
			m, err := StructToMap(repo)
			if err != nil {
				return nil, fmt.Errorf("failed to convert ECR repository to map: %w", err)
			}
			m["Region"] = region
			results = append(results, m)
		}
	}

	return results, nil
}

// GetECRRepository gets a single ECR repository by name in the given region.
func GetECRRepository(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := ecr.NewFromConfig(client.ConfigForRegion(region))

	output, err := svc.DescribeRepositories(ctx, &ecr.DescribeRepositoriesInput{
		RepositoryNames: []string{id},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get ECR repository %s in %s: %w", id, region, err)
	}

	if len(output.Repositories) == 0 {
		return nil, fmt.Errorf("ECR repository %s not found in %s", id, region)
	}

	repo := output.Repositories[0]
	m, err := StructToMap(repo)
	if err != nil {
		return nil, fmt.Errorf("failed to convert ECR repository to map: %w", err)
	}
	m["Region"] = region

	return m, nil
}
