package resourcers

import (
	"context"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/service/efs"

	"github.com/omniviewdev/aws-plugin/pkg/plugin/resource/clients"
)

// ===== EFS FileSystem =====

// ListEFSFileSystems lists all EFS file systems in the given region.
func ListEFSFileSystems(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := efs.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	paginator := efs.NewDescribeFileSystemsPaginator(svc, &efs.DescribeFileSystemsInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list EFS file systems in %s: %w", region, err)
		}
		for _, fs := range page.FileSystems {
			m, err := StructToMap(fs)
			if err != nil {
				return nil, fmt.Errorf("failed to convert EFS file system to map: %w", err)
			}
			m["Region"] = region
			results = append(results, m)
		}
	}

	return results, nil
}

// GetEFSFileSystem gets a single EFS file system by ID in the given region.
func GetEFSFileSystem(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := efs.NewFromConfig(client.ConfigForRegion(region))

	output, err := svc.DescribeFileSystems(ctx, &efs.DescribeFileSystemsInput{
		FileSystemId: &id,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get EFS file system %s in %s: %w", id, region, err)
	}

	if len(output.FileSystems) == 0 {
		return nil, fmt.Errorf("EFS file system %s not found in %s", id, region)
	}

	fs := output.FileSystems[0]
	m, err := StructToMap(fs)
	if err != nil {
		return nil, fmt.Errorf("failed to convert EFS file system to map: %w", err)
	}
	m["Region"] = region

	return m, nil
}

// ===== EFS AccessPoint =====

// ListEFSAccessPoints lists all EFS access points in the given region.
func ListEFSAccessPoints(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := efs.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	paginator := efs.NewDescribeAccessPointsPaginator(svc, &efs.DescribeAccessPointsInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list EFS access points in %s: %w", region, err)
		}
		for _, ap := range page.AccessPoints {
			m, err := StructToMap(ap)
			if err != nil {
				return nil, fmt.Errorf("failed to convert EFS access point to map: %w", err)
			}
			m["Region"] = region
			results = append(results, m)
		}
	}

	return results, nil
}

// GetEFSAccessPoint gets a single EFS access point by ID in the given region.
func GetEFSAccessPoint(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := efs.NewFromConfig(client.ConfigForRegion(region))

	output, err := svc.DescribeAccessPoints(ctx, &efs.DescribeAccessPointsInput{
		AccessPointId: &id,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get EFS access point %s in %s: %w", id, region, err)
	}

	if len(output.AccessPoints) == 0 {
		return nil, fmt.Errorf("EFS access point %s not found in %s", id, region)
	}

	ap := output.AccessPoints[0]
	m, err := StructToMap(ap)
	if err != nil {
		return nil, fmt.Errorf("failed to convert EFS access point to map: %w", err)
	}
	m["Region"] = region

	return m, nil
}

// ===== EFS MountTarget =====

// ListEFSMountTargets lists all EFS mount targets across all file systems in the given region.
func ListEFSMountTargets(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := efs.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	// First, list all file systems
	fsPaginator := efs.NewDescribeFileSystemsPaginator(svc, &efs.DescribeFileSystemsInput{})
	for fsPaginator.HasMorePages() {
		fsPage, err := fsPaginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list EFS file systems in %s: %w", region, err)
		}
		for _, fs := range fsPage.FileSystems {
			// For each file system, list all mount targets
			mtOutput, err := svc.DescribeMountTargets(ctx, &efs.DescribeMountTargetsInput{
				FileSystemId: fs.FileSystemId,
			})
			if err != nil {
				// Skip this file system on error and continue
				continue
			}
			for _, mt := range mtOutput.MountTargets {
				m, err := StructToMap(mt)
				if err != nil {
					continue
				}
				m["Region"] = region
				results = append(results, m)
			}
		}
	}

	return results, nil
}

// GetEFSMountTarget gets a single EFS mount target by ID in the given region.
func GetEFSMountTarget(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := efs.NewFromConfig(client.ConfigForRegion(region))

	output, err := svc.DescribeMountTargets(ctx, &efs.DescribeMountTargetsInput{
		MountTargetId: &id,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get EFS mount target %s in %s: %w", id, region, err)
	}

	if len(output.MountTargets) == 0 {
		return nil, fmt.Errorf("EFS mount target %s not found in %s", id, region)
	}

	mt := output.MountTargets[0]
	m, err := StructToMap(mt)
	if err != nil {
		return nil, fmt.Errorf("failed to convert EFS mount target to map: %w", err)
	}
	m["Region"] = region

	return m, nil
}
