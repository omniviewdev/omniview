package resourcers

import (
	"context"
	"fmt"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/route53"
	route53types "github.com/aws/aws-sdk-go-v2/service/route53/types"

	"github.com/omniviewdev/aws-plugin/pkg/plugin/resource/clients"
)

// ===== Route53 HostedZone =====

// ListRoute53HostedZones lists all Route53 hosted zones globally.
func ListRoute53HostedZones(ctx context.Context, client *clients.Client) ([]map[string]interface{}, error) {
	svc := route53.NewFromConfig(client.Config)
	results := make([]map[string]interface{}, 0)

	paginator := route53.NewListHostedZonesPaginator(svc, &route53.ListHostedZonesInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list Route53 hosted zones: %w", err)
		}
		for _, zone := range page.HostedZones {
			m, err := StructToMap(zone)
			if err != nil {
				return nil, fmt.Errorf("failed to convert Route53 hosted zone to map: %w", err)
			}
			if zone.Id != nil {
				m["_CleanId"] = strings.TrimPrefix(*zone.Id, "/hostedzone/")
			}
			results = append(results, m)
		}
	}

	return results, nil
}

// GetRoute53HostedZone gets a single Route53 hosted zone by ID.
func GetRoute53HostedZone(ctx context.Context, client *clients.Client, id string) (map[string]interface{}, error) {
	svc := route53.NewFromConfig(client.Config)

	result, err := svc.GetHostedZone(ctx, &route53.GetHostedZoneInput{
		Id: &id,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get Route53 hosted zone %s: %w", id, err)
	}

	m, err := StructToMap(result.HostedZone)
	if err != nil {
		return nil, fmt.Errorf("failed to convert Route53 hosted zone to map: %w", err)
	}
	if result.HostedZone.Id != nil {
		m["_CleanId"] = strings.TrimPrefix(*result.HostedZone.Id, "/hostedzone/")
	}

	return m, nil
}

// ===== Route53 HealthCheck =====

// ListRoute53HealthChecks lists all Route53 health checks globally.
func ListRoute53HealthChecks(ctx context.Context, client *clients.Client) ([]map[string]interface{}, error) {
	svc := route53.NewFromConfig(client.Config)
	results := make([]map[string]interface{}, 0)

	paginator := route53.NewListHealthChecksPaginator(svc, &route53.ListHealthChecksInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list Route53 health checks: %w", err)
		}
		for _, hc := range page.HealthChecks {
			m, err := StructToMap(hc)
			if err != nil {
				return nil, fmt.Errorf("failed to convert Route53 health check to map: %w", err)
			}
			results = append(results, m)
		}
	}

	return results, nil
}

// GetRoute53HealthCheck gets a single Route53 health check by ID.
func GetRoute53HealthCheck(ctx context.Context, client *clients.Client, id string) (map[string]interface{}, error) {
	svc := route53.NewFromConfig(client.Config)

	result, err := svc.GetHealthCheck(ctx, &route53.GetHealthCheckInput{
		HealthCheckId: &id,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get Route53 health check %s: %w", id, err)
	}

	m, err := StructToMap(result.HealthCheck)
	if err != nil {
		return nil, fmt.Errorf("failed to convert Route53 health check to map: %w", err)
	}

	return m, nil
}

// ===== Route53 RecordSet =====

// ListRoute53RecordSets lists all Route53 record sets across all hosted zones.
func ListRoute53RecordSets(ctx context.Context, client *clients.Client) ([]map[string]interface{}, error) {
	svc := route53.NewFromConfig(client.Config)
	results := make([]map[string]interface{}, 0)

	// First, list all hosted zones
	zonePaginator := route53.NewListHostedZonesPaginator(svc, &route53.ListHostedZonesInput{})
	for zonePaginator.HasMorePages() {
		zonePage, err := zonePaginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list Route53 hosted zones: %w", err)
		}
		for _, zone := range zonePage.HostedZones {
			// For each zone, list all record sets
			output, err := svc.ListResourceRecordSets(ctx, &route53.ListResourceRecordSetsInput{
				HostedZoneId: zone.Id,
			})
			if err != nil {
				// Skip this zone on error and continue
				continue
			}
			cleanZoneId := ""
			if zone.Id != nil {
				cleanZoneId = strings.TrimPrefix(*zone.Id, "/hostedzone/")
			}
			for _, rs := range output.ResourceRecordSets {
				m, err := StructToMap(rs)
				if err != nil {
					continue
				}
				m["HostedZoneId"] = cleanZoneId
				if zone.Name != nil {
					m["HostedZoneName"] = *zone.Name
				}
				results = append(results, m)
			}
		}
	}

	return results, nil
}

// GetRoute53RecordSet gets a single Route53 record set.
// The id must be in the format "zoneId/recordName/recordType".
func GetRoute53RecordSet(ctx context.Context, client *clients.Client, id string) (map[string]interface{}, error) {
	parts := strings.SplitN(id, "/", 3)
	if len(parts) != 3 {
		return nil, fmt.Errorf("invalid Route53 record set ID %q: expected format zoneId/recordName/recordType", id)
	}
	zoneId := parts[0]
	recordName := parts[1]
	recordType := parts[2]

	svc := route53.NewFromConfig(client.Config)

	output, err := svc.ListResourceRecordSets(ctx, &route53.ListResourceRecordSetsInput{
		HostedZoneId:    &zoneId,
		StartRecordName: &recordName,
		StartRecordType: route53types.RRType(recordType),
		MaxItems:        aws.Int32(1),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get Route53 record set %s: %w", id, err)
	}

	if len(output.ResourceRecordSets) == 0 {
		return nil, fmt.Errorf("Route53 record set %s not found", id)
	}

	rs := output.ResourceRecordSets[0]
	m, err := StructToMap(rs)
	if err != nil {
		return nil, fmt.Errorf("failed to convert Route53 record set to map: %w", err)
	}
	m["HostedZoneId"] = zoneId

	return m, nil
}
