package resourcers

import (
	"context"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/service/cloudformation"

	"github.com/omniviewdev/aws-plugin/pkg/plugin/resource/clients"
)

// ===== CloudFormation Stack =====

// ListCloudFormationStacks lists all CloudFormation stacks in the given region.
func ListCloudFormationStacks(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := cloudformation.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	paginator := cloudformation.NewDescribeStacksPaginator(svc, &cloudformation.DescribeStacksInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list CloudFormation stacks in %s: %w", region, err)
		}
		for _, stack := range page.Stacks {
			m, err := StructToMap(stack)
			if err != nil {
				return nil, fmt.Errorf("failed to convert CloudFormation stack to map: %w", err)
			}
			m["Region"] = region
			results = append(results, m)
		}
	}

	return results, nil
}

// GetCloudFormationStack gets a single CloudFormation stack by name in the given region.
func GetCloudFormationStack(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := cloudformation.NewFromConfig(client.ConfigForRegion(region))

	output, err := svc.DescribeStacks(ctx, &cloudformation.DescribeStacksInput{
		StackName: &id,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get CloudFormation stack %s in %s: %w", id, region, err)
	}

	if len(output.Stacks) == 0 {
		return nil, fmt.Errorf("CloudFormation stack %s not found in %s", id, region)
	}

	stack := output.Stacks[0]
	m, err := StructToMap(stack)
	if err != nil {
		return nil, fmt.Errorf("failed to convert CloudFormation stack to map: %w", err)
	}
	m["Region"] = region

	return m, nil
}

// ===== CloudFormation StackSet =====

// ListCloudFormationStackSets lists all CloudFormation stack sets in the given region.
func ListCloudFormationStackSets(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := cloudformation.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	paginator := cloudformation.NewListStackSetsPaginator(svc, &cloudformation.ListStackSetsInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list CloudFormation stack sets in %s: %w", region, err)
		}
		for _, ss := range page.Summaries {
			m, err := StructToMap(ss)
			if err != nil {
				continue
			}
			m["Region"] = region
			results = append(results, m)
		}
	}

	return results, nil
}

// GetCloudFormationStackSet gets a single CloudFormation stack set by name in the given region.
func GetCloudFormationStackSet(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := cloudformation.NewFromConfig(client.ConfigForRegion(region))

	output, err := svc.DescribeStackSet(ctx, &cloudformation.DescribeStackSetInput{
		StackSetName: &id,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get CloudFormation stack set %s in %s: %w", id, region, err)
	}

	m, err := StructToMap(output.StackSet)
	if err != nil {
		return nil, fmt.Errorf("failed to convert CloudFormation stack set to map: %w", err)
	}
	m["Region"] = region

	return m, nil
}
