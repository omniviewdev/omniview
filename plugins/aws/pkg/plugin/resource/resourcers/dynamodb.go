package resourcers

import (
	"context"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/service/dynamodb"

	"github.com/omniviewdev/aws-plugin/pkg/plugin/resource/clients"
)

// ===== DynamoDB Table =====

// ListDynamoDBTables lists all DynamoDB tables in the given region.
func ListDynamoDBTables(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := dynamodb.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	paginator := dynamodb.NewListTablesPaginator(svc, &dynamodb.ListTablesInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list DynamoDB tables in %s: %w", region, err)
		}
		for _, name := range page.TableNames {
			// Get full table details for each table.
			describeOutput, err := svc.DescribeTable(ctx, &dynamodb.DescribeTableInput{
				TableName: &name,
			})
			if err != nil {
				return nil, fmt.Errorf("failed to describe DynamoDB table %s in %s: %w", name, region, err)
			}
			m, err := StructToMap(describeOutput.Table)
			if err != nil {
				return nil, fmt.Errorf("failed to convert DynamoDB table to map: %w", err)
			}
			m["Region"] = region
			results = append(results, m)
		}
	}

	return results, nil
}

// GetDynamoDBTable gets a single DynamoDB table by name in the given region.
func GetDynamoDBTable(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := dynamodb.NewFromConfig(client.ConfigForRegion(region))

	result, err := svc.DescribeTable(ctx, &dynamodb.DescribeTableInput{
		TableName: &id,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get DynamoDB table %s in %s: %w", id, region, err)
	}

	m, err := StructToMap(result.Table)
	if err != nil {
		return nil, fmt.Errorf("failed to convert DynamoDB table to map: %w", err)
	}
	m["Region"] = region

	return m, nil
}
