package resourcers

import (
	"context"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/service/elasticache"

	"github.com/omniviewdev/aws-plugin/pkg/plugin/resource/clients"
)

// ===== ElastiCache CacheCluster =====

// ListElastiCacheClusters lists all ElastiCache clusters in the given region.
func ListElastiCacheClusters(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := elasticache.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	paginator := elasticache.NewDescribeCacheClustersPaginator(svc, &elasticache.DescribeCacheClustersInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list ElastiCache clusters in %s: %w", region, err)
		}
		for _, cluster := range page.CacheClusters {
			m, err := StructToMap(cluster)
			if err != nil {
				return nil, fmt.Errorf("failed to convert ElastiCache cluster to map: %w", err)
			}
			m["Region"] = region
			results = append(results, m)
		}
	}

	return results, nil
}

// GetElastiCacheCluster gets a single ElastiCache cluster by ID in the given region.
func GetElastiCacheCluster(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := elasticache.NewFromConfig(client.ConfigForRegion(region))

	output, err := svc.DescribeCacheClusters(ctx, &elasticache.DescribeCacheClustersInput{
		CacheClusterId: &id,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get ElastiCache cluster %s in %s: %w", id, region, err)
	}

	if len(output.CacheClusters) == 0 {
		return nil, fmt.Errorf("ElastiCache cluster %s not found in %s", id, region)
	}

	cluster := output.CacheClusters[0]
	m, err := StructToMap(cluster)
	if err != nil {
		return nil, fmt.Errorf("failed to convert ElastiCache cluster to map: %w", err)
	}
	m["Region"] = region

	return m, nil
}

// ===== ElastiCache ReplicationGroup =====

// ListElastiCacheReplicationGroups lists all ElastiCache replication groups in the given region.
func ListElastiCacheReplicationGroups(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := elasticache.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	paginator := elasticache.NewDescribeReplicationGroupsPaginator(svc, &elasticache.DescribeReplicationGroupsInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list ElastiCache replication groups in %s: %w", region, err)
		}
		for _, rg := range page.ReplicationGroups {
			m, err := StructToMap(rg)
			if err != nil {
				return nil, fmt.Errorf("failed to convert ElastiCache replication group to map: %w", err)
			}
			m["Region"] = region
			results = append(results, m)
		}
	}

	return results, nil
}

// GetElastiCacheReplicationGroup gets a single ElastiCache replication group by ID in the given region.
func GetElastiCacheReplicationGroup(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := elasticache.NewFromConfig(client.ConfigForRegion(region))

	output, err := svc.DescribeReplicationGroups(ctx, &elasticache.DescribeReplicationGroupsInput{
		ReplicationGroupId: &id,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get ElastiCache replication group %s in %s: %w", id, region, err)
	}

	if len(output.ReplicationGroups) == 0 {
		return nil, fmt.Errorf("ElastiCache replication group %s not found in %s", id, region)
	}

	rg := output.ReplicationGroups[0]
	m, err := StructToMap(rg)
	if err != nil {
		return nil, fmt.Errorf("failed to convert ElastiCache replication group to map: %w", err)
	}
	m["Region"] = region

	return m, nil
}

// ===== ElastiCache CacheSubnetGroup =====

// ListElastiCacheSubnetGroups lists all ElastiCache subnet groups in the given region.
func ListElastiCacheSubnetGroups(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := elasticache.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	paginator := elasticache.NewDescribeCacheSubnetGroupsPaginator(svc, &elasticache.DescribeCacheSubnetGroupsInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list ElastiCache subnet groups in %s: %w", region, err)
		}
		for _, sg := range page.CacheSubnetGroups {
			m, err := StructToMap(sg)
			if err != nil {
				return nil, fmt.Errorf("failed to convert ElastiCache subnet group to map: %w", err)
			}
			m["Region"] = region
			results = append(results, m)
		}
	}

	return results, nil
}

// GetElastiCacheSubnetGroup gets a single ElastiCache subnet group by name in the given region.
func GetElastiCacheSubnetGroup(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := elasticache.NewFromConfig(client.ConfigForRegion(region))

	output, err := svc.DescribeCacheSubnetGroups(ctx, &elasticache.DescribeCacheSubnetGroupsInput{
		CacheSubnetGroupName: &id,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get ElastiCache subnet group %s in %s: %w", id, region, err)
	}

	if len(output.CacheSubnetGroups) == 0 {
		return nil, fmt.Errorf("ElastiCache subnet group %s not found in %s", id, region)
	}

	sg := output.CacheSubnetGroups[0]
	m, err := StructToMap(sg)
	if err != nil {
		return nil, fmt.Errorf("failed to convert ElastiCache subnet group to map: %w", err)
	}
	m["Region"] = region

	return m, nil
}
