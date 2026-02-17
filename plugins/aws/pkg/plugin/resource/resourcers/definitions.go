package resourcers

import "github.com/omniviewdev/plugin-sdk/pkg/resource/types"

//nolint:gochecknoglobals // resource definitions
var ResourceDefs = map[string]types.ResourceDefinition{
	// ===== EC2 =====
	"ec2::v1::Instance": {
		IDAccessor:        "InstanceId",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "InstanceId",
		ColumnDefs: []types.ColumnDef{
			{ID: "name", Header: "Name", Accessors: "_Name", Width: 200},
			{ID: "id", Header: "Instance ID", Accessors: "InstanceId", Width: 200},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "type", Header: "Instance Type", Accessors: "InstanceType", Width: 120},
			{ID: "state", Header: "State", Accessors: "State.Name", Width: 100, ColorMap: map[string]string{
				"running": "success", "stopped": "danger", "pending": "warning",
				"stopping": "warning", "shutting-down": "danger", "terminated": "danger",
			}},
			{ID: "az", Header: "Availability Zone", Accessors: "Placement.AvailabilityZone", Width: 150},
			{ID: "publicIp", Header: "Public IP", Accessors: "PublicIpAddress", Width: 140},
			{ID: "privateIp", Header: "Private IP", Accessors: "PrivateIpAddress", Width: 140},
			{ID: "vpcId", Header: "VPC ID", Accessors: "VpcId", Width: 180},
			{ID: "launchTime", Header: "Launch Time", Accessors: "LaunchTime", Formatter: types.CellValueFormatterAge},
		},
	},
	"ec2::v1::Image": {
		IDAccessor:        "ImageId",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "ImageId",
		ColumnDefs: []types.ColumnDef{
			{ID: "id", Header: "Image ID", Accessors: "ImageId", Width: 200},
			{ID: "name", Header: "Name", Accessors: "Name", Width: 250},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "state", Header: "State", Accessors: "State", Width: 100, ColorMap: map[string]string{
				"available": "success", "pending": "warning", "failed": "danger",
			}},
			{ID: "arch", Header: "Architecture", Accessors: "Architecture", Width: 120},
			{ID: "type", Header: "Type", Accessors: "ImageType", Width: 100},
			{ID: "platform", Header: "Platform", Accessors: "PlatformDetails", Width: 150},
			{ID: "created", Header: "Created", Accessors: "CreationDate", Formatter: types.CellValueFormatterAge},
		},
	},
	"ec2::v1::KeyPair": {
		IDAccessor:        "KeyPairId",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "KeyPairId",
		ColumnDefs: []types.ColumnDef{
			{ID: "name", Header: "Name", Accessors: "KeyName", Width: 200},
			{ID: "id", Header: "Key Pair ID", Accessors: "KeyPairId", Width: 200},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "type", Header: "Type", Accessors: "KeyType", Width: 100},
			{ID: "fingerprint", Header: "Fingerprint", Accessors: "KeyFingerprint", Width: 300},
			{ID: "created", Header: "Created", Accessors: "CreateTime", Formatter: types.CellValueFormatterAge},
		},
	},
	"ec2::v1::LaunchTemplate": {
		IDAccessor:        "LaunchTemplateId",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "LaunchTemplateId",
		ColumnDefs: []types.ColumnDef{
			{ID: "name", Header: "Name", Accessors: "LaunchTemplateName", Width: 250},
			{ID: "id", Header: "Template ID", Accessors: "LaunchTemplateId", Width: 200},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "version", Header: "Latest Version", Accessors: "LatestVersionNumber", Width: 130},
			{ID: "defaultVersion", Header: "Default Version", Accessors: "DefaultVersionNumber", Width: 130},
			{ID: "created", Header: "Created", Accessors: "CreateTime", Formatter: types.CellValueFormatterAge},
		},
	},
	"ec2::v1::Volume": {
		IDAccessor:        "VolumeId",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "VolumeId",
		ColumnDefs: []types.ColumnDef{
			{ID: "name", Header: "Name", Accessors: "_Name", Width: 200},
			{ID: "id", Header: "Volume ID", Accessors: "VolumeId", Width: 200},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "type", Header: "Type", Accessors: "VolumeType", Width: 100},
			{ID: "size", Header: "Size (GiB)", Accessors: "Size", Width: 100},
			{ID: "state", Header: "State", Accessors: "State", Width: 100, ColorMap: map[string]string{
				"in-use": "success", "available": "primary", "creating": "warning",
				"deleting": "danger", "error": "danger",
			}},
			{ID: "az", Header: "Availability Zone", Accessors: "AvailabilityZone", Width: 150},
			{ID: "encrypted", Header: "Encrypted", Accessors: "Encrypted", Width: 90},
			{ID: "created", Header: "Created", Accessors: "CreateTime", Formatter: types.CellValueFormatterAge},
		},
	},
	"ec2::v1::Snapshot": {
		IDAccessor:        "SnapshotId",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "SnapshotId",
		ColumnDefs: []types.ColumnDef{
			{ID: "id", Header: "Snapshot ID", Accessors: "SnapshotId", Width: 200},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "volumeId", Header: "Volume ID", Accessors: "VolumeId", Width: 200},
			{ID: "state", Header: "State", Accessors: "State", Width: 100, ColorMap: map[string]string{
				"completed": "success", "pending": "warning", "error": "danger",
			}},
			{ID: "size", Header: "Size (GiB)", Accessors: "VolumeSize", Width: 100},
			{ID: "encrypted", Header: "Encrypted", Accessors: "Encrypted", Width: 90},
			{ID: "started", Header: "Started", Accessors: "StartTime", Formatter: types.CellValueFormatterAge},
		},
	},
	"ec2::v1::ElasticIP": {
		IDAccessor:        "AllocationId",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "AllocationId",
		ColumnDefs: []types.ColumnDef{
			{ID: "ip", Header: "Public IP", Accessors: "PublicIp", Width: 140},
			{ID: "id", Header: "Allocation ID", Accessors: "AllocationId", Width: 200},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "instanceId", Header: "Instance ID", Accessors: "InstanceId", Width: 200},
			{ID: "privateIp", Header: "Private IP", Accessors: "PrivateIpAddress", Width: 140},
			{ID: "domain", Header: "Domain", Accessors: "Domain", Width: 80},
		},
	},

	"ec2::v1::PlacementGroup": {
		IDAccessor:        "GroupName",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "GroupName",
		ColumnDefs: []types.ColumnDef{
			{ID: "name", Header: "Name", Accessors: "GroupName", Width: 250},
			{ID: "id", Header: "Group ID", Accessors: "GroupId", Width: 200},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "strategy", Header: "Strategy", Accessors: "Strategy", Width: 120},
			{ID: "state", Header: "State", Accessors: "State", Width: 100, ColorMap: map[string]string{
				"available": "success", "pending": "warning", "deleting": "danger", "deleted": "danger",
			}},
			{ID: "partitions", Header: "Partitions", Accessors: "PartitionCount", Width: 100},
		},
	},

	// ===== VPC =====
	"vpc::v1::VPC": {
		IDAccessor:        "VpcId",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "VpcId",
		ColumnDefs: []types.ColumnDef{
			{ID: "name", Header: "Name", Accessors: "_Name", Width: 200},
			{ID: "id", Header: "VPC ID", Accessors: "VpcId", Width: 200},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "state", Header: "State", Accessors: "State", Width: 100, ColorMap: map[string]string{
				"available": "success", "pending": "warning",
			}},
			{ID: "cidr", Header: "CIDR Block", Accessors: "CidrBlock", Width: 150},
			{ID: "isDefault", Header: "Default", Accessors: "IsDefault", Width: 80},
			{ID: "tenancy", Header: "Tenancy", Accessors: "InstanceTenancy", Width: 100},
		},
	},
	"vpc::v1::Subnet": {
		IDAccessor:        "SubnetId",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "SubnetId",
		ColumnDefs: []types.ColumnDef{
			{ID: "name", Header: "Name", Accessors: "_Name", Width: 200},
			{ID: "id", Header: "Subnet ID", Accessors: "SubnetId", Width: 200},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "vpcId", Header: "VPC ID", Accessors: "VpcId", Width: 200},
			{ID: "state", Header: "State", Accessors: "State", Width: 100, ColorMap: map[string]string{
				"available": "success", "pending": "warning",
			}},
			{ID: "cidr", Header: "CIDR Block", Accessors: "CidrBlock", Width: 150},
			{ID: "az", Header: "Availability Zone", Accessors: "AvailabilityZone", Width: 150},
			{ID: "ips", Header: "Available IPs", Accessors: "AvailableIpAddressCount", Width: 120},
		},
	},
	"vpc::v1::SecurityGroup": {
		IDAccessor:        "GroupId",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "GroupId",
		ColumnDefs: []types.ColumnDef{
			{ID: "name", Header: "Name", Accessors: "GroupName", Width: 200},
			{ID: "id", Header: "Group ID", Accessors: "GroupId", Width: 200},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "vpcId", Header: "VPC ID", Accessors: "VpcId", Width: 200},
			{ID: "description", Header: "Description", Accessors: "Description", Width: 300},
		},
	},
	"vpc::v1::InternetGateway": {
		IDAccessor:        "InternetGatewayId",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "InternetGatewayId",
		ColumnDefs: []types.ColumnDef{
			{ID: "name", Header: "Name", Accessors: "_Name", Width: 200},
			{ID: "id", Header: "IGW ID", Accessors: "InternetGatewayId", Width: 200},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
		},
	},
	"vpc::v1::NATGateway": {
		IDAccessor:        "NatGatewayId",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "NatGatewayId",
		ColumnDefs: []types.ColumnDef{
			{ID: "name", Header: "Name", Accessors: "_Name", Width: 200},
			{ID: "id", Header: "NAT GW ID", Accessors: "NatGatewayId", Width: 200},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "state", Header: "State", Accessors: "State", Width: 100, ColorMap: map[string]string{
				"available": "success", "pending": "warning", "failed": "danger",
				"deleting": "danger", "deleted": "danger",
			}},
			{ID: "subnetId", Header: "Subnet ID", Accessors: "SubnetId", Width: 200},
			{ID: "vpcId", Header: "VPC ID", Accessors: "VpcId", Width: 200},
			{ID: "type", Header: "Type", Accessors: "ConnectivityType", Width: 100},
			{ID: "created", Header: "Created", Accessors: "CreateTime", Formatter: types.CellValueFormatterAge},
		},
	},
	"vpc::v1::RouteTable": {
		IDAccessor:        "RouteTableId",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "RouteTableId",
		ColumnDefs: []types.ColumnDef{
			{ID: "name", Header: "Name", Accessors: "_Name", Width: 200},
			{ID: "id", Header: "Route Table ID", Accessors: "RouteTableId", Width: 200},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "vpcId", Header: "VPC ID", Accessors: "VpcId", Width: 200},
		},
	},
	"vpc::v1::NetworkACL": {
		IDAccessor:        "NetworkAclId",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "NetworkAclId",
		ColumnDefs: []types.ColumnDef{
			{ID: "name", Header: "Name", Accessors: "_Name", Width: 200},
			{ID: "id", Header: "NACL ID", Accessors: "NetworkAclId", Width: 200},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "vpcId", Header: "VPC ID", Accessors: "VpcId", Width: 200},
			{ID: "isDefault", Header: "Default", Accessors: "IsDefault", Width: 80},
		},
	},
	"vpc::v1::NetworkInterface": {
		IDAccessor:        "NetworkInterfaceId",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "NetworkInterfaceId",
		ColumnDefs: []types.ColumnDef{
			{ID: "id", Header: "ENI ID", Accessors: "NetworkInterfaceId", Width: 200},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "status", Header: "Status", Accessors: "Status", Width: 100, ColorMap: map[string]string{
				"in-use": "success", "available": "primary",
			}},
			{ID: "subnetId", Header: "Subnet ID", Accessors: "SubnetId", Width: 200},
			{ID: "vpcId", Header: "VPC ID", Accessors: "VpcId", Width: 200},
			{ID: "privateIp", Header: "Private IP", Accessors: "PrivateIpAddress", Width: 140},
			{ID: "type", Header: "Type", Accessors: "InterfaceType", Width: 120},
		},
	},
	"vpc::v1::VPCEndpoint": {
		IDAccessor:        "VpcEndpointId",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "VpcEndpointId",
		ColumnDefs: []types.ColumnDef{
			{ID: "name", Header: "Name", Accessors: "_Name", Width: 200},
			{ID: "id", Header: "Endpoint ID", Accessors: "VpcEndpointId", Width: 200},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "service", Header: "Service", Accessors: "ServiceName", Width: 300},
			{ID: "state", Header: "State", Accessors: "State", Width: 100, ColorMap: map[string]string{
				"available": "success", "pending": "warning", "failed": "danger",
			}},
			{ID: "type", Header: "Type", Accessors: "VpcEndpointType", Width: 120},
			{ID: "vpcId", Header: "VPC ID", Accessors: "VpcId", Width: 200},
		},
	},
	"vpc::v1::VPCPeeringConnection": {
		IDAccessor:        "VpcPeeringConnectionId",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "VpcPeeringConnectionId",
		ColumnDefs: []types.ColumnDef{
			{ID: "id", Header: "Peering ID", Accessors: "VpcPeeringConnectionId", Width: 200},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "status", Header: "Status", Accessors: "Status.Code", Width: 120},
		},
	},
	"vpc::v1::TransitGateway": {
		IDAccessor:        "TransitGatewayId",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "TransitGatewayId",
		ColumnDefs: []types.ColumnDef{
			{ID: "name", Header: "Name", Accessors: "_Name", Width: 200},
			{ID: "id", Header: "TGW ID", Accessors: "TransitGatewayId", Width: 200},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "state", Header: "State", Accessors: "State", Width: 100, ColorMap: map[string]string{
				"available": "success", "pending": "warning", "deleting": "danger",
			}},
			{ID: "ownerId", Header: "Owner", Accessors: "OwnerId", Width: 130},
		},
	},

	"vpc::v1::DHCPOptionsSet": {
		IDAccessor:        "DhcpOptionsId",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "DhcpOptionsId",
		ColumnDefs: []types.ColumnDef{
			{ID: "name", Header: "Name", Accessors: "_Name", Width: 200},
			{ID: "id", Header: "DHCP Options ID", Accessors: "DhcpOptionsId", Width: 200},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "ownerId", Header: "Owner", Accessors: "OwnerId", Width: 130},
		},
	},

	// ===== EKS =====
	"eks::v1::Cluster": {
		IDAccessor:        "Name",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "Name",
		ColumnDefs: []types.ColumnDef{
			{ID: "name", Header: "Name", Accessors: "Name", Width: 250},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "status", Header: "Status", Accessors: "Status", Width: 100, ColorMap: map[string]string{
				"ACTIVE": "success", "CREATING": "warning", "DELETING": "danger",
				"FAILED": "danger", "UPDATING": "warning",
			}},
			{ID: "version", Header: "Version", Accessors: "Version", Width: 80},
			{ID: "endpoint", Header: "Endpoint", Accessors: "Endpoint", Width: 300},
			{ID: "created", Header: "Created", Accessors: "CreatedAt", Formatter: types.CellValueFormatterAge},
		},
	},
	"eks::v1::Nodegroup": {
		IDAccessor:        "NodegroupName",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "NodegroupName",
		ColumnDefs: []types.ColumnDef{
			{ID: "name", Header: "Name", Accessors: "NodegroupName", Width: 200},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "cluster", Header: "Cluster", Accessors: "ClusterName", Width: 200},
			{ID: "status", Header: "Status", Accessors: "Status", Width: 100, ColorMap: map[string]string{
				"ACTIVE": "success", "CREATING": "warning", "DELETING": "danger",
				"DEGRADED": "danger", "UPDATING": "warning",
			}},
			{ID: "capacity", Header: "Capacity Type", Accessors: "CapacityType", Width: 120},
			{ID: "created", Header: "Created", Accessors: "CreatedAt", Formatter: types.CellValueFormatterAge},
		},
	},
	"eks::v1::Addon": {
		IDAccessor:        "AddonName",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "AddonName",
		ColumnDefs: []types.ColumnDef{
			{ID: "name", Header: "Name", Accessors: "AddonName", Width: 200},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "cluster", Header: "Cluster", Accessors: "ClusterName", Width: 200},
			{ID: "version", Header: "Version", Accessors: "AddonVersion", Width: 150},
			{ID: "status", Header: "Status", Accessors: "Status", Width: 100, ColorMap: map[string]string{
				"ACTIVE": "success", "CREATING": "warning", "DELETING": "danger",
				"DEGRADED": "danger", "UPDATING": "warning",
			}},
		},
	},

	// ===== S3 =====
	"s3::v1::Bucket": {
		IDAccessor:       "Name",
		MemoizerAccessor: "Name",
		ColumnDefs: []types.ColumnDef{
			{ID: "name", Header: "Bucket Name", Accessors: "Name", Width: 300},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "created", Header: "Created", Accessors: "CreationDate", Formatter: types.CellValueFormatterAge},
		},
	},

	// ===== RDS =====
	"rds::v1::DBInstance": {
		IDAccessor:        "DBInstanceIdentifier",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "DBInstanceIdentifier",
		ColumnDefs: []types.ColumnDef{
			{ID: "id", Header: "DB Instance ID", Accessors: "DBInstanceIdentifier", Width: 250},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "engine", Header: "Engine", Accessors: "Engine", Width: 120},
			{ID: "engineVersion", Header: "Version", Accessors: "EngineVersion", Width: 100},
			{ID: "class", Header: "Class", Accessors: "DBInstanceClass", Width: 140},
			{ID: "status", Header: "Status", Accessors: "DBInstanceStatus", Width: 100, ColorMap: map[string]string{
				"available": "success", "creating": "warning", "deleting": "danger",
				"stopped": "danger", "stopping": "warning", "starting": "warning",
			}},
			{ID: "az", Header: "AZ", Accessors: "AvailabilityZone", Width: 130},
			{ID: "multiAZ", Header: "Multi-AZ", Accessors: "MultiAZ", Width: 80},
			{ID: "storage", Header: "Storage (GiB)", Accessors: "AllocatedStorage", Width: 120},
			{ID: "endpoint", Header: "Endpoint", Accessors: "Endpoint.Address", Width: 300},
		},
	},
	"rds::v1::DBCluster": {
		IDAccessor:        "DBClusterIdentifier",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "DBClusterIdentifier",
		ColumnDefs: []types.ColumnDef{
			{ID: "id", Header: "Cluster ID", Accessors: "DBClusterIdentifier", Width: 250},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "engine", Header: "Engine", Accessors: "Engine", Width: 120},
			{ID: "engineVersion", Header: "Version", Accessors: "EngineVersion", Width: 100},
			{ID: "status", Header: "Status", Accessors: "Status", Width: 100, ColorMap: map[string]string{
				"available": "success", "creating": "warning", "deleting": "danger",
			}},
			{ID: "members", Header: "Members", Accessors: "DBClusterMembers", Formatter: types.CellValueFormatterCount},
			{ID: "endpoint", Header: "Endpoint", Accessors: "Endpoint", Width: 300},
		},
	},
	"rds::v1::DBSubnetGroup": {
		IDAccessor:        "DBSubnetGroupName",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "DBSubnetGroupName",
		ColumnDefs: []types.ColumnDef{
			{ID: "name", Header: "Name", Accessors: "DBSubnetGroupName", Width: 250},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "status", Header: "Status", Accessors: "SubnetGroupStatus", Width: 100},
			{ID: "vpcId", Header: "VPC ID", Accessors: "VpcId", Width: 200},
			{ID: "description", Header: "Description", Accessors: "DBSubnetGroupDescription", Width: 300},
		},
	},
	"rds::v1::DBSnapshot": {
		IDAccessor:        "DBSnapshotIdentifier",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "DBSnapshotIdentifier",
		ColumnDefs: []types.ColumnDef{
			{ID: "id", Header: "Snapshot ID", Accessors: "DBSnapshotIdentifier", Width: 250},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "dbId", Header: "DB Instance", Accessors: "DBInstanceIdentifier", Width: 200},
			{ID: "engine", Header: "Engine", Accessors: "Engine", Width: 120},
			{ID: "status", Header: "Status", Accessors: "Status", Width: 100, ColorMap: map[string]string{
				"available": "success", "creating": "warning",
			}},
			{ID: "storage", Header: "Size (GiB)", Accessors: "AllocatedStorage", Width: 100},
			{ID: "created", Header: "Created", Accessors: "SnapshotCreateTime", Formatter: types.CellValueFormatterAge},
		},
	},
	"rds::v1::DBParameterGroup": {
		IDAccessor:        "DBParameterGroupName",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "DBParameterGroupName",
		ColumnDefs: []types.ColumnDef{
			{ID: "name", Header: "Name", Accessors: "DBParameterGroupName", Width: 250},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "family", Header: "Family", Accessors: "DBParameterGroupFamily", Width: 150},
			{ID: "description", Header: "Description", Accessors: "Description", Width: 300},
		},
	},

	// ===== ElastiCache =====
	"elasticache::v1::CacheCluster": {
		IDAccessor:        "CacheClusterId",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "CacheClusterId",
		ColumnDefs: []types.ColumnDef{
			{ID: "id", Header: "Cluster ID", Accessors: "CacheClusterId", Width: 250},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "engine", Header: "Engine", Accessors: "Engine", Width: 100},
			{ID: "engineVersion", Header: "Version", Accessors: "EngineVersion", Width: 100},
			{ID: "nodeType", Header: "Node Type", Accessors: "CacheNodeType", Width: 140},
			{ID: "status", Header: "Status", Accessors: "CacheClusterStatus", Width: 100, ColorMap: map[string]string{
				"available": "success", "creating": "warning", "deleting": "danger",
			}},
			{ID: "nodes", Header: "Nodes", Accessors: "NumCacheNodes", Width: 70},
		},
	},
	"elasticache::v1::ReplicationGroup": {
		IDAccessor:        "ReplicationGroupId",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "ReplicationGroupId",
		ColumnDefs: []types.ColumnDef{
			{ID: "id", Header: "Replication Group ID", Accessors: "ReplicationGroupId", Width: 250},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "status", Header: "Status", Accessors: "Status", Width: 100, ColorMap: map[string]string{
				"available": "success", "creating": "warning", "deleting": "danger",
			}},
			{ID: "description", Header: "Description", Accessors: "Description", Width: 300},
			{ID: "clusterEnabled", Header: "Cluster Mode", Accessors: "ClusterEnabled", Width: 110},
		},
	},
	"elasticache::v1::CacheSubnetGroup": {
		IDAccessor:        "CacheSubnetGroupName",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "CacheSubnetGroupName",
		ColumnDefs: []types.ColumnDef{
			{ID: "name", Header: "Name", Accessors: "CacheSubnetGroupName", Width: 250},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "vpcId", Header: "VPC ID", Accessors: "VpcId", Width: 200},
			{ID: "description", Header: "Description", Accessors: "CacheSubnetGroupDescription", Width: 300},
		},
	},

	// ===== Lambda =====
	"lambda::v1::Function": {
		IDAccessor:        "FunctionName",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "FunctionName",
		ColumnDefs: []types.ColumnDef{
			{ID: "name", Header: "Function Name", Accessors: "FunctionName", Width: 250},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "runtime", Header: "Runtime", Accessors: "Runtime", Width: 130},
			{ID: "handler", Header: "Handler", Accessors: "Handler", Width: 200},
			{ID: "memory", Header: "Memory (MB)", Accessors: "MemorySize", Width: 110},
			{ID: "timeout", Header: "Timeout (s)", Accessors: "Timeout", Width: 100},
			{ID: "codeSize", Header: "Code Size", Accessors: "CodeSize", Formatter: types.CellValueFormatterBytes, Width: 100},
			{ID: "lastModified", Header: "Last Modified", Accessors: "LastModified", Formatter: types.CellValueFormatterAge},
		},
	},
	"lambda::v1::Layer": {
		IDAccessor:        "LayerName",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "LayerName",
		ColumnDefs: []types.ColumnDef{
			{ID: "name", Header: "Layer Name", Accessors: "LayerName", Width: 250},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "latestVersion", Header: "Latest Version", Accessors: "LatestMatchingVersion.Version", Width: 120},
		},
	},
	"lambda::v1::EventSourceMapping": {
		IDAccessor:        "UUID",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "UUID",
		ColumnDefs: []types.ColumnDef{
			{ID: "uuid", Header: "UUID", Accessors: "UUID", Width: 300},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "function", Header: "Function", Accessors: "FunctionArn", Width: 300},
			{ID: "source", Header: "Event Source", Accessors: "EventSourceArn", Width: 300},
			{ID: "state", Header: "State", Accessors: "State", Width: 100, ColorMap: map[string]string{
				"Enabled": "success", "Disabled": "danger", "Creating": "warning",
			}},
		},
	},

	// ===== ELB =====
	"elbv2::v1::LoadBalancer": {
		IDAccessor:        "LoadBalancerArn",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "LoadBalancerArn",
		ColumnDefs: []types.ColumnDef{
			{ID: "name", Header: "Name", Accessors: "LoadBalancerName", Width: 250},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "type", Header: "Type", Accessors: "Type", Width: 120},
			{ID: "scheme", Header: "Scheme", Accessors: "Scheme", Width: 120},
			{ID: "state", Header: "State", Accessors: "State.Code", Width: 100, ColorMap: map[string]string{
				"active": "success", "provisioning": "warning", "failed": "danger",
			}},
			{ID: "dns", Header: "DNS Name", Accessors: "DNSName", Width: 350},
			{ID: "vpcId", Header: "VPC ID", Accessors: "VpcId", Width: 200},
			{ID: "created", Header: "Created", Accessors: "CreatedTime", Formatter: types.CellValueFormatterAge},
		},
	},
	"elbv2::v1::TargetGroup": {
		IDAccessor:        "TargetGroupArn",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "TargetGroupArn",
		ColumnDefs: []types.ColumnDef{
			{ID: "name", Header: "Name", Accessors: "TargetGroupName", Width: 250},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "protocol", Header: "Protocol", Accessors: "Protocol", Width: 100},
			{ID: "port", Header: "Port", Accessors: "Port", Width: 70},
			{ID: "targetType", Header: "Target Type", Accessors: "TargetType", Width: 120},
			{ID: "vpcId", Header: "VPC ID", Accessors: "VpcId", Width: 200},
			{ID: "healthCheck", Header: "Health Check", Accessors: "HealthCheckPath", Width: 200},
		},
	},
	"elbv2::v1::Listener": {
		IDAccessor:        "ListenerArn",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "ListenerArn",
		ColumnDefs: []types.ColumnDef{
			{ID: "arn", Header: "Listener ARN", Accessors: "ListenerArn", Width: 400},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "protocol", Header: "Protocol", Accessors: "Protocol", Width: 100},
			{ID: "port", Header: "Port", Accessors: "Port", Width: 70},
			{ID: "lbArn", Header: "Load Balancer ARN", Accessors: "LoadBalancerArn", Width: 400},
		},
	},

	// ===== Route53 =====
	"route53::v1::HostedZone": {
		IDAccessor:       "_CleanId",
		MemoizerAccessor: "_CleanId",
		ColumnDefs: []types.ColumnDef{
			{ID: "name", Header: "Domain Name", Accessors: "Name", Width: 300},
			{ID: "id", Header: "Zone ID", Accessors: "_CleanId", Width: 200},
			{ID: "records", Header: "Record Count", Accessors: "ResourceRecordSetCount", Width: 120},
			{ID: "private", Header: "Private", Accessors: "Config.PrivateZone", Width: 80},
			{ID: "comment", Header: "Comment", Accessors: "Config.Comment", Width: 300},
		},
	},
	"route53::v1::HealthCheck": {
		IDAccessor:       "Id",
		MemoizerAccessor: "Id",
		ColumnDefs: []types.ColumnDef{
			{ID: "id", Header: "Health Check ID", Accessors: "Id", Width: 300},
			{ID: "type", Header: "Type", Accessors: "HealthCheckConfig.Type", Width: 100},
			{ID: "fqdn", Header: "FQDN", Accessors: "HealthCheckConfig.FullyQualifiedDomainName", Width: 300},
			{ID: "port", Header: "Port", Accessors: "HealthCheckConfig.Port", Width: 70},
		},
	},
	"route53::v1::RecordSet": {
		IDAccessor:       "Name",
		MemoizerAccessor: "Name",
		ColumnDefs: []types.ColumnDef{
			{ID: "name", Header: "Record Name", Accessors: "Name", Width: 300},
			{ID: "type", Header: "Type", Accessors: "Type", Width: 80},
			{ID: "ttl", Header: "TTL", Accessors: "TTL", Width: 70},
			{ID: "zone", Header: "Hosted Zone", Accessors: "HostedZoneName", Width: 200},
			{ID: "zoneId", Header: "Zone ID", Accessors: "HostedZoneId", Width: 200},
		},
	},

	// ===== CloudFront =====
	"cloudfront::v1::Distribution": {
		IDAccessor:       "Id",
		MemoizerAccessor: "Id",
		ColumnDefs: []types.ColumnDef{
			{ID: "id", Header: "Distribution ID", Accessors: "Id", Width: 200},
			{ID: "domain", Header: "Domain Name", Accessors: "DomainName", Width: 300},
			{ID: "status", Header: "Status", Accessors: "Status", Width: 100, ColorMap: map[string]string{
				"Deployed": "success", "InProgress": "warning",
			}},
			{ID: "enabled", Header: "Enabled", Accessors: "Enabled", Width: 80},
			{ID: "lastModified", Header: "Last Modified", Accessors: "LastModifiedTime", Formatter: types.CellValueFormatterAge},
		},
	},
	"cloudfront::v1::CachePolicy": {
		IDAccessor:       "CachePolicy.Id",
		MemoizerAccessor: "CachePolicy.Id",
		ColumnDefs: []types.ColumnDef{
			{ID: "name", Header: "Name", Accessors: "CachePolicy.CachePolicyConfig.Name", Width: 250},
			{ID: "id", Header: "Policy ID", Accessors: "CachePolicy.Id", Width: 200},
			{ID: "lastModified", Header: "Last Modified", Accessors: "CachePolicy.LastModifiedTime", Formatter: types.CellValueFormatterAge},
		},
	},

	// ===== EFS =====
	"efs::v1::FileSystem": {
		IDAccessor:        "FileSystemId",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "FileSystemId",
		ColumnDefs: []types.ColumnDef{
			{ID: "name", Header: "Name", Accessors: "Name", Width: 200},
			{ID: "id", Header: "File System ID", Accessors: "FileSystemId", Width: 200},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "state", Header: "State", Accessors: "LifeCycleState", Width: 100, ColorMap: map[string]string{
				"available": "success", "creating": "warning", "deleting": "danger",
			}},
			{ID: "size", Header: "Size", Accessors: "SizeInBytes.Value", Formatter: types.CellValueFormatterBytes, Width: 120},
			{ID: "performance", Header: "Performance", Accessors: "PerformanceMode", Width: 130},
			{ID: "throughput", Header: "Throughput Mode", Accessors: "ThroughputMode", Width: 130},
			{ID: "encrypted", Header: "Encrypted", Accessors: "Encrypted", Width: 90},
		},
	},
	"efs::v1::AccessPoint": {
		IDAccessor:        "AccessPointId",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "AccessPointId",
		ColumnDefs: []types.ColumnDef{
			{ID: "name", Header: "Name", Accessors: "Name", Width: 200},
			{ID: "id", Header: "Access Point ID", Accessors: "AccessPointId", Width: 200},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "fsId", Header: "File System ID", Accessors: "FileSystemId", Width: 200},
			{ID: "state", Header: "State", Accessors: "LifeCycleState", Width: 100},
			{ID: "rootDir", Header: "Root Directory", Accessors: "RootDirectory.Path", Width: 200},
		},
	},
	"efs::v1::MountTarget": {
		IDAccessor:        "MountTargetId",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "MountTargetId",
		ColumnDefs: []types.ColumnDef{
			{ID: "id", Header: "Mount Target ID", Accessors: "MountTargetId", Width: 200},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "fsId", Header: "File System ID", Accessors: "FileSystemId", Width: 200},
			{ID: "subnetId", Header: "Subnet ID", Accessors: "SubnetId", Width: 200},
			{ID: "ip", Header: "IP Address", Accessors: "IpAddress", Width: 140},
			{ID: "state", Header: "State", Accessors: "LifeCycleState", Width: 100},
		},
	},

	// ===== Redshift =====
	"redshift::v1::Cluster": {
		IDAccessor:        "ClusterIdentifier",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "ClusterIdentifier",
		ColumnDefs: []types.ColumnDef{
			{ID: "id", Header: "Cluster ID", Accessors: "ClusterIdentifier", Width: 250},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "status", Header: "Status", Accessors: "ClusterStatus", Width: 100, ColorMap: map[string]string{
				"available": "success", "creating": "warning", "deleting": "danger",
			}},
			{ID: "nodeType", Header: "Node Type", Accessors: "NodeType", Width: 140},
			{ID: "nodes", Header: "Nodes", Accessors: "NumberOfNodes", Width: 70},
			{ID: "db", Header: "Database", Accessors: "DBName", Width: 150},
			{ID: "endpoint", Header: "Endpoint", Accessors: "Endpoint.Address", Width: 300},
		},
	},
	"redshift::v1::SubnetGroup": {
		IDAccessor:        "ClusterSubnetGroupName",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "ClusterSubnetGroupName",
		ColumnDefs: []types.ColumnDef{
			{ID: "name", Header: "Name", Accessors: "ClusterSubnetGroupName", Width: 250},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "vpcId", Header: "VPC ID", Accessors: "VpcId", Width: 200},
			{ID: "status", Header: "Status", Accessors: "SubnetGroupStatus", Width: 100},
			{ID: "description", Header: "Description", Accessors: "Description", Width: 300},
		},
	},

	// ===== IAM (Global) =====
	"iam::v1::User": {
		IDAccessor:       "UserName",
		MemoizerAccessor: "UserName",
		ColumnDefs: []types.ColumnDef{
			{ID: "name", Header: "User Name", Accessors: "UserName", Width: 200},
			{ID: "userId", Header: "User ID", Accessors: "UserId", Width: 200},
			{ID: "arn", Header: "ARN", Accessors: "Arn", Width: 400},
			{ID: "created", Header: "Created", Accessors: "CreateDate", Formatter: types.CellValueFormatterAge},
			{ID: "lastUsed", Header: "Last Login", Accessors: "PasswordLastUsed", Formatter: types.CellValueFormatterAge},
		},
	},
	"iam::v1::Role": {
		IDAccessor:       "RoleName",
		MemoizerAccessor: "RoleName",
		ColumnDefs: []types.ColumnDef{
			{ID: "name", Header: "Role Name", Accessors: "RoleName", Width: 250},
			{ID: "roleId", Header: "Role ID", Accessors: "RoleId", Width: 200},
			{ID: "arn", Header: "ARN", Accessors: "Arn", Width: 400},
			{ID: "description", Header: "Description", Accessors: "Description", Width: 300},
			{ID: "created", Header: "Created", Accessors: "CreateDate", Formatter: types.CellValueFormatterAge},
		},
	},
	"iam::v1::Policy": {
		IDAccessor:       "PolicyName",
		MemoizerAccessor: "PolicyName",
		ColumnDefs: []types.ColumnDef{
			{ID: "name", Header: "Policy Name", Accessors: "PolicyName", Width: 250},
			{ID: "arn", Header: "ARN", Accessors: "Arn", Width: 400},
			{ID: "description", Header: "Description", Accessors: "Description", Width: 300},
			{ID: "attachments", Header: "Attachments", Accessors: "AttachmentCount", Width: 100},
			{ID: "created", Header: "Created", Accessors: "CreateDate", Formatter: types.CellValueFormatterAge},
		},
	},
	"iam::v1::Group": {
		IDAccessor:       "GroupName",
		MemoizerAccessor: "GroupName",
		ColumnDefs: []types.ColumnDef{
			{ID: "name", Header: "Group Name", Accessors: "GroupName", Width: 250},
			{ID: "groupId", Header: "Group ID", Accessors: "GroupId", Width: 200},
			{ID: "arn", Header: "ARN", Accessors: "Arn", Width: 400},
			{ID: "created", Header: "Created", Accessors: "CreateDate", Formatter: types.CellValueFormatterAge},
		},
	},
	"iam::v1::InstanceProfile": {
		IDAccessor:       "InstanceProfileName",
		MemoizerAccessor: "InstanceProfileName",
		ColumnDefs: []types.ColumnDef{
			{ID: "name", Header: "Name", Accessors: "InstanceProfileName", Width: 250},
			{ID: "id", Header: "Profile ID", Accessors: "InstanceProfileId", Width: 200},
			{ID: "arn", Header: "ARN", Accessors: "Arn", Width: 400},
			{ID: "created", Header: "Created", Accessors: "CreateDate", Formatter: types.CellValueFormatterAge},
		},
	},

	// ===== Auto Scaling =====
	"autoscaling::v1::AutoScalingGroup": {
		IDAccessor:        "AutoScalingGroupName",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "AutoScalingGroupName",
		ColumnDefs: []types.ColumnDef{
			{ID: "name", Header: "Name", Accessors: "AutoScalingGroupName", Width: 250},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "desired", Header: "Desired", Accessors: "DesiredCapacity", Width: 80},
			{ID: "min", Header: "Min", Accessors: "MinSize", Width: 60},
			{ID: "max", Header: "Max", Accessors: "MaxSize", Width: 60},
			{ID: "instances", Header: "Instances", Accessors: "Instances", Formatter: types.CellValueFormatterCount, Width: 100},
			{ID: "healthCheck", Header: "Health Check", Accessors: "HealthCheckType", Width: 120},
			{ID: "created", Header: "Created", Accessors: "CreatedTime", Formatter: types.CellValueFormatterAge},
		},
	},
	"autoscaling::v1::LaunchConfiguration": {
		IDAccessor:        "LaunchConfigurationName",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "LaunchConfigurationName",
		ColumnDefs: []types.ColumnDef{
			{ID: "name", Header: "Name", Accessors: "LaunchConfigurationName", Width: 250},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "imageId", Header: "AMI ID", Accessors: "ImageId", Width: 200},
			{ID: "instanceType", Header: "Instance Type", Accessors: "InstanceType", Width: 140},
			{ID: "created", Header: "Created", Accessors: "CreatedTime", Formatter: types.CellValueFormatterAge},
		},
	},

	"autoscaling::v1::ScalingPolicy": {
		IDAccessor:        "PolicyName",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "PolicyName",
		ColumnDefs: []types.ColumnDef{
			{ID: "name", Header: "Policy Name", Accessors: "PolicyName", Width: 250},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "asgName", Header: "Auto Scaling Group", Accessors: "AutoScalingGroupName", Width: 250},
			{ID: "policyType", Header: "Policy Type", Accessors: "PolicyType", Width: 150},
			{ID: "adjustmentType", Header: "Adjustment Type", Accessors: "AdjustmentType", Width: 150},
			{ID: "enabled", Header: "Enabled", Accessors: "Enabled", Width: 80},
		},
	},

	// ===== CloudWatch =====
	"cloudwatch::v1::Alarm": {
		IDAccessor:        "AlarmName",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "AlarmName",
		ColumnDefs: []types.ColumnDef{
			{ID: "name", Header: "Alarm Name", Accessors: "AlarmName", Width: 250},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "state", Header: "State", Accessors: "StateValue", Width: 100, ColorMap: map[string]string{
				"OK": "success", "ALARM": "danger", "INSUFFICIENT_DATA": "warning",
			}},
			{ID: "metric", Header: "Metric", Accessors: "MetricName", Width: 200},
			{ID: "namespace", Header: "Namespace", Accessors: "Namespace", Width: 200},
			{ID: "comparison", Header: "Comparison", Accessors: "ComparisonOperator", Width: 180},
			{ID: "threshold", Header: "Threshold", Accessors: "Threshold", Width: 100},
		},
	},
	"cloudwatch::v1::LogGroup": {
		IDAccessor:        "LogGroupName",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "LogGroupName",
		ColumnDefs: []types.ColumnDef{
			{ID: "name", Header: "Log Group Name", Accessors: "LogGroupName", Width: 350},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "storedBytes", Header: "Stored Bytes", Accessors: "StoredBytes", Formatter: types.CellValueFormatterBytes, Width: 120},
			{ID: "retention", Header: "Retention (days)", Accessors: "RetentionInDays", Width: 140},
			{ID: "created", Header: "Created", Accessors: "CreationTime", Formatter: types.CellValueFormatterAge},
		},
	},

	// ===== SNS =====
	"sns::v1::Topic": {
		IDAccessor:        "TopicArn",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "TopicArn",
		ColumnDefs: []types.ColumnDef{
			{ID: "name", Header: "Topic Name", Accessors: "DisplayName,TopicArn", Width: 300},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "arn", Header: "ARN", Accessors: "TopicArn", Width: 400},
			{ID: "subscriptions", Header: "Subscriptions", Accessors: "SubscriptionsConfirmed", Width: 120},
		},
	},
	"sns::v1::Subscription": {
		IDAccessor:        "SubscriptionArn",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "SubscriptionArn",
		ColumnDefs: []types.ColumnDef{
			{ID: "arn", Header: "Subscription ARN", Accessors: "SubscriptionArn", Width: 400},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "topic", Header: "Topic ARN", Accessors: "TopicArn", Width: 400},
			{ID: "protocol", Header: "Protocol", Accessors: "Protocol", Width: 100},
			{ID: "endpoint", Header: "Endpoint", Accessors: "Endpoint", Width: 300},
		},
	},

	// ===== SQS =====
	"sqs::v1::Queue": {
		IDAccessor:        "QueueUrl",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "QueueUrl",
		ColumnDefs: []types.ColumnDef{
			{ID: "name", Header: "Queue Name", Accessors: "QueueName", Width: 300},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "url", Header: "URL", Accessors: "QueueUrl", Width: 400},
			{ID: "messages", Header: "Messages", Accessors: "ApproximateNumberOfMessages", Width: 100},
			{ID: "delayed", Header: "Delayed", Accessors: "ApproximateNumberOfMessagesDelayed", Width: 100},
			{ID: "notVisible", Header: "In Flight", Accessors: "ApproximateNumberOfMessagesNotVisible", Width: 100},
		},
	},

	// ===== DynamoDB =====
	"dynamodb::v1::Table": {
		IDAccessor:        "TableName",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "TableName",
		ColumnDefs: []types.ColumnDef{
			{ID: "name", Header: "Table Name", Accessors: "TableName", Width: 300},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "status", Header: "Status", Accessors: "TableStatus", Width: 100, ColorMap: map[string]string{
				"ACTIVE": "success", "CREATING": "warning", "DELETING": "danger",
				"UPDATING": "warning",
			}},
			{ID: "items", Header: "Item Count", Accessors: "ItemCount", Width: 100},
			{ID: "size", Header: "Size", Accessors: "TableSizeBytes", Formatter: types.CellValueFormatterBytes, Width: 120},
			{ID: "created", Header: "Created", Accessors: "CreationDateTime", Formatter: types.CellValueFormatterAge},
		},
	},

	// ===== ECS =====
	"ecs::v1::Cluster": {
		IDAccessor:        "ClusterName",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "ClusterName",
		ColumnDefs: []types.ColumnDef{
			{ID: "name", Header: "Cluster Name", Accessors: "ClusterName", Width: 250},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "status", Header: "Status", Accessors: "Status", Width: 100, ColorMap: map[string]string{
				"ACTIVE": "success", "PROVISIONING": "warning", "DEPROVISIONING": "warning",
				"FAILED": "danger", "INACTIVE": "danger",
			}},
			{ID: "activeServices", Header: "Active Services", Accessors: "ActiveServicesCount", Width: 130},
			{ID: "runningTasks", Header: "Running Tasks", Accessors: "RunningTasksCount", Width: 120},
			{ID: "containerInstances", Header: "Container Instances", Accessors: "RegisteredContainerInstancesCount", Width: 160},
		},
	},
	"ecs::v1::Service": {
		IDAccessor:        "ServiceName",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "ServiceName",
		ColumnDefs: []types.ColumnDef{
			{ID: "name", Header: "Service Name", Accessors: "ServiceName", Width: 250},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "status", Header: "Status", Accessors: "Status", Width: 100, ColorMap: map[string]string{
				"ACTIVE": "success", "DRAINING": "warning", "INACTIVE": "danger",
			}},
			{ID: "desired", Header: "Desired", Accessors: "DesiredCount", Width: 80},
			{ID: "running", Header: "Running", Accessors: "RunningCount", Width: 80},
			{ID: "launchType", Header: "Launch Type", Accessors: "LaunchType", Width: 120},
			{ID: "cluster", Header: "Cluster", Accessors: "ClusterArn", Width: 300},
		},
	},
	"ecs::v1::Task": {
		IDAccessor:        "TaskArn",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "TaskArn",
		ColumnDefs: []types.ColumnDef{
			{ID: "arn", Header: "Task ARN", Accessors: "TaskArn", Width: 400},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "lastStatus", Header: "Last Status", Accessors: "LastStatus", Width: 100, ColorMap: map[string]string{
				"RUNNING": "success", "PENDING": "warning", "STOPPED": "danger",
				"PROVISIONING": "warning", "DEPROVISIONING": "warning",
			}},
			{ID: "launchType", Header: "Launch Type", Accessors: "LaunchType", Width: 120},
			{ID: "cpu", Header: "CPU", Accessors: "Cpu", Width: 70},
			{ID: "memory", Header: "Memory", Accessors: "Memory", Width: 80},
			{ID: "cluster", Header: "Cluster", Accessors: "ClusterArn", Width: 300},
		},
	},
	"ecs::v1::TaskDefinition": {
		IDAccessor:        "TaskDefinitionArn",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "TaskDefinitionArn",
		ColumnDefs: []types.ColumnDef{
			{ID: "arn", Header: "Task Definition ARN", Accessors: "TaskDefinitionArn", Width: 400},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "status", Header: "Status", Accessors: "Status", Width: 100, ColorMap: map[string]string{
				"ACTIVE": "success", "INACTIVE": "danger",
			}},
			{ID: "family", Header: "Family", Accessors: "Family", Width: 200},
			{ID: "revision", Header: "Revision", Accessors: "Revision", Width: 80},
			{ID: "networkMode", Header: "Network Mode", Accessors: "NetworkMode", Width: 120},
			{ID: "cpu", Header: "CPU", Accessors: "Cpu", Width: 70},
			{ID: "memory", Header: "Memory", Accessors: "Memory", Width: 80},
		},
	},
	"ecs::v1::ContainerInstance": {
		IDAccessor:        "ContainerInstanceArn",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "ContainerInstanceArn",
		ColumnDefs: []types.ColumnDef{
			{ID: "arn", Header: "Container Instance ARN", Accessors: "ContainerInstanceArn", Width: 400},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "status", Header: "Status", Accessors: "Status", Width: 100, ColorMap: map[string]string{
				"ACTIVE": "success", "DRAINING": "warning", "REGISTERING": "warning",
				"DEREGISTERING": "warning", "REGISTRATION_FAILED": "danger",
			}},
			{ID: "runningTasks", Header: "Running Tasks", Accessors: "RunningTasksCount", Width: 120},
			{ID: "agentConnected", Header: "Agent Connected", Accessors: "AgentConnected", Width: 130},
			{ID: "ec2Instance", Header: "EC2 Instance", Accessors: "Ec2InstanceId", Width: 180},
		},
	},

	// ===== KMS =====
	"kms::v1::Key": {
		IDAccessor:        "KeyId",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "KeyId",
		ColumnDefs: []types.ColumnDef{
			{ID: "id", Header: "Key ID", Accessors: "KeyId", Width: 300},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "state", Header: "State", Accessors: "KeyState", Width: 120, ColorMap: map[string]string{
				"Enabled": "success", "Disabled": "danger", "PendingDeletion": "danger",
				"PendingImport": "warning", "PendingReplicaDeletion": "warning",
			}},
			{ID: "usage", Header: "Usage", Accessors: "KeyUsage", Width: 150},
			{ID: "spec", Header: "Key Spec", Accessors: "KeySpec", Width: 150},
			{ID: "description", Header: "Description", Accessors: "Description", Width: 300},
			{ID: "created", Header: "Created", Accessors: "CreationDate", Formatter: types.CellValueFormatterAge},
		},
	},
	"kms::v1::Alias": {
		IDAccessor:        "AliasName",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "AliasName",
		ColumnDefs: []types.ColumnDef{
			{ID: "name", Header: "Alias Name", Accessors: "AliasName", Width: 300},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "arn", Header: "Alias ARN", Accessors: "AliasArn", Width: 400},
			{ID: "targetKeyId", Header: "Target Key ID", Accessors: "TargetKeyId", Width: 300},
			{ID: "created", Header: "Created", Accessors: "CreationDate", Formatter: types.CellValueFormatterAge},
		},
	},

	// ===== Secrets Manager =====
	"secretsmanager::v1::Secret": {
		IDAccessor:        "Name",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "Name",
		ColumnDefs: []types.ColumnDef{
			{ID: "name", Header: "Secret Name", Accessors: "Name", Width: 300},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "description", Header: "Description", Accessors: "Description", Width: 300},
			{ID: "lastChanged", Header: "Last Changed", Accessors: "LastChangedDate", Formatter: types.CellValueFormatterAge},
			{ID: "lastRotated", Header: "Last Rotated", Accessors: "LastRotatedDate", Formatter: types.CellValueFormatterAge},
			{ID: "rotationEnabled", Header: "Rotation", Accessors: "RotationEnabled", Width: 90},
		},
	},

	// ===== ACM =====
	"acm::v1::Certificate": {
		IDAccessor:        "CertificateArn",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "CertificateArn",
		ColumnDefs: []types.ColumnDef{
			{ID: "domain", Header: "Domain Name", Accessors: "DomainName", Width: 300},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "status", Header: "Status", Accessors: "Status", Width: 120, ColorMap: map[string]string{
				"ISSUED": "success", "PENDING_VALIDATION": "warning", "INACTIVE": "neutral",
				"EXPIRED": "danger", "FAILED": "danger", "REVOKED": "danger",
			}},
			{ID: "type", Header: "Type", Accessors: "Type", Width: 120},
			{ID: "arn", Header: "Certificate ARN", Accessors: "CertificateArn", Width: 400},
			{ID: "notAfter", Header: "Expires", Accessors: "NotAfter", Formatter: types.CellValueFormatterAge},
		},
	},

	// ===== CloudFormation =====
	"cloudformation::v1::Stack": {
		IDAccessor:        "StackName",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "StackName",
		ColumnDefs: []types.ColumnDef{
			{ID: "name", Header: "Stack Name", Accessors: "StackName", Width: 300},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "status", Header: "Status", Accessors: "StackStatus", Width: 180, ColorMap: map[string]string{
				"CREATE_COMPLETE":          "success",
				"UPDATE_COMPLETE":          "success",
				"DELETE_COMPLETE":          "neutral",
				"CREATE_IN_PROGRESS":       "warning",
				"UPDATE_IN_PROGRESS":       "warning",
				"DELETE_IN_PROGRESS":       "warning",
				"ROLLBACK_IN_PROGRESS":     "warning",
				"CREATE_FAILED":            "danger",
				"DELETE_FAILED":            "danger",
				"UPDATE_FAILED":            "danger",
				"ROLLBACK_COMPLETE":        "danger",
				"ROLLBACK_FAILED":          "danger",
				"UPDATE_ROLLBACK_COMPLETE": "danger",
			}},
			{ID: "description", Header: "Description", Accessors: "Description", Width: 300},
			{ID: "created", Header: "Created", Accessors: "CreationTime", Formatter: types.CellValueFormatterAge},
			{ID: "updated", Header: "Updated", Accessors: "LastUpdatedTime", Formatter: types.CellValueFormatterAge},
		},
	},
	"cloudformation::v1::StackSet": {
		IDAccessor:        "StackSetName",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "StackSetName",
		ColumnDefs: []types.ColumnDef{
			{ID: "name", Header: "Stack Set Name", Accessors: "StackSetName", Width: 300},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "status", Header: "Status", Accessors: "Status", Width: 100, ColorMap: map[string]string{
				"ACTIVE": "success", "DELETED": "danger",
			}},
			{ID: "permissionModel", Header: "Permission Model", Accessors: "PermissionModel", Width: 150},
			{ID: "description", Header: "Description", Accessors: "Description", Width: 300},
		},
	},

	// ===== API Gateway =====
	"apigateway::v1::HttpApi": {
		IDAccessor:        "ApiId",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "ApiId",
		ColumnDefs: []types.ColumnDef{
			{ID: "name", Header: "API Name", Accessors: "Name", Width: 250},
			{ID: "id", Header: "API ID", Accessors: "ApiId", Width: 150},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "protocol", Header: "Protocol", Accessors: "ProtocolType", Width: 100},
			{ID: "endpoint", Header: "Endpoint", Accessors: "ApiEndpoint", Width: 350},
			{ID: "description", Header: "Description", Accessors: "Description", Width: 300},
			{ID: "created", Header: "Created", Accessors: "CreatedDate", Formatter: types.CellValueFormatterAge},
		},
	},
	"apigateway::v1::Stage": {
		IDAccessor:        "StageName",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "StageName",
		ColumnDefs: []types.ColumnDef{
			{ID: "name", Header: "Stage Name", Accessors: "StageName", Width: 200},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "apiId", Header: "API ID", Accessors: "ApiId", Width: 150},
			{ID: "autoDeploy", Header: "Auto Deploy", Accessors: "AutoDeploy", Width: 100},
			{ID: "deploymentId", Header: "Deployment ID", Accessors: "DeploymentId", Width: 200},
			{ID: "created", Header: "Created", Accessors: "CreatedDate", Formatter: types.CellValueFormatterAge},
		},
	},
	"apigateway::v1::DomainName": {
		IDAccessor:        "DomainName",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "DomainName",
		ColumnDefs: []types.ColumnDef{
			{ID: "name", Header: "Domain Name", Accessors: "DomainName", Width: 300},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
		},
	},

	// ===== ECR =====
	"ecr::v1::Repository": {
		IDAccessor:        "RepositoryName",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "RepositoryName",
		ColumnDefs: []types.ColumnDef{
			{ID: "name", Header: "Repository Name", Accessors: "RepositoryName", Width: 300},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "uri", Header: "Repository URI", Accessors: "RepositoryUri", Width: 400},
			{ID: "tagMutability", Header: "Tag Mutability", Accessors: "ImageTagMutability", Width: 130},
			{ID: "scanOnPush", Header: "Scan on Push", Accessors: "ImageScanningConfiguration.ScanOnPush", Width: 120},
			{ID: "encryption", Header: "Encryption", Accessors: "EncryptionConfiguration.EncryptionType", Width: 120},
			{ID: "created", Header: "Created", Accessors: "CreatedAt", Formatter: types.CellValueFormatterAge},
		},
	},

	// ===== CloudWatch Dashboard (sub-resource) =====
	"cloudwatch::v1::Dashboard": {
		IDAccessor:        "DashboardName",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "DashboardName",
		ColumnDefs: []types.ColumnDef{
			{ID: "name", Header: "Dashboard Name", Accessors: "DashboardName", Width: 300},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "arn", Header: "Dashboard ARN", Accessors: "DashboardArn", Width: 400},
			{ID: "lastModified", Header: "Last Modified", Accessors: "LastModified", Formatter: types.CellValueFormatterAge},
			{ID: "size", Header: "Size", Accessors: "Size", Width: 80},
		},
	},

	// ===== VPC Flow Log (sub-resource) =====
	"vpc::v1::FlowLog": {
		IDAccessor:        "FlowLogId",
		NamespaceAccessor: "Region",
		MemoizerAccessor:  "FlowLogId",
		ColumnDefs: []types.ColumnDef{
			{ID: "name", Header: "Name", Accessors: "_Name", Width: 200},
			{ID: "id", Header: "Flow Log ID", Accessors: "FlowLogId", Width: 200},
			{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
			{ID: "status", Header: "Status", Accessors: "FlowLogStatus", Width: 100, ColorMap: map[string]string{
				"ACTIVE": "success",
			}},
			{ID: "resourceId", Header: "Resource ID", Accessors: "ResourceId", Width: 200},
			{ID: "trafficType", Header: "Traffic Type", Accessors: "TrafficType", Width: 100},
			{ID: "logDestinationType", Header: "Destination Type", Accessors: "LogDestinationType", Width: 150},
		},
	},
}

// DefaultResourceDef is the fallback definition for any resource type without a specific definition.
//
//nolint:gochecknoglobals // default definition
var DefaultResourceDef = types.ResourceDefinition{
	IDAccessor:        "Id",
	NamespaceAccessor: "Region",
	MemoizerAccessor:  "Id",
	ColumnDefs: []types.ColumnDef{
		{ID: "id", Header: "ID", Accessors: "Id"},
		{ID: "region", Header: "Region", Accessors: "Region", Width: 130},
	},
}
