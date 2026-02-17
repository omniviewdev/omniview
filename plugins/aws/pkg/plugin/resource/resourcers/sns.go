package resourcers

import (
	"context"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/service/sns"

	"github.com/omniviewdev/aws-plugin/pkg/plugin/resource/clients"
)

// ===== SNS Topic =====

// ListSNSTopics lists all SNS topics in the given region.
func ListSNSTopics(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := sns.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	paginator := sns.NewListTopicsPaginator(svc, &sns.ListTopicsInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list SNS topics in %s: %w", region, err)
		}
		for _, topic := range page.Topics {
			if topic.TopicArn == nil {
				continue
			}

			// Get full topic attributes for each topic.
			attrOutput, err := svc.GetTopicAttributes(ctx, &sns.GetTopicAttributesInput{
				TopicArn: topic.TopicArn,
			})
			if err != nil {
				return nil, fmt.Errorf("failed to get SNS topic attributes for %s in %s: %w", *topic.TopicArn, region, err)
			}

			m := make(map[string]interface{})
			m["TopicArn"] = *topic.TopicArn
			for k, v := range attrOutput.Attributes {
				m[k] = v
			}
			m["Region"] = region
			results = append(results, m)
		}
	}

	return results, nil
}

// GetSNSTopic gets a single SNS topic by ARN in the given region.
func GetSNSTopic(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := sns.NewFromConfig(client.ConfigForRegion(region))

	attrOutput, err := svc.GetTopicAttributes(ctx, &sns.GetTopicAttributesInput{
		TopicArn: &id,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get SNS topic %s in %s: %w", id, region, err)
	}

	m := make(map[string]interface{})
	m["TopicArn"] = id
	for k, v := range attrOutput.Attributes {
		m[k] = v
	}
	m["Region"] = region

	return m, nil
}

// ===== SNS Subscription =====

// ListSNSSubscriptions lists all SNS subscriptions in the given region.
func ListSNSSubscriptions(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := sns.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	paginator := sns.NewListSubscriptionsPaginator(svc, &sns.ListSubscriptionsInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list SNS subscriptions in %s: %w", region, err)
		}
		for _, subscription := range page.Subscriptions {
			m, err := StructToMap(subscription)
			if err != nil {
				return nil, fmt.Errorf("failed to convert SNS subscription to map: %w", err)
			}
			m["Region"] = region
			results = append(results, m)
		}
	}

	return results, nil
}

// GetSNSSubscription gets a single SNS subscription by ARN in the given region.
func GetSNSSubscription(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := sns.NewFromConfig(client.ConfigForRegion(region))

	attrOutput, err := svc.GetSubscriptionAttributes(ctx, &sns.GetSubscriptionAttributesInput{
		SubscriptionArn: &id,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get SNS subscription %s in %s: %w", id, region, err)
	}

	m := make(map[string]interface{})
	for k, v := range attrOutput.Attributes {
		m[k] = v
	}
	m["Region"] = region

	return m, nil
}
