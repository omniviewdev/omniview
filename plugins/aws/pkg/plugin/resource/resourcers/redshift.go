package resourcers

import (
	"context"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/service/redshift"

	"github.com/omniviewdev/aws-plugin/pkg/plugin/resource/clients"
)

// ===== Redshift Cluster =====

// ListRedshiftClusters lists all Redshift clusters in the given region.
func ListRedshiftClusters(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := redshift.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	paginator := redshift.NewDescribeClustersPaginator(svc, &redshift.DescribeClustersInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list Redshift clusters in %s: %w", region, err)
		}
		for _, cluster := range page.Clusters {
			m, err := StructToMap(cluster)
			if err != nil {
				return nil, fmt.Errorf("failed to convert Redshift cluster to map: %w", err)
			}
			m["Region"] = region
			results = append(results, m)
		}
	}

	return results, nil
}

// GetRedshiftCluster gets a single Redshift cluster by identifier in the given region.
func GetRedshiftCluster(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := redshift.NewFromConfig(client.ConfigForRegion(region))

	output, err := svc.DescribeClusters(ctx, &redshift.DescribeClustersInput{
		ClusterIdentifier: &id,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get Redshift cluster %s in %s: %w", id, region, err)
	}

	if len(output.Clusters) == 0 {
		return nil, fmt.Errorf("Redshift cluster %s not found in %s", id, region)
	}

	cluster := output.Clusters[0]
	m, err := StructToMap(cluster)
	if err != nil {
		return nil, fmt.Errorf("failed to convert Redshift cluster to map: %w", err)
	}
	m["Region"] = region

	return m, nil
}

// ===== Redshift SubnetGroup =====

// ListRedshiftSubnetGroups lists all Redshift cluster subnet groups in the given region.
func ListRedshiftSubnetGroups(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := redshift.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	paginator := redshift.NewDescribeClusterSubnetGroupsPaginator(svc, &redshift.DescribeClusterSubnetGroupsInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list Redshift subnet groups in %s: %w", region, err)
		}
		for _, sg := range page.ClusterSubnetGroups {
			m, err := StructToMap(sg)
			if err != nil {
				return nil, fmt.Errorf("failed to convert Redshift subnet group to map: %w", err)
			}
			m["Region"] = region
			results = append(results, m)
		}
	}

	return results, nil
}

// GetRedshiftSubnetGroup gets a single Redshift cluster subnet group by name in the given region.
func GetRedshiftSubnetGroup(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := redshift.NewFromConfig(client.ConfigForRegion(region))

	output, err := svc.DescribeClusterSubnetGroups(ctx, &redshift.DescribeClusterSubnetGroupsInput{
		ClusterSubnetGroupName: &id,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get Redshift subnet group %s in %s: %w", id, region, err)
	}

	if len(output.ClusterSubnetGroups) == 0 {
		return nil, fmt.Errorf("Redshift subnet group %s not found in %s", id, region)
	}

	sg := output.ClusterSubnetGroups[0]
	m, err := StructToMap(sg)
	if err != nil {
		return nil, fmt.Errorf("failed to convert Redshift subnet group to map: %w", err)
	}
	m["Region"] = region

	return m, nil
}
