package resourcers

import (
	"context"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/service/cloudwatch"
	"github.com/aws/aws-sdk-go-v2/service/cloudwatchlogs"

	"github.com/omniviewdev/aws-plugin/pkg/plugin/resource/clients"
)

// ===== CloudWatch Alarm =====

// ListCloudWatchAlarms lists all CloudWatch metric alarms in the given region.
func ListCloudWatchAlarms(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := cloudwatch.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	paginator := cloudwatch.NewDescribeAlarmsPaginator(svc, &cloudwatch.DescribeAlarmsInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list CloudWatch alarms in %s: %w", region, err)
		}
		for _, alarm := range page.MetricAlarms {
			m, err := StructToMap(alarm)
			if err != nil {
				return nil, fmt.Errorf("failed to convert CloudWatch alarm to map: %w", err)
			}
			m["Region"] = region
			results = append(results, m)
		}
	}

	return results, nil
}

// GetCloudWatchAlarm gets a single CloudWatch alarm by name in the given region.
func GetCloudWatchAlarm(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := cloudwatch.NewFromConfig(client.ConfigForRegion(region))

	output, err := svc.DescribeAlarms(ctx, &cloudwatch.DescribeAlarmsInput{
		AlarmNames: []string{id},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get CloudWatch alarm %s in %s: %w", id, region, err)
	}

	if len(output.MetricAlarms) == 0 {
		return nil, fmt.Errorf("CloudWatch alarm %s not found in %s", id, region)
	}

	alarm := output.MetricAlarms[0]
	m, err := StructToMap(alarm)
	if err != nil {
		return nil, fmt.Errorf("failed to convert CloudWatch alarm to map: %w", err)
	}
	m["Region"] = region

	return m, nil
}

// ===== CloudWatch Dashboard =====

// ListCloudWatchDashboards lists all CloudWatch dashboards in the given region.
func ListCloudWatchDashboards(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := cloudwatch.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	paginator := cloudwatch.NewListDashboardsPaginator(svc, &cloudwatch.ListDashboardsInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list CloudWatch dashboards in %s: %w", region, err)
		}
		for _, dashboard := range page.DashboardEntries {
			m, err := StructToMap(dashboard)
			if err != nil {
				return nil, fmt.Errorf("failed to convert CloudWatch dashboard to map: %w", err)
			}
			m["Region"] = region
			results = append(results, m)
		}
	}

	return results, nil
}

// GetCloudWatchDashboard gets a single CloudWatch dashboard by name in the given region.
func GetCloudWatchDashboard(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := cloudwatch.NewFromConfig(client.ConfigForRegion(region))

	output, err := svc.GetDashboard(ctx, &cloudwatch.GetDashboardInput{
		DashboardName: &id,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get CloudWatch dashboard %s in %s: %w", id, region, err)
	}

	m := map[string]interface{}{
		"DashboardName": id,
		"DashboardArn":  "",
		"Region":        region,
	}
	if output.DashboardArn != nil {
		m["DashboardArn"] = *output.DashboardArn
	}
	if output.DashboardName != nil {
		m["DashboardName"] = *output.DashboardName
	}

	return m, nil
}

// ===== CloudWatch Log Group =====

// ListCloudWatchLogGroups lists all CloudWatch log groups in the given region.
func ListCloudWatchLogGroups(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	logsSvc := cloudwatchlogs.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	paginator := cloudwatchlogs.NewDescribeLogGroupsPaginator(logsSvc, &cloudwatchlogs.DescribeLogGroupsInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list CloudWatch log groups in %s: %w", region, err)
		}
		for _, logGroup := range page.LogGroups {
			m, err := StructToMap(logGroup)
			if err != nil {
				return nil, fmt.Errorf("failed to convert CloudWatch log group to map: %w", err)
			}
			m["Region"] = region
			results = append(results, m)
		}
	}

	return results, nil
}

// GetCloudWatchLogGroup gets a single CloudWatch log group by name in the given region.
func GetCloudWatchLogGroup(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	logsSvc := cloudwatchlogs.NewFromConfig(client.ConfigForRegion(region))

	output, err := logsSvc.DescribeLogGroups(ctx, &cloudwatchlogs.DescribeLogGroupsInput{
		LogGroupNamePrefix: &id,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get CloudWatch log group %s in %s: %w", id, region, err)
	}

	if len(output.LogGroups) == 0 {
		return nil, fmt.Errorf("CloudWatch log group %s not found in %s", id, region)
	}

	// Find exact match by name, or return the first result.
	for _, logGroup := range output.LogGroups {
		if logGroup.LogGroupName != nil && *logGroup.LogGroupName == id {
			m, err := StructToMap(logGroup)
			if err != nil {
				return nil, fmt.Errorf("failed to convert CloudWatch log group to map: %w", err)
			}
			m["Region"] = region
			return m, nil
		}
	}

	// No exact match found; return the first result.
	logGroup := output.LogGroups[0]
	m, err := StructToMap(logGroup)
	if err != nil {
		return nil, fmt.Errorf("failed to convert CloudWatch log group to map: %w", err)
	}
	m["Region"] = region

	return m, nil
}
