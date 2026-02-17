package resourcers

import (
	"context"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/service/s3"

	"github.com/omniviewdev/aws-plugin/pkg/plugin/resource/clients"
)

// ===== S3 Bucket =====

// ListS3Buckets lists all S3 buckets globally.
func ListS3Buckets(ctx context.Context, client *clients.Client) ([]map[string]interface{}, error) {
	svc := s3.NewFromConfig(client.Config)
	results := make([]map[string]interface{}, 0)

	output, err := svc.ListBuckets(ctx, &s3.ListBucketsInput{})
	if err != nil {
		return nil, fmt.Errorf("failed to list S3 buckets: %w", err)
	}

	for _, bucket := range output.Buckets {
		m, err := StructToMap(bucket)
		if err != nil {
			return nil, fmt.Errorf("failed to convert S3 bucket to map: %w", err)
		}

		// Determine the bucket's region via GetBucketLocation
		region := "us-east-1"
		if bucket.Name != nil {
			locOutput, err := svc.GetBucketLocation(ctx, &s3.GetBucketLocationInput{
				Bucket: bucket.Name,
			})
			if err == nil {
				loc := string(locOutput.LocationConstraint)
				if loc != "" {
					region = loc
				}
			}
		}
		m["Region"] = region

		results = append(results, m)
	}

	return results, nil
}

// GetS3Bucket gets a single S3 bucket by name.
func GetS3Bucket(ctx context.Context, client *clients.Client, id string) (map[string]interface{}, error) {
	svc := s3.NewFromConfig(client.Config)

	// Verify the bucket exists using HeadBucket
	_, err := svc.HeadBucket(ctx, &s3.HeadBucketInput{
		Bucket: &id,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get S3 bucket %s: %w", id, err)
	}

	// There is no DescribeBucket API, so construct a basic map
	m := map[string]interface{}{
		"Name": id,
	}

	// Try to determine the bucket's region
	region := "us-east-1"
	locOutput, err := svc.GetBucketLocation(ctx, &s3.GetBucketLocationInput{
		Bucket: &id,
	})
	if err == nil {
		loc := string(locOutput.LocationConstraint)
		if loc != "" {
			region = loc
		}
	}
	m["Region"] = region

	return m, nil
}
