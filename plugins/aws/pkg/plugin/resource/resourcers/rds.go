package resourcers

import (
	"context"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/service/rds"

	"github.com/omniviewdev/aws-plugin/pkg/plugin/resource/clients"
)

// ===== RDS DBInstance =====

// ListRDSInstances lists all RDS DB instances in the given region.
func ListRDSInstances(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := rds.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	paginator := rds.NewDescribeDBInstancesPaginator(svc, &rds.DescribeDBInstancesInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list RDS instances in %s: %w", region, err)
		}
		for _, instance := range page.DBInstances {
			m, err := StructToMap(instance)
			if err != nil {
				return nil, fmt.Errorf("failed to convert RDS instance to map: %w", err)
			}
			m["Region"] = region
			results = append(results, m)
		}
	}

	return results, nil
}

// GetRDSInstance gets a single RDS DB instance by identifier in the given region.
func GetRDSInstance(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := rds.NewFromConfig(client.ConfigForRegion(region))

	output, err := svc.DescribeDBInstances(ctx, &rds.DescribeDBInstancesInput{
		DBInstanceIdentifier: &id,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get RDS instance %s in %s: %w", id, region, err)
	}

	if len(output.DBInstances) == 0 {
		return nil, fmt.Errorf("RDS instance %s not found in %s", id, region)
	}

	m, err := StructToMap(output.DBInstances[0])
	if err != nil {
		return nil, fmt.Errorf("failed to convert RDS instance to map: %w", err)
	}
	m["Region"] = region

	return m, nil
}

// ===== RDS DBCluster =====

// ListRDSClusters lists all RDS DB clusters in the given region.
func ListRDSClusters(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := rds.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	paginator := rds.NewDescribeDBClustersPaginator(svc, &rds.DescribeDBClustersInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list RDS clusters in %s: %w", region, err)
		}
		for _, cluster := range page.DBClusters {
			m, err := StructToMap(cluster)
			if err != nil {
				return nil, fmt.Errorf("failed to convert RDS cluster to map: %w", err)
			}
			m["Region"] = region
			results = append(results, m)
		}
	}

	return results, nil
}

// GetRDSCluster gets a single RDS DB cluster by identifier in the given region.
func GetRDSCluster(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := rds.NewFromConfig(client.ConfigForRegion(region))

	output, err := svc.DescribeDBClusters(ctx, &rds.DescribeDBClustersInput{
		DBClusterIdentifier: &id,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get RDS cluster %s in %s: %w", id, region, err)
	}

	if len(output.DBClusters) == 0 {
		return nil, fmt.Errorf("RDS cluster %s not found in %s", id, region)
	}

	m, err := StructToMap(output.DBClusters[0])
	if err != nil {
		return nil, fmt.Errorf("failed to convert RDS cluster to map: %w", err)
	}
	m["Region"] = region

	return m, nil
}

// ===== RDS DBSubnetGroup =====

// ListRDSSubnetGroups lists all RDS DB subnet groups in the given region.
func ListRDSSubnetGroups(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := rds.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	paginator := rds.NewDescribeDBSubnetGroupsPaginator(svc, &rds.DescribeDBSubnetGroupsInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list RDS subnet groups in %s: %w", region, err)
		}
		for _, group := range page.DBSubnetGroups {
			m, err := StructToMap(group)
			if err != nil {
				return nil, fmt.Errorf("failed to convert RDS subnet group to map: %w", err)
			}
			m["Region"] = region
			results = append(results, m)
		}
	}

	return results, nil
}

// GetRDSSubnetGroup gets a single RDS DB subnet group by name in the given region.
func GetRDSSubnetGroup(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := rds.NewFromConfig(client.ConfigForRegion(region))

	output, err := svc.DescribeDBSubnetGroups(ctx, &rds.DescribeDBSubnetGroupsInput{
		DBSubnetGroupName: &id,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get RDS subnet group %s in %s: %w", id, region, err)
	}

	if len(output.DBSubnetGroups) == 0 {
		return nil, fmt.Errorf("RDS subnet group %s not found in %s", id, region)
	}

	m, err := StructToMap(output.DBSubnetGroups[0])
	if err != nil {
		return nil, fmt.Errorf("failed to convert RDS subnet group to map: %w", err)
	}
	m["Region"] = region

	return m, nil
}

// ===== RDS DBSnapshot =====

// ListRDSSnapshots lists all RDS DB snapshots in the given region.
func ListRDSSnapshots(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := rds.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	paginator := rds.NewDescribeDBSnapshotsPaginator(svc, &rds.DescribeDBSnapshotsInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list RDS snapshots in %s: %w", region, err)
		}
		for _, snapshot := range page.DBSnapshots {
			m, err := StructToMap(snapshot)
			if err != nil {
				return nil, fmt.Errorf("failed to convert RDS snapshot to map: %w", err)
			}
			m["Region"] = region
			results = append(results, m)
		}
	}

	return results, nil
}

// GetRDSSnapshot gets a single RDS DB snapshot by identifier in the given region.
func GetRDSSnapshot(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := rds.NewFromConfig(client.ConfigForRegion(region))

	output, err := svc.DescribeDBSnapshots(ctx, &rds.DescribeDBSnapshotsInput{
		DBSnapshotIdentifier: &id,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get RDS snapshot %s in %s: %w", id, region, err)
	}

	if len(output.DBSnapshots) == 0 {
		return nil, fmt.Errorf("RDS snapshot %s not found in %s", id, region)
	}

	m, err := StructToMap(output.DBSnapshots[0])
	if err != nil {
		return nil, fmt.Errorf("failed to convert RDS snapshot to map: %w", err)
	}
	m["Region"] = region

	return m, nil
}

// ===== RDS DBParameterGroup =====

// ListRDSParameterGroups lists all RDS DB parameter groups in the given region.
func ListRDSParameterGroups(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := rds.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	paginator := rds.NewDescribeDBParameterGroupsPaginator(svc, &rds.DescribeDBParameterGroupsInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list RDS parameter groups in %s: %w", region, err)
		}
		for _, group := range page.DBParameterGroups {
			m, err := StructToMap(group)
			if err != nil {
				return nil, fmt.Errorf("failed to convert RDS parameter group to map: %w", err)
			}
			m["Region"] = region
			results = append(results, m)
		}
	}

	return results, nil
}

// GetRDSParameterGroup gets a single RDS DB parameter group by name in the given region.
func GetRDSParameterGroup(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := rds.NewFromConfig(client.ConfigForRegion(region))

	output, err := svc.DescribeDBParameterGroups(ctx, &rds.DescribeDBParameterGroupsInput{
		DBParameterGroupName: &id,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get RDS parameter group %s in %s: %w", id, region, err)
	}

	if len(output.DBParameterGroups) == 0 {
		return nil, fmt.Errorf("RDS parameter group %s not found in %s", id, region)
	}

	m, err := StructToMap(output.DBParameterGroups[0])
	if err != nil {
		return nil, fmt.Errorf("failed to convert RDS parameter group to map: %w", err)
	}
	m["Region"] = region

	return m, nil
}
