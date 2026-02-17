package resourcers

import (
	"context"
	"fmt"

	elbv2 "github.com/aws/aws-sdk-go-v2/service/elasticloadbalancingv2"

	"github.com/omniviewdev/aws-plugin/pkg/plugin/resource/clients"
)

// ===== ELBv2 LoadBalancer =====

// ListLoadBalancers lists all load balancers in the given region.
func ListLoadBalancers(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := elbv2.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	paginator := elbv2.NewDescribeLoadBalancersPaginator(svc, &elbv2.DescribeLoadBalancersInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list load balancers in %s: %w", region, err)
		}
		for _, lb := range page.LoadBalancers {
			m, err := StructToMap(lb)
			if err != nil {
				return nil, fmt.Errorf("failed to convert load balancer to map: %w", err)
			}
			m["Region"] = region
			results = append(results, m)
		}
	}

	return results, nil
}

// GetLoadBalancer gets a single load balancer by ARN in the given region.
func GetLoadBalancer(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := elbv2.NewFromConfig(client.ConfigForRegion(region))

	output, err := svc.DescribeLoadBalancers(ctx, &elbv2.DescribeLoadBalancersInput{
		LoadBalancerArns: []string{id},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get load balancer %s in %s: %w", id, region, err)
	}

	if len(output.LoadBalancers) == 0 {
		return nil, fmt.Errorf("load balancer %s not found in %s", id, region)
	}

	lb := output.LoadBalancers[0]
	m, err := StructToMap(lb)
	if err != nil {
		return nil, fmt.Errorf("failed to convert load balancer to map: %w", err)
	}
	m["Region"] = region

	return m, nil
}

// ===== ELBv2 TargetGroup =====

// ListTargetGroups lists all target groups in the given region.
func ListTargetGroups(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := elbv2.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	paginator := elbv2.NewDescribeTargetGroupsPaginator(svc, &elbv2.DescribeTargetGroupsInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list target groups in %s: %w", region, err)
		}
		for _, tg := range page.TargetGroups {
			m, err := StructToMap(tg)
			if err != nil {
				return nil, fmt.Errorf("failed to convert target group to map: %w", err)
			}
			m["Region"] = region
			results = append(results, m)
		}
	}

	return results, nil
}

// GetTargetGroup gets a single target group by ARN in the given region.
func GetTargetGroup(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := elbv2.NewFromConfig(client.ConfigForRegion(region))

	output, err := svc.DescribeTargetGroups(ctx, &elbv2.DescribeTargetGroupsInput{
		TargetGroupArns: []string{id},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get target group %s in %s: %w", id, region, err)
	}

	if len(output.TargetGroups) == 0 {
		return nil, fmt.Errorf("target group %s not found in %s", id, region)
	}

	tg := output.TargetGroups[0]
	m, err := StructToMap(tg)
	if err != nil {
		return nil, fmt.Errorf("failed to convert target group to map: %w", err)
	}
	m["Region"] = region

	return m, nil
}

// ===== ELBv2 Listener =====

// ListListeners lists all listeners across all load balancers in the given region.
func ListListeners(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := elbv2.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	// First, list all load balancers to get their ARNs.
	lbPaginator := elbv2.NewDescribeLoadBalancersPaginator(svc, &elbv2.DescribeLoadBalancersInput{})
	for lbPaginator.HasMorePages() {
		lbPage, err := lbPaginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list load balancers in %s: %w", region, err)
		}
		for _, lb := range lbPage.LoadBalancers {
			listenerOutput, err := svc.DescribeListeners(ctx, &elbv2.DescribeListenersInput{
				LoadBalancerArn: lb.LoadBalancerArn,
			})
			if err != nil {
				return nil, fmt.Errorf("failed to list listeners for load balancer %s in %s: %w", *lb.LoadBalancerArn, region, err)
			}
			for _, listener := range listenerOutput.Listeners {
				m, err := StructToMap(listener)
				if err != nil {
					return nil, fmt.Errorf("failed to convert listener to map: %w", err)
				}
				m["Region"] = region
				results = append(results, m)
			}
		}
	}

	return results, nil
}

// GetListener gets a single listener by ARN in the given region.
func GetListener(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := elbv2.NewFromConfig(client.ConfigForRegion(region))

	output, err := svc.DescribeListeners(ctx, &elbv2.DescribeListenersInput{
		ListenerArns: []string{id},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get listener %s in %s: %w", id, region, err)
	}

	if len(output.Listeners) == 0 {
		return nil, fmt.Errorf("listener %s not found in %s", id, region)
	}

	listener := output.Listeners[0]
	m, err := StructToMap(listener)
	if err != nil {
		return nil, fmt.Errorf("failed to convert listener to map: %w", err)
	}
	m["Region"] = region

	return m, nil
}
