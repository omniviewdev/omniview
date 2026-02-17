package resourcers

import (
	"context"
	"fmt"
	"strings"

	"github.com/aws/aws-sdk-go-v2/service/sqs"
	sqstypes "github.com/aws/aws-sdk-go-v2/service/sqs/types"

	"github.com/omniviewdev/aws-plugin/pkg/plugin/resource/clients"
)

// ===== SQS Queue =====

// ListSQSQueues lists all SQS queues in the given region.
func ListSQSQueues(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := sqs.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	paginator := sqs.NewListQueuesPaginator(svc, &sqs.ListQueuesInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list SQS queues in %s: %w", region, err)
		}
		for _, url := range page.QueueUrls {
			// Get full queue attributes for each queue.
			attrOutput, err := svc.GetQueueAttributes(ctx, &sqs.GetQueueAttributesInput{
				QueueUrl:       &url,
				AttributeNames: []sqstypes.QueueAttributeName{sqstypes.QueueAttributeNameAll},
			})
			if err != nil {
				return nil, fmt.Errorf("failed to get SQS queue attributes for %s in %s: %w", url, region, err)
			}

			m := make(map[string]interface{})
			m["QueueUrl"] = url
			for k, v := range attrOutput.Attributes {
				m[k] = v
			}

			// Extract queue name from URL (last segment after "/").
			parts := strings.Split(url, "/")
			if len(parts) > 0 {
				m["QueueName"] = parts[len(parts)-1]
			}

			m["Region"] = region
			results = append(results, m)
		}
	}

	return results, nil
}

// GetSQSQueue gets a single SQS queue by URL in the given region.
func GetSQSQueue(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := sqs.NewFromConfig(client.ConfigForRegion(region))

	attrOutput, err := svc.GetQueueAttributes(ctx, &sqs.GetQueueAttributesInput{
		QueueUrl:       &id,
		AttributeNames: []sqstypes.QueueAttributeName{sqstypes.QueueAttributeNameAll},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get SQS queue %s in %s: %w", id, region, err)
	}

	m := make(map[string]interface{})
	m["QueueUrl"] = id
	for k, v := range attrOutput.Attributes {
		m[k] = v
	}

	// Extract queue name from URL (last segment after "/").
	parts := strings.Split(id, "/")
	if len(parts) > 0 {
		m["QueueName"] = parts[len(parts)-1]
	}

	m["Region"] = region

	return m, nil
}
