package resourcers

import (
	"context"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/service/ec2"

	"github.com/omniviewdev/aws-plugin/pkg/plugin/resource/clients"
)

// ===== VPC =====

// ListVPCs lists all VPCs in the given region.
func ListVPCs(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := ec2.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	paginator := ec2.NewDescribeVpcsPaginator(svc, &ec2.DescribeVpcsInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list VPCs in %s: %w", region, err)
		}
		for _, vpc := range page.Vpcs {
			m, err := StructToMap(vpc)
			if err != nil {
				return nil, fmt.Errorf("failed to convert VPC to map: %w", err)
			}
			m["Region"] = region
			m["_Name"] = extractNameTag(vpc.Tags)
			results = append(results, m)
		}
	}

	return results, nil
}

// GetVPC gets a single VPC by ID in the given region.
func GetVPC(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := ec2.NewFromConfig(client.ConfigForRegion(region))

	output, err := svc.DescribeVpcs(ctx, &ec2.DescribeVpcsInput{
		VpcIds: []string{id},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get VPC %s in %s: %w", id, region, err)
	}

	if len(output.Vpcs) == 0 {
		return nil, fmt.Errorf("VPC %s not found in %s", id, region)
	}

	vpc := output.Vpcs[0]
	m, err := StructToMap(vpc)
	if err != nil {
		return nil, fmt.Errorf("failed to convert VPC to map: %w", err)
	}
	m["Region"] = region
	m["_Name"] = extractNameTag(vpc.Tags)

	return m, nil
}

// ===== Subnet =====

// ListSubnets lists all subnets in the given region.
func ListSubnets(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := ec2.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	paginator := ec2.NewDescribeSubnetsPaginator(svc, &ec2.DescribeSubnetsInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list subnets in %s: %w", region, err)
		}
		for _, subnet := range page.Subnets {
			m, err := StructToMap(subnet)
			if err != nil {
				return nil, fmt.Errorf("failed to convert subnet to map: %w", err)
			}
			m["Region"] = region
			m["_Name"] = extractNameTag(subnet.Tags)
			results = append(results, m)
		}
	}

	return results, nil
}

// GetSubnet gets a single subnet by ID in the given region.
func GetSubnet(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := ec2.NewFromConfig(client.ConfigForRegion(region))

	output, err := svc.DescribeSubnets(ctx, &ec2.DescribeSubnetsInput{
		SubnetIds: []string{id},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get subnet %s in %s: %w", id, region, err)
	}

	if len(output.Subnets) == 0 {
		return nil, fmt.Errorf("subnet %s not found in %s", id, region)
	}

	subnet := output.Subnets[0]
	m, err := StructToMap(subnet)
	if err != nil {
		return nil, fmt.Errorf("failed to convert subnet to map: %w", err)
	}
	m["Region"] = region
	m["_Name"] = extractNameTag(subnet.Tags)

	return m, nil
}

// ===== Security Group =====

// ListSecurityGroups lists all security groups in the given region.
func ListSecurityGroups(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := ec2.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	paginator := ec2.NewDescribeSecurityGroupsPaginator(svc, &ec2.DescribeSecurityGroupsInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list security groups in %s: %w", region, err)
		}
		for _, sg := range page.SecurityGroups {
			m, err := StructToMap(sg)
			if err != nil {
				return nil, fmt.Errorf("failed to convert security group to map: %w", err)
			}
			m["Region"] = region
			m["_Name"] = extractNameTag(sg.Tags)
			results = append(results, m)
		}
	}

	return results, nil
}

// GetSecurityGroup gets a single security group by ID in the given region.
func GetSecurityGroup(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := ec2.NewFromConfig(client.ConfigForRegion(region))

	output, err := svc.DescribeSecurityGroups(ctx, &ec2.DescribeSecurityGroupsInput{
		GroupIds: []string{id},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get security group %s in %s: %w", id, region, err)
	}

	if len(output.SecurityGroups) == 0 {
		return nil, fmt.Errorf("security group %s not found in %s", id, region)
	}

	sg := output.SecurityGroups[0]
	m, err := StructToMap(sg)
	if err != nil {
		return nil, fmt.Errorf("failed to convert security group to map: %w", err)
	}
	m["Region"] = region
	m["_Name"] = extractNameTag(sg.Tags)

	return m, nil
}

// ===== Internet Gateway =====

// ListInternetGateways lists all internet gateways in the given region.
func ListInternetGateways(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := ec2.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	paginator := ec2.NewDescribeInternetGatewaysPaginator(svc, &ec2.DescribeInternetGatewaysInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list internet gateways in %s: %w", region, err)
		}
		for _, igw := range page.InternetGateways {
			m, err := StructToMap(igw)
			if err != nil {
				return nil, fmt.Errorf("failed to convert internet gateway to map: %w", err)
			}
			m["Region"] = region
			m["_Name"] = extractNameTag(igw.Tags)
			results = append(results, m)
		}
	}

	return results, nil
}

// GetInternetGateway gets a single internet gateway by ID in the given region.
func GetInternetGateway(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := ec2.NewFromConfig(client.ConfigForRegion(region))

	output, err := svc.DescribeInternetGateways(ctx, &ec2.DescribeInternetGatewaysInput{
		InternetGatewayIds: []string{id},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get internet gateway %s in %s: %w", id, region, err)
	}

	if len(output.InternetGateways) == 0 {
		return nil, fmt.Errorf("internet gateway %s not found in %s", id, region)
	}

	igw := output.InternetGateways[0]
	m, err := StructToMap(igw)
	if err != nil {
		return nil, fmt.Errorf("failed to convert internet gateway to map: %w", err)
	}
	m["Region"] = region
	m["_Name"] = extractNameTag(igw.Tags)

	return m, nil
}

// ===== NAT Gateway =====

// ListNATGateways lists all NAT gateways in the given region.
func ListNATGateways(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := ec2.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	paginator := ec2.NewDescribeNatGatewaysPaginator(svc, &ec2.DescribeNatGatewaysInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list NAT gateways in %s: %w", region, err)
		}
		for _, natgw := range page.NatGateways {
			m, err := StructToMap(natgw)
			if err != nil {
				return nil, fmt.Errorf("failed to convert NAT gateway to map: %w", err)
			}
			m["Region"] = region
			m["_Name"] = extractNameTag(natgw.Tags)
			results = append(results, m)
		}
	}

	return results, nil
}

// GetNATGateway gets a single NAT gateway by ID in the given region.
func GetNATGateway(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := ec2.NewFromConfig(client.ConfigForRegion(region))

	output, err := svc.DescribeNatGateways(ctx, &ec2.DescribeNatGatewaysInput{
		NatGatewayIds: []string{id},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get NAT gateway %s in %s: %w", id, region, err)
	}

	if len(output.NatGateways) == 0 {
		return nil, fmt.Errorf("NAT gateway %s not found in %s", id, region)
	}

	natgw := output.NatGateways[0]
	m, err := StructToMap(natgw)
	if err != nil {
		return nil, fmt.Errorf("failed to convert NAT gateway to map: %w", err)
	}
	m["Region"] = region
	m["_Name"] = extractNameTag(natgw.Tags)

	return m, nil
}

// ===== Route Table =====

// ListRouteTables lists all route tables in the given region.
func ListRouteTables(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := ec2.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	paginator := ec2.NewDescribeRouteTablesPaginator(svc, &ec2.DescribeRouteTablesInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list route tables in %s: %w", region, err)
		}
		for _, rt := range page.RouteTables {
			m, err := StructToMap(rt)
			if err != nil {
				return nil, fmt.Errorf("failed to convert route table to map: %w", err)
			}
			m["Region"] = region
			m["_Name"] = extractNameTag(rt.Tags)
			results = append(results, m)
		}
	}

	return results, nil
}

// GetRouteTable gets a single route table by ID in the given region.
func GetRouteTable(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := ec2.NewFromConfig(client.ConfigForRegion(region))

	output, err := svc.DescribeRouteTables(ctx, &ec2.DescribeRouteTablesInput{
		RouteTableIds: []string{id},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get route table %s in %s: %w", id, region, err)
	}

	if len(output.RouteTables) == 0 {
		return nil, fmt.Errorf("route table %s not found in %s", id, region)
	}

	rt := output.RouteTables[0]
	m, err := StructToMap(rt)
	if err != nil {
		return nil, fmt.Errorf("failed to convert route table to map: %w", err)
	}
	m["Region"] = region
	m["_Name"] = extractNameTag(rt.Tags)

	return m, nil
}

// ===== Network ACL =====

// ListNetworkACLs lists all network ACLs in the given region.
func ListNetworkACLs(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := ec2.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	paginator := ec2.NewDescribeNetworkAclsPaginator(svc, &ec2.DescribeNetworkAclsInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list network ACLs in %s: %w", region, err)
		}
		for _, nacl := range page.NetworkAcls {
			m, err := StructToMap(nacl)
			if err != nil {
				return nil, fmt.Errorf("failed to convert network ACL to map: %w", err)
			}
			m["Region"] = region
			m["_Name"] = extractNameTag(nacl.Tags)
			results = append(results, m)
		}
	}

	return results, nil
}

// GetNetworkACL gets a single network ACL by ID in the given region.
func GetNetworkACL(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := ec2.NewFromConfig(client.ConfigForRegion(region))

	output, err := svc.DescribeNetworkAcls(ctx, &ec2.DescribeNetworkAclsInput{
		NetworkAclIds: []string{id},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get network ACL %s in %s: %w", id, region, err)
	}

	if len(output.NetworkAcls) == 0 {
		return nil, fmt.Errorf("network ACL %s not found in %s", id, region)
	}

	nacl := output.NetworkAcls[0]
	m, err := StructToMap(nacl)
	if err != nil {
		return nil, fmt.Errorf("failed to convert network ACL to map: %w", err)
	}
	m["Region"] = region
	m["_Name"] = extractNameTag(nacl.Tags)

	return m, nil
}

// ===== Network Interface =====

// ListNetworkInterfaces lists all network interfaces in the given region.
func ListNetworkInterfaces(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := ec2.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	paginator := ec2.NewDescribeNetworkInterfacesPaginator(svc, &ec2.DescribeNetworkInterfacesInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list network interfaces in %s: %w", region, err)
		}
		for _, eni := range page.NetworkInterfaces {
			m, err := StructToMap(eni)
			if err != nil {
				return nil, fmt.Errorf("failed to convert network interface to map: %w", err)
			}
			m["Region"] = region
			m["_Name"] = extractNameTag(eni.TagSet)
			results = append(results, m)
		}
	}

	return results, nil
}

// GetNetworkInterface gets a single network interface by ID in the given region.
func GetNetworkInterface(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := ec2.NewFromConfig(client.ConfigForRegion(region))

	output, err := svc.DescribeNetworkInterfaces(ctx, &ec2.DescribeNetworkInterfacesInput{
		NetworkInterfaceIds: []string{id},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get network interface %s in %s: %w", id, region, err)
	}

	if len(output.NetworkInterfaces) == 0 {
		return nil, fmt.Errorf("network interface %s not found in %s", id, region)
	}

	eni := output.NetworkInterfaces[0]
	m, err := StructToMap(eni)
	if err != nil {
		return nil, fmt.Errorf("failed to convert network interface to map: %w", err)
	}
	m["Region"] = region
	m["_Name"] = extractNameTag(eni.TagSet)

	return m, nil
}

// ===== VPC Endpoint =====

// ListVPCEndpoints lists all VPC endpoints in the given region.
func ListVPCEndpoints(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := ec2.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	paginator := ec2.NewDescribeVpcEndpointsPaginator(svc, &ec2.DescribeVpcEndpointsInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list VPC endpoints in %s: %w", region, err)
		}
		for _, endpoint := range page.VpcEndpoints {
			m, err := StructToMap(endpoint)
			if err != nil {
				return nil, fmt.Errorf("failed to convert VPC endpoint to map: %w", err)
			}
			m["Region"] = region
			m["_Name"] = extractNameTag(endpoint.Tags)
			results = append(results, m)
		}
	}

	return results, nil
}

// GetVPCEndpoint gets a single VPC endpoint by ID in the given region.
func GetVPCEndpoint(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := ec2.NewFromConfig(client.ConfigForRegion(region))

	output, err := svc.DescribeVpcEndpoints(ctx, &ec2.DescribeVpcEndpointsInput{
		VpcEndpointIds: []string{id},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get VPC endpoint %s in %s: %w", id, region, err)
	}

	if len(output.VpcEndpoints) == 0 {
		return nil, fmt.Errorf("VPC endpoint %s not found in %s", id, region)
	}

	endpoint := output.VpcEndpoints[0]
	m, err := StructToMap(endpoint)
	if err != nil {
		return nil, fmt.Errorf("failed to convert VPC endpoint to map: %w", err)
	}
	m["Region"] = region
	m["_Name"] = extractNameTag(endpoint.Tags)

	return m, nil
}

// ===== VPC Peering Connection =====

// ListVPCPeeringConnections lists all VPC peering connections in the given region.
func ListVPCPeeringConnections(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := ec2.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	paginator := ec2.NewDescribeVpcPeeringConnectionsPaginator(svc, &ec2.DescribeVpcPeeringConnectionsInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list VPC peering connections in %s: %w", region, err)
		}
		for _, pcx := range page.VpcPeeringConnections {
			m, err := StructToMap(pcx)
			if err != nil {
				return nil, fmt.Errorf("failed to convert VPC peering connection to map: %w", err)
			}
			m["Region"] = region
			m["_Name"] = extractNameTag(pcx.Tags)
			results = append(results, m)
		}
	}

	return results, nil
}

// GetVPCPeeringConnection gets a single VPC peering connection by ID in the given region.
func GetVPCPeeringConnection(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := ec2.NewFromConfig(client.ConfigForRegion(region))

	output, err := svc.DescribeVpcPeeringConnections(ctx, &ec2.DescribeVpcPeeringConnectionsInput{
		VpcPeeringConnectionIds: []string{id},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get VPC peering connection %s in %s: %w", id, region, err)
	}

	if len(output.VpcPeeringConnections) == 0 {
		return nil, fmt.Errorf("VPC peering connection %s not found in %s", id, region)
	}

	pcx := output.VpcPeeringConnections[0]
	m, err := StructToMap(pcx)
	if err != nil {
		return nil, fmt.Errorf("failed to convert VPC peering connection to map: %w", err)
	}
	m["Region"] = region
	m["_Name"] = extractNameTag(pcx.Tags)

	return m, nil
}

// ===== Transit Gateway =====

// ListTransitGateways lists all transit gateways in the given region.
func ListTransitGateways(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := ec2.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	paginator := ec2.NewDescribeTransitGatewaysPaginator(svc, &ec2.DescribeTransitGatewaysInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list transit gateways in %s: %w", region, err)
		}
		for _, tgw := range page.TransitGateways {
			m, err := StructToMap(tgw)
			if err != nil {
				return nil, fmt.Errorf("failed to convert transit gateway to map: %w", err)
			}
			m["Region"] = region
			m["_Name"] = extractNameTag(tgw.Tags)
			results = append(results, m)
		}
	}

	return results, nil
}

// GetTransitGateway gets a single transit gateway by ID in the given region.
func GetTransitGateway(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := ec2.NewFromConfig(client.ConfigForRegion(region))

	output, err := svc.DescribeTransitGateways(ctx, &ec2.DescribeTransitGatewaysInput{
		TransitGatewayIds: []string{id},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get transit gateway %s in %s: %w", id, region, err)
	}

	if len(output.TransitGateways) == 0 {
		return nil, fmt.Errorf("transit gateway %s not found in %s", id, region)
	}

	tgw := output.TransitGateways[0]
	m, err := StructToMap(tgw)
	if err != nil {
		return nil, fmt.Errorf("failed to convert transit gateway to map: %w", err)
	}
	m["Region"] = region
	m["_Name"] = extractNameTag(tgw.Tags)

	return m, nil
}

// ===== VPC Flow Log =====

// ListFlowLogs lists all VPC flow logs in the given region.
func ListFlowLogs(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := ec2.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	paginator := ec2.NewDescribeFlowLogsPaginator(svc, &ec2.DescribeFlowLogsInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list VPC flow logs in %s: %w", region, err)
		}
		for _, fl := range page.FlowLogs {
			m, err := StructToMap(fl)
			if err != nil {
				return nil, fmt.Errorf("failed to convert VPC flow log to map: %w", err)
			}
			m["Region"] = region
			m["_Name"] = extractNameTag(fl.Tags)
			results = append(results, m)
		}
	}

	return results, nil
}

// GetFlowLog gets a single VPC flow log by ID in the given region.
func GetFlowLog(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := ec2.NewFromConfig(client.ConfigForRegion(region))

	output, err := svc.DescribeFlowLogs(ctx, &ec2.DescribeFlowLogsInput{
		FlowLogIds: []string{id},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get VPC flow log %s in %s: %w", id, region, err)
	}

	if len(output.FlowLogs) == 0 {
		return nil, fmt.Errorf("VPC flow log %s not found in %s", id, region)
	}

	fl := output.FlowLogs[0]
	m, err := StructToMap(fl)
	if err != nil {
		return nil, fmt.Errorf("failed to convert VPC flow log to map: %w", err)
	}
	m["Region"] = region
	m["_Name"] = extractNameTag(fl.Tags)

	return m, nil
}

// ===== DHCP Options Set =====

// ListDHCPOptionsSets lists all DHCP options sets in the given region.
func ListDHCPOptionsSets(ctx context.Context, client *clients.Client, region string) ([]map[string]interface{}, error) {
	svc := ec2.NewFromConfig(client.ConfigForRegion(region))
	results := make([]map[string]interface{}, 0)

	paginator := ec2.NewDescribeDhcpOptionsPaginator(svc, &ec2.DescribeDhcpOptionsInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list DHCP options sets in %s: %w", region, err)
		}
		for _, dhcp := range page.DhcpOptions {
			m, err := StructToMap(dhcp)
			if err != nil {
				return nil, fmt.Errorf("failed to convert DHCP options set to map: %w", err)
			}
			m["Region"] = region
			m["_Name"] = extractNameTag(dhcp.Tags)
			results = append(results, m)
		}
	}

	return results, nil
}

// GetDHCPOptionsSet gets a single DHCP options set by ID in the given region.
func GetDHCPOptionsSet(ctx context.Context, client *clients.Client, region string, id string) (map[string]interface{}, error) {
	svc := ec2.NewFromConfig(client.ConfigForRegion(region))

	output, err := svc.DescribeDhcpOptions(ctx, &ec2.DescribeDhcpOptionsInput{
		DhcpOptionsIds: []string{id},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get DHCP options set %s in %s: %w", id, region, err)
	}

	if len(output.DhcpOptions) == 0 {
		return nil, fmt.Errorf("DHCP options set %s not found in %s", id, region)
	}

	dhcp := output.DhcpOptions[0]
	m, err := StructToMap(dhcp)
	if err != nil {
		return nil, fmt.Errorf("failed to convert DHCP options set to map: %w", err)
	}
	m["Region"] = region
	m["_Name"] = extractNameTag(dhcp.Tags)

	return m, nil
}
