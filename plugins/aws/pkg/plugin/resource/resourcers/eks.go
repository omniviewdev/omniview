package resourcers

import (
	"context"
	"fmt"
	"strings"

	"github.com/aws/aws-sdk-go-v2/service/eks"

	"github.com/omniviewdev/aws-plugin/pkg/plugin/resource/clients"
)

// ===== EKS Cluster =====

// ListEKSClusters lists all EKS clusters in the given region.
func ListEKSClusters(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := eks.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	paginator := eks.NewListClustersPaginator(svc, &eks.ListClustersInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list EKS clusters in %s: %w", region, err)
		}
		for _, name := range page.Clusters {
			describeOutput, err := svc.DescribeCluster(ctx, &eks.DescribeClusterInput{
				Name: &name,
			})
			if err != nil {
				return nil, fmt.Errorf("failed to describe EKS cluster %s in %s: %w", name, region, err)
			}
			m, err := StructToMap(describeOutput.Cluster)
			if err != nil {
				return nil, fmt.Errorf("failed to convert EKS cluster to map: %w", err)
			}
			m["Region"] = region
			results = append(results, m)
		}
	}

	return results, nil
}

// GetEKSCluster gets a single EKS cluster by name in the given region.
func GetEKSCluster(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := eks.NewFromConfig(client.ConfigForRegion(region))

	output, err := svc.DescribeCluster(ctx, &eks.DescribeClusterInput{
		Name: &id,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get EKS cluster %s in %s: %w", id, region, err)
	}

	m, err := StructToMap(output.Cluster)
	if err != nil {
		return nil, fmt.Errorf("failed to convert EKS cluster to map: %w", err)
	}
	m["Region"] = region

	return m, nil
}

// ===== EKS Nodegroup =====

// ListEKSNodegroups lists all EKS nodegroups across all clusters in the given region.
func ListEKSNodegroups(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := eks.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	// First, list all clusters
	clusterPaginator := eks.NewListClustersPaginator(svc, &eks.ListClustersInput{})
	for clusterPaginator.HasMorePages() {
		clusterPage, err := clusterPaginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list EKS clusters in %s: %w", region, err)
		}
		for _, clusterName := range clusterPage.Clusters {
			// For each cluster, list all nodegroups
			ngPaginator := eks.NewListNodegroupsPaginator(svc, &eks.ListNodegroupsInput{
				ClusterName: &clusterName,
			})
			for ngPaginator.HasMorePages() {
				ngPage, err := ngPaginator.NextPage(ctx)
				if err != nil {
					// Skip this cluster's nodegroups on error and continue
					break
				}
				for _, ngName := range ngPage.Nodegroups {
					describeOutput, err := svc.DescribeNodegroup(ctx, &eks.DescribeNodegroupInput{
						ClusterName:   &clusterName,
						NodegroupName: &ngName,
					})
					if err != nil {
						// Skip this nodegroup on error and continue
						continue
					}
					m, err := StructToMap(describeOutput.Nodegroup)
					if err != nil {
						continue
					}
					m["Region"] = region
					results = append(results, m)
				}
			}
		}
	}

	return results, nil
}

// GetEKSNodegroup gets a single EKS nodegroup by ID in the given region.
// The id must be in the format "clusterName/nodegroupName".
func GetEKSNodegroup(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	parts := strings.SplitN(id, "/", 2)
	if len(parts) != 2 {
		return nil, fmt.Errorf("invalid EKS nodegroup ID %q: expected format clusterName/nodegroupName", id)
	}
	clusterName := parts[0]
	ngName := parts[1]

	svc := eks.NewFromConfig(client.ConfigForRegion(region))

	output, err := svc.DescribeNodegroup(ctx, &eks.DescribeNodegroupInput{
		ClusterName:   &clusterName,
		NodegroupName: &ngName,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get EKS nodegroup %s in %s: %w", id, region, err)
	}

	m, err := StructToMap(output.Nodegroup)
	if err != nil {
		return nil, fmt.Errorf("failed to convert EKS nodegroup to map: %w", err)
	}
	m["Region"] = region

	return m, nil
}

// ===== EKS Addon =====

// ListEKSAddons lists all EKS addons across all clusters in the given region.
func ListEKSAddons(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := eks.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	// First, list all clusters
	clusterPaginator := eks.NewListClustersPaginator(svc, &eks.ListClustersInput{})
	for clusterPaginator.HasMorePages() {
		clusterPage, err := clusterPaginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list EKS clusters in %s: %w", region, err)
		}
		for _, clusterName := range clusterPage.Clusters {
			// For each cluster, list all addons
			addonPaginator := eks.NewListAddonsPaginator(svc, &eks.ListAddonsInput{
				ClusterName: &clusterName,
			})
			for addonPaginator.HasMorePages() {
				addonPage, err := addonPaginator.NextPage(ctx)
				if err != nil {
					// Skip this cluster's addons on error and continue
					break
				}
				for _, addonName := range addonPage.Addons {
					describeOutput, err := svc.DescribeAddon(ctx, &eks.DescribeAddonInput{
						ClusterName: &clusterName,
						AddonName:   &addonName,
					})
					if err != nil {
						// Skip this addon on error and continue
						continue
					}
					m, err := StructToMap(describeOutput.Addon)
					if err != nil {
						continue
					}
					m["Region"] = region
					results = append(results, m)
				}
			}
		}
	}

	return results, nil
}

// GetEKSAddon gets a single EKS addon by ID in the given region.
// The id must be in the format "clusterName/addonName".
func GetEKSAddon(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	parts := strings.SplitN(id, "/", 2)
	if len(parts) != 2 {
		return nil, fmt.Errorf("invalid EKS addon ID %q: expected format clusterName/addonName", id)
	}
	clusterName := parts[0]
	addonName := parts[1]

	svc := eks.NewFromConfig(client.ConfigForRegion(region))

	output, err := svc.DescribeAddon(ctx, &eks.DescribeAddonInput{
		ClusterName: &clusterName,
		AddonName:   &addonName,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get EKS addon %s in %s: %w", id, region, err)
	}

	m, err := StructToMap(output.Addon)
	if err != nil {
		return nil, fmt.Errorf("failed to convert EKS addon to map: %w", err)
	}
	m["Region"] = region

	return m, nil
}
