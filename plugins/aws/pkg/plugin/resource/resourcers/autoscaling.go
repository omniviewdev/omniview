package resourcers

import (
	"context"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/service/autoscaling"

	"github.com/omniviewdev/aws-plugin/pkg/plugin/resource/clients"
)

// ===== Auto Scaling Group =====

// ListAutoScalingGroups lists all Auto Scaling groups in the given region.
func ListAutoScalingGroups(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := autoscaling.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	paginator := autoscaling.NewDescribeAutoScalingGroupsPaginator(svc, &autoscaling.DescribeAutoScalingGroupsInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list Auto Scaling groups in %s: %w", region, err)
		}
		for _, group := range page.AutoScalingGroups {
			m, err := StructToMap(group)
			if err != nil {
				return nil, fmt.Errorf("failed to convert Auto Scaling group to map: %w", err)
			}
			m["Region"] = region
			results = append(results, m)
		}
	}

	return results, nil
}

// GetAutoScalingGroup gets a single Auto Scaling group by name in the given region.
func GetAutoScalingGroup(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := autoscaling.NewFromConfig(client.ConfigForRegion(region))

	output, err := svc.DescribeAutoScalingGroups(ctx, &autoscaling.DescribeAutoScalingGroupsInput{
		AutoScalingGroupNames: []string{id},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get Auto Scaling group %s in %s: %w", id, region, err)
	}

	if len(output.AutoScalingGroups) == 0 {
		return nil, fmt.Errorf("Auto Scaling group %s not found in %s", id, region)
	}

	group := output.AutoScalingGroups[0]
	m, err := StructToMap(group)
	if err != nil {
		return nil, fmt.Errorf("failed to convert Auto Scaling group to map: %w", err)
	}
	m["Region"] = region

	return m, nil
}

// ===== Launch Configuration =====

// ListLaunchConfigurations lists all launch configurations in the given region.
func ListLaunchConfigurations(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := autoscaling.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	paginator := autoscaling.NewDescribeLaunchConfigurationsPaginator(svc, &autoscaling.DescribeLaunchConfigurationsInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list launch configurations in %s: %w", region, err)
		}
		for _, lc := range page.LaunchConfigurations {
			m, err := StructToMap(lc)
			if err != nil {
				return nil, fmt.Errorf("failed to convert launch configuration to map: %w", err)
			}
			m["Region"] = region
			results = append(results, m)
		}
	}

	return results, nil
}

// GetLaunchConfiguration gets a single launch configuration by name in the given region.
func GetLaunchConfiguration(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := autoscaling.NewFromConfig(client.ConfigForRegion(region))

	output, err := svc.DescribeLaunchConfigurations(ctx, &autoscaling.DescribeLaunchConfigurationsInput{
		LaunchConfigurationNames: []string{id},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get launch configuration %s in %s: %w", id, region, err)
	}

	if len(output.LaunchConfigurations) == 0 {
		return nil, fmt.Errorf("launch configuration %s not found in %s", id, region)
	}

	lc := output.LaunchConfigurations[0]
	m, err := StructToMap(lc)
	if err != nil {
		return nil, fmt.Errorf("failed to convert launch configuration to map: %w", err)
	}
	m["Region"] = region

	return m, nil
}

// ===== Scaling Policy =====

// ListScalingPolicies lists all scaling policies in the given region.
func ListScalingPolicies(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := autoscaling.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	paginator := autoscaling.NewDescribePoliciesPaginator(svc, &autoscaling.DescribePoliciesInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list scaling policies in %s: %w", region, err)
		}
		for _, policy := range page.ScalingPolicies {
			m, err := StructToMap(policy)
			if err != nil {
				return nil, fmt.Errorf("failed to convert scaling policy to map: %w", err)
			}
			m["Region"] = region
			results = append(results, m)
		}
	}

	return results, nil
}

// GetScalingPolicy gets a single scaling policy by name in the given region.
func GetScalingPolicy(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := autoscaling.NewFromConfig(client.ConfigForRegion(region))

	output, err := svc.DescribePolicies(ctx, &autoscaling.DescribePoliciesInput{
		PolicyNames: []string{id},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get scaling policy %s in %s: %w", id, region, err)
	}

	if len(output.ScalingPolicies) == 0 {
		return nil, fmt.Errorf("scaling policy %s not found in %s", id, region)
	}

	policy := output.ScalingPolicies[0]
	m, err := StructToMap(policy)
	if err != nil {
		return nil, fmt.Errorf("failed to convert scaling policy to map: %w", err)
	}
	m["Region"] = region

	return m, nil
}
