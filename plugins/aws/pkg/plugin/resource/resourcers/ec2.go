package resourcers

import (
	"context"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/service/ec2"
	ec2types "github.com/aws/aws-sdk-go-v2/service/ec2/types"

	"github.com/omniviewdev/aws-plugin/pkg/plugin/resource/clients"
)

// extractNameTag extracts the "Name" tag value from a slice of EC2 tags.
func extractNameTag(tags []ec2types.Tag) string {
	for _, tag := range tags {
		if tag.Key != nil && *tag.Key == "Name" && tag.Value != nil {
			return *tag.Value
		}
	}
	return ""
}

// ===== EC2 Instance =====

// ListEC2Instances lists all EC2 instances in the given region.
func ListEC2Instances(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := ec2.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	paginator := ec2.NewDescribeInstancesPaginator(svc, &ec2.DescribeInstancesInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list EC2 instances in %s: %w", region, err)
		}
		for _, reservation := range page.Reservations {
			for _, instance := range reservation.Instances {
				m, err := StructToMap(instance)
				if err != nil {
					return nil, fmt.Errorf("failed to convert EC2 instance to map: %w", err)
				}
				m["Region"] = region
				m["_Name"] = extractNameTag(instance.Tags)
				results = append(results, m)
			}
		}
	}

	return results, nil
}

// GetEC2Instance gets a single EC2 instance by ID in the given region.
func GetEC2Instance(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := ec2.NewFromConfig(client.ConfigForRegion(region))

	output, err := svc.DescribeInstances(ctx, &ec2.DescribeInstancesInput{
		InstanceIds: []string{id},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get EC2 instance %s in %s: %w", id, region, err)
	}

	if len(output.Reservations) == 0 || len(output.Reservations[0].Instances) == 0 {
		return nil, fmt.Errorf("EC2 instance %s not found in %s", id, region)
	}

	instance := output.Reservations[0].Instances[0]
	m, err := StructToMap(instance)
	if err != nil {
		return nil, fmt.Errorf("failed to convert EC2 instance to map: %w", err)
	}
	m["Region"] = region
	m["_Name"] = extractNameTag(instance.Tags)

	return m, nil
}

// ===== EC2 Image (AMI) =====

// ListEC2Images lists all EC2 images owned by the current account in the given region.
func ListEC2Images(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := ec2.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	output, err := svc.DescribeImages(ctx, &ec2.DescribeImagesInput{
		Owners: []string{"self"},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list EC2 images in %s: %w", region, err)
	}

	for _, image := range output.Images {
		m, err := StructToMap(image)
		if err != nil {
			return nil, fmt.Errorf("failed to convert EC2 image to map: %w", err)
		}
		m["Region"] = region
		results = append(results, m)
	}

	return results, nil
}

// GetEC2Image gets a single EC2 image by ID in the given region.
func GetEC2Image(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := ec2.NewFromConfig(client.ConfigForRegion(region))

	output, err := svc.DescribeImages(ctx, &ec2.DescribeImagesInput{
		ImageIds: []string{id},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get EC2 image %s in %s: %w", id, region, err)
	}

	if len(output.Images) == 0 {
		return nil, fmt.Errorf("EC2 image %s not found in %s", id, region)
	}

	image := output.Images[0]
	m, err := StructToMap(image)
	if err != nil {
		return nil, fmt.Errorf("failed to convert EC2 image to map: %w", err)
	}
	m["Region"] = region

	return m, nil
}

// ===== EC2 Key Pair =====

// ListEC2KeyPairs lists all EC2 key pairs in the given region.
func ListEC2KeyPairs(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := ec2.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	output, err := svc.DescribeKeyPairs(ctx, &ec2.DescribeKeyPairsInput{})
	if err != nil {
		return nil, fmt.Errorf("failed to list EC2 key pairs in %s: %w", region, err)
	}

	for _, keyPair := range output.KeyPairs {
		m, err := StructToMap(keyPair)
		if err != nil {
			return nil, fmt.Errorf("failed to convert EC2 key pair to map: %w", err)
		}
		m["Region"] = region
		m["_Name"] = extractNameTag(keyPair.Tags)
		results = append(results, m)
	}

	return results, nil
}

// GetEC2KeyPair gets a single EC2 key pair by ID in the given region.
func GetEC2KeyPair(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := ec2.NewFromConfig(client.ConfigForRegion(region))

	output, err := svc.DescribeKeyPairs(ctx, &ec2.DescribeKeyPairsInput{
		KeyPairIds: []string{id},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get EC2 key pair %s in %s: %w", id, region, err)
	}

	if len(output.KeyPairs) == 0 {
		return nil, fmt.Errorf("EC2 key pair %s not found in %s", id, region)
	}

	keyPair := output.KeyPairs[0]
	m, err := StructToMap(keyPair)
	if err != nil {
		return nil, fmt.Errorf("failed to convert EC2 key pair to map: %w", err)
	}
	m["Region"] = region
	m["_Name"] = extractNameTag(keyPair.Tags)

	return m, nil
}

// ===== EC2 Launch Template =====

// ListEC2LaunchTemplates lists all EC2 launch templates in the given region.
func ListEC2LaunchTemplates(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := ec2.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	paginator := ec2.NewDescribeLaunchTemplatesPaginator(svc, &ec2.DescribeLaunchTemplatesInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list EC2 launch templates in %s: %w", region, err)
		}
		for _, lt := range page.LaunchTemplates {
			m, err := StructToMap(lt)
			if err != nil {
				return nil, fmt.Errorf("failed to convert EC2 launch template to map: %w", err)
			}
			m["Region"] = region
			m["_Name"] = extractNameTag(lt.Tags)
			results = append(results, m)
		}
	}

	return results, nil
}

// GetEC2LaunchTemplate gets a single EC2 launch template by ID in the given region.
func GetEC2LaunchTemplate(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := ec2.NewFromConfig(client.ConfigForRegion(region))

	output, err := svc.DescribeLaunchTemplates(ctx, &ec2.DescribeLaunchTemplatesInput{
		LaunchTemplateIds: []string{id},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get EC2 launch template %s in %s: %w", id, region, err)
	}

	if len(output.LaunchTemplates) == 0 {
		return nil, fmt.Errorf("EC2 launch template %s not found in %s", id, region)
	}

	lt := output.LaunchTemplates[0]
	m, err := StructToMap(lt)
	if err != nil {
		return nil, fmt.Errorf("failed to convert EC2 launch template to map: %w", err)
	}
	m["Region"] = region
	m["_Name"] = extractNameTag(lt.Tags)

	return m, nil
}

// ===== EC2 Volume =====

// ListEC2Volumes lists all EBS volumes in the given region.
func ListEC2Volumes(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := ec2.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	paginator := ec2.NewDescribeVolumesPaginator(svc, &ec2.DescribeVolumesInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list EC2 volumes in %s: %w", region, err)
		}
		for _, volume := range page.Volumes {
			m, err := StructToMap(volume)
			if err != nil {
				return nil, fmt.Errorf("failed to convert EC2 volume to map: %w", err)
			}
			m["Region"] = region
			m["_Name"] = extractNameTag(volume.Tags)
			results = append(results, m)
		}
	}

	return results, nil
}

// GetEC2Volume gets a single EBS volume by ID in the given region.
func GetEC2Volume(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := ec2.NewFromConfig(client.ConfigForRegion(region))

	output, err := svc.DescribeVolumes(ctx, &ec2.DescribeVolumesInput{
		VolumeIds: []string{id},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get EC2 volume %s in %s: %w", id, region, err)
	}

	if len(output.Volumes) == 0 {
		return nil, fmt.Errorf("EC2 volume %s not found in %s", id, region)
	}

	volume := output.Volumes[0]
	m, err := StructToMap(volume)
	if err != nil {
		return nil, fmt.Errorf("failed to convert EC2 volume to map: %w", err)
	}
	m["Region"] = region
	m["_Name"] = extractNameTag(volume.Tags)

	return m, nil
}

// ===== EC2 Snapshot =====

// ListEC2Snapshots lists all EBS snapshots owned by the current account in the given region.
func ListEC2Snapshots(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := ec2.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	paginator := ec2.NewDescribeSnapshotsPaginator(svc, &ec2.DescribeSnapshotsInput{
		OwnerIds: []string{"self"},
	})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list EC2 snapshots in %s: %w", region, err)
		}
		for _, snapshot := range page.Snapshots {
			m, err := StructToMap(snapshot)
			if err != nil {
				return nil, fmt.Errorf("failed to convert EC2 snapshot to map: %w", err)
			}
			m["Region"] = region
			m["_Name"] = extractNameTag(snapshot.Tags)
			results = append(results, m)
		}
	}

	return results, nil
}

// GetEC2Snapshot gets a single EBS snapshot by ID in the given region.
func GetEC2Snapshot(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := ec2.NewFromConfig(client.ConfigForRegion(region))

	output, err := svc.DescribeSnapshots(ctx, &ec2.DescribeSnapshotsInput{
		SnapshotIds: []string{id},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get EC2 snapshot %s in %s: %w", id, region, err)
	}

	if len(output.Snapshots) == 0 {
		return nil, fmt.Errorf("EC2 snapshot %s not found in %s", id, region)
	}

	snapshot := output.Snapshots[0]
	m, err := StructToMap(snapshot)
	if err != nil {
		return nil, fmt.Errorf("failed to convert EC2 snapshot to map: %w", err)
	}
	m["Region"] = region
	m["_Name"] = extractNameTag(snapshot.Tags)

	return m, nil
}

// ===== EC2 Elastic IP (Address) =====

// ListEC2Addresses lists all Elastic IP addresses in the given region.
func ListEC2Addresses(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := ec2.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	output, err := svc.DescribeAddresses(ctx, &ec2.DescribeAddressesInput{})
	if err != nil {
		return nil, fmt.Errorf("failed to list EC2 addresses in %s: %w", region, err)
	}

	for _, address := range output.Addresses {
		m, err := StructToMap(address)
		if err != nil {
			return nil, fmt.Errorf("failed to convert EC2 address to map: %w", err)
		}
		m["Region"] = region
		m["_Name"] = extractNameTag(address.Tags)
		results = append(results, m)
	}

	return results, nil
}

// GetEC2Address gets a single Elastic IP address by allocation ID in the given region.
func GetEC2Address(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := ec2.NewFromConfig(client.ConfigForRegion(region))

	output, err := svc.DescribeAddresses(ctx, &ec2.DescribeAddressesInput{
		AllocationIds: []string{id},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get EC2 address %s in %s: %w", id, region, err)
	}

	if len(output.Addresses) == 0 {
		return nil, fmt.Errorf("EC2 address %s not found in %s", id, region)
	}

	address := output.Addresses[0]
	m, err := StructToMap(address)
	if err != nil {
		return nil, fmt.Errorf("failed to convert EC2 address to map: %w", err)
	}
	m["Region"] = region
	m["_Name"] = extractNameTag(address.Tags)

	return m, nil
}

// ===== EC2 Placement Group =====

// ListEC2PlacementGroups lists all placement groups in the given region.
func ListEC2PlacementGroups(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := ec2.NewFromConfig(client.ConfigForRegion(region))

	output, err := svc.DescribePlacementGroups(ctx, &ec2.DescribePlacementGroupsInput{})
	if err != nil {
		return nil, fmt.Errorf("failed to list placement groups in %s: %w", region, err)
	}

	results := make([]map[string]interface{}, 0, len(output.PlacementGroups))
	for _, pg := range output.PlacementGroups {
		m, err := StructToMap(pg)
		if err != nil {
			return nil, fmt.Errorf("failed to convert placement group to map: %w", err)
		}
		m["Region"] = region
		m["_Name"] = extractNameTag(pg.Tags)
		results = append(results, m)
	}

	return results, nil
}

// GetEC2PlacementGroup gets a single placement group by name in the given region.
func GetEC2PlacementGroup(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := ec2.NewFromConfig(client.ConfigForRegion(region))

	output, err := svc.DescribePlacementGroups(ctx, &ec2.DescribePlacementGroupsInput{
		GroupNames: []string{id},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get placement group %s in %s: %w", id, region, err)
	}

	if len(output.PlacementGroups) == 0 {
		return nil, fmt.Errorf("placement group %s not found in %s", id, region)
	}

	pg := output.PlacementGroups[0]
	m, err := StructToMap(pg)
	if err != nil {
		return nil, fmt.Errorf("failed to convert placement group to map: %w", err)
	}
	m["Region"] = region
	m["_Name"] = extractNameTag(pg.Tags)

	return m, nil
}
