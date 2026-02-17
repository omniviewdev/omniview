package resourcers

import (
	"context"
	"fmt"
	"strings"

	"github.com/aws/aws-sdk-go-v2/service/ecs"

	"github.com/omniviewdev/aws-plugin/pkg/plugin/resource/clients"
)

// ===== ECS Cluster =====

// ListECSClusters lists all ECS clusters in the given region.
func ListECSClusters(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := ecs.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	paginator := ecs.NewListClustersPaginator(svc, &ecs.ListClustersInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list ECS clusters in %s: %w", region, err)
		}
		if len(page.ClusterArns) == 0 {
			continue
		}

		describeOutput, err := svc.DescribeClusters(ctx, &ecs.DescribeClustersInput{
			Clusters: page.ClusterArns,
		})
		if err != nil {
			return nil, fmt.Errorf("failed to describe ECS clusters in %s: %w", region, err)
		}

		for _, cluster := range describeOutput.Clusters {
			m, err := StructToMap(cluster)
			if err != nil {
				return nil, fmt.Errorf("failed to convert ECS cluster to map: %w", err)
			}
			m["Region"] = region
			results = append(results, m)
		}
	}

	return results, nil
}

// GetECSCluster gets a single ECS cluster by name or ARN in the given region.
func GetECSCluster(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := ecs.NewFromConfig(client.ConfigForRegion(region))

	output, err := svc.DescribeClusters(ctx, &ecs.DescribeClustersInput{
		Clusters: []string{id},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get ECS cluster %s in %s: %w", id, region, err)
	}

	if len(output.Clusters) == 0 {
		return nil, fmt.Errorf("ECS cluster %s not found in %s", id, region)
	}

	cluster := output.Clusters[0]
	m, err := StructToMap(cluster)
	if err != nil {
		return nil, fmt.Errorf("failed to convert ECS cluster to map: %w", err)
	}
	m["Region"] = region

	return m, nil
}

// ===== ECS Service =====

// ListECSServices lists all ECS services across all clusters in the given region.
func ListECSServices(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := ecs.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	// First, list all clusters
	clusterPaginator := ecs.NewListClustersPaginator(svc, &ecs.ListClustersInput{})
	for clusterPaginator.HasMorePages() {
		clusterPage, err := clusterPaginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list ECS clusters in %s: %w", region, err)
		}
		for _, clusterArn := range clusterPage.ClusterArns {
			servicePaginator := ecs.NewListServicesPaginator(svc, &ecs.ListServicesInput{
				Cluster: &clusterArn,
			})
			for servicePaginator.HasMorePages() {
				servicePage, err := servicePaginator.NextPage(ctx)
				if err != nil {
					break
				}
				if len(servicePage.ServiceArns) == 0 {
					continue
				}

				describeOutput, err := svc.DescribeServices(ctx, &ecs.DescribeServicesInput{
					Cluster:  &clusterArn,
					Services: servicePage.ServiceArns,
				})
				if err != nil {
					continue
				}

				for _, service := range describeOutput.Services {
					m, err := StructToMap(service)
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

// GetECSService gets a single ECS service by ID in the given region.
// The id must be in the format "clusterName/serviceName".
func GetECSService(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	parts := strings.SplitN(id, "/", 2)
	if len(parts) != 2 {
		return nil, fmt.Errorf("invalid ECS service ID %q: expected format clusterName/serviceName", id)
	}
	clusterName := parts[0]
	serviceName := parts[1]

	svc := ecs.NewFromConfig(client.ConfigForRegion(region))

	output, err := svc.DescribeServices(ctx, &ecs.DescribeServicesInput{
		Cluster:  &clusterName,
		Services: []string{serviceName},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get ECS service %s in %s: %w", id, region, err)
	}

	if len(output.Services) == 0 {
		return nil, fmt.Errorf("ECS service %s not found in %s", id, region)
	}

	service := output.Services[0]
	m, err := StructToMap(service)
	if err != nil {
		return nil, fmt.Errorf("failed to convert ECS service to map: %w", err)
	}
	m["Region"] = region

	return m, nil
}

// ===== ECS Task =====

// ListECSTasks lists all ECS tasks across all clusters in the given region.
func ListECSTasks(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := ecs.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	clusterPaginator := ecs.NewListClustersPaginator(svc, &ecs.ListClustersInput{})
	for clusterPaginator.HasMorePages() {
		clusterPage, err := clusterPaginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list ECS clusters in %s: %w", region, err)
		}
		for _, clusterArn := range clusterPage.ClusterArns {
			taskPaginator := ecs.NewListTasksPaginator(svc, &ecs.ListTasksInput{
				Cluster: &clusterArn,
			})
			for taskPaginator.HasMorePages() {
				taskPage, err := taskPaginator.NextPage(ctx)
				if err != nil {
					break
				}
				if len(taskPage.TaskArns) == 0 {
					continue
				}

				describeOutput, err := svc.DescribeTasks(ctx, &ecs.DescribeTasksInput{
					Cluster: &clusterArn,
					Tasks:   taskPage.TaskArns,
				})
				if err != nil {
					continue
				}

				for _, task := range describeOutput.Tasks {
					m, err := StructToMap(task)
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

// GetECSTask gets a single ECS task by ID in the given region.
// The id must be in the format "clusterName/taskId".
func GetECSTask(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	parts := strings.SplitN(id, "/", 2)
	if len(parts) != 2 {
		return nil, fmt.Errorf("invalid ECS task ID %q: expected format clusterName/taskId", id)
	}
	clusterName := parts[0]
	taskID := parts[1]

	svc := ecs.NewFromConfig(client.ConfigForRegion(region))

	output, err := svc.DescribeTasks(ctx, &ecs.DescribeTasksInput{
		Cluster: &clusterName,
		Tasks:   []string{taskID},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get ECS task %s in %s: %w", id, region, err)
	}

	if len(output.Tasks) == 0 {
		return nil, fmt.Errorf("ECS task %s not found in %s", id, region)
	}

	task := output.Tasks[0]
	m, err := StructToMap(task)
	if err != nil {
		return nil, fmt.Errorf("failed to convert ECS task to map: %w", err)
	}
	m["Region"] = region

	return m, nil
}

// ===== ECS Task Definition =====

// ListECSTaskDefinitions lists all ECS task definition families in the given region.
func ListECSTaskDefinitions(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := ecs.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	paginator := ecs.NewListTaskDefinitionsPaginator(svc, &ecs.ListTaskDefinitionsInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list ECS task definitions in %s: %w", region, err)
		}
		for _, tdArn := range page.TaskDefinitionArns {
			describeOutput, err := svc.DescribeTaskDefinition(ctx, &ecs.DescribeTaskDefinitionInput{
				TaskDefinition: &tdArn,
			})
			if err != nil {
				continue
			}
			m, err := StructToMap(describeOutput.TaskDefinition)
			if err != nil {
				continue
			}
			m["Region"] = region
			results = append(results, m)
		}
	}

	return results, nil
}

// GetECSTaskDefinition gets a single ECS task definition by ARN in the given region.
func GetECSTaskDefinition(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := ecs.NewFromConfig(client.ConfigForRegion(region))

	output, err := svc.DescribeTaskDefinition(ctx, &ecs.DescribeTaskDefinitionInput{
		TaskDefinition: &id,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get ECS task definition %s in %s: %w", id, region, err)
	}

	m, err := StructToMap(output.TaskDefinition)
	if err != nil {
		return nil, fmt.Errorf("failed to convert ECS task definition to map: %w", err)
	}
	m["Region"] = region

	return m, nil
}

// ===== ECS Container Instance =====

// ListECSContainerInstances lists all ECS container instances across all clusters in the given region.
func ListECSContainerInstances(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := ecs.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	clusterPaginator := ecs.NewListClustersPaginator(svc, &ecs.ListClustersInput{})
	for clusterPaginator.HasMorePages() {
		clusterPage, err := clusterPaginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list ECS clusters in %s: %w", region, err)
		}
		for _, clusterArn := range clusterPage.ClusterArns {
			ciPaginator := ecs.NewListContainerInstancesPaginator(svc, &ecs.ListContainerInstancesInput{
				Cluster: &clusterArn,
			})
			for ciPaginator.HasMorePages() {
				ciPage, err := ciPaginator.NextPage(ctx)
				if err != nil {
					break
				}
				if len(ciPage.ContainerInstanceArns) == 0 {
					continue
				}

				describeOutput, err := svc.DescribeContainerInstances(ctx, &ecs.DescribeContainerInstancesInput{
					Cluster:            &clusterArn,
					ContainerInstances: ciPage.ContainerInstanceArns,
				})
				if err != nil {
					continue
				}

				for _, ci := range describeOutput.ContainerInstances {
					m, err := StructToMap(ci)
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

// GetECSContainerInstance gets a single ECS container instance by ID in the given region.
// The id must be in the format "clusterName/containerInstanceId".
func GetECSContainerInstance(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	parts := strings.SplitN(id, "/", 2)
	if len(parts) != 2 {
		return nil, fmt.Errorf("invalid ECS container instance ID %q: expected format clusterName/containerInstanceId", id)
	}
	clusterName := parts[0]
	ciID := parts[1]

	svc := ecs.NewFromConfig(client.ConfigForRegion(region))

	output, err := svc.DescribeContainerInstances(ctx, &ecs.DescribeContainerInstancesInput{
		Cluster:            &clusterName,
		ContainerInstances: []string{ciID},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get ECS container instance %s in %s: %w", id, region, err)
	}

	if len(output.ContainerInstances) == 0 {
		return nil, fmt.Errorf("ECS container instance %s not found in %s", id, region)
	}

	ci := output.ContainerInstances[0]
	m, err := StructToMap(ci)
	if err != nil {
		return nil, fmt.Errorf("failed to convert ECS container instance to map: %w", err)
	}
	m["Region"] = region

	return m, nil
}
