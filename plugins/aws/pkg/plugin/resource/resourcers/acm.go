package resourcers

import (
	"context"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/service/acm"

	"github.com/omniviewdev/aws-plugin/pkg/plugin/resource/clients"
)

// ===== ACM Certificate =====

// ListACMCertificates lists all ACM certificates in the given region.
func ListACMCertificates(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := acm.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	paginator := acm.NewListCertificatesPaginator(svc, &acm.ListCertificatesInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list ACM certificates in %s: %w", region, err)
		}
		for _, cert := range page.CertificateSummaryList {
			describeOutput, err := svc.DescribeCertificate(ctx, &acm.DescribeCertificateInput{
				CertificateArn: cert.CertificateArn,
			})
			if err != nil {
				continue
			}
			m, err := StructToMap(describeOutput.Certificate)
			if err != nil {
				continue
			}
			m["Region"] = region
			results = append(results, m)
		}
	}

	return results, nil
}

// GetACMCertificate gets a single ACM certificate by ARN in the given region.
func GetACMCertificate(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := acm.NewFromConfig(client.ConfigForRegion(region))

	output, err := svc.DescribeCertificate(ctx, &acm.DescribeCertificateInput{
		CertificateArn: &id,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get ACM certificate %s in %s: %w", id, region, err)
	}

	m, err := StructToMap(output.Certificate)
	if err != nil {
		return nil, fmt.Errorf("failed to convert ACM certificate to map: %w", err)
	}
	m["Region"] = region

	return m, nil
}
