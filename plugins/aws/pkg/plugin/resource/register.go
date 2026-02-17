package resource

import (
	"github.com/omniviewdev/aws-plugin/pkg/plugin/resource/clients"
	"github.com/omniviewdev/aws-plugin/pkg/plugin/resource/resourcers"
	"github.com/omniviewdev/plugin-sdk/pkg/resource/types"
	"github.com/omniviewdev/plugin-sdk/pkg/sdk"
)

// Register registers the resource plugin with the plugin server.
//
//nolint:funlen // registration of all AWS resources
func Register(plugin *sdk.Plugin) {
	sdk.RegisterResourcePlugin(
		plugin,
		sdk.ResourcePluginOpts[clients.Client]{
			CreateClient:                 clients.CreateClient,
			LoadConnectionFunc:           LoadConnectionsFunc,
			LoadConnectionNamespacesFunc: LoadConnectionNamespacesFunc,
			CheckConnectionFunc:          CheckConnectionFunc,
			ResourceGroups:               ResourceGroups,
			ResourceDefinitions:          resourcers.ResourceDefs,
			DefaultResourceDefinition:    resourcers.DefaultResourceDef,
			Resourcers: map[types.ResourceMeta]types.Resourcer[clients.Client]{
				// ===== EC2 =====
				{Group: "ec2", Version: "v1", Kind: "Instance", Description: "Amazon EC2 virtual server instances"}: resourcers.NewRegionalResourcer(resourcers.ListEC2Instances, resourcers.GetEC2Instance),
				{Group: "ec2", Version: "v1", Kind: "Image", Description: "Amazon Machine Images (AMIs)"}: resourcers.NewRegionalResourcer(resourcers.ListEC2Images, resourcers.GetEC2Image),
				{Group: "ec2", Version: "v1", Kind: "KeyPair", Description: "SSH key pairs for EC2 instances"}: resourcers.NewRegionalResourcer(resourcers.ListEC2KeyPairs, resourcers.GetEC2KeyPair),
				{Group: "ec2", Version: "v1", Kind: "LaunchTemplate", Description: "EC2 launch templates for instance configuration"}: resourcers.NewRegionalResourcer(resourcers.ListEC2LaunchTemplates, resourcers.GetEC2LaunchTemplate),
				{Group: "ec2", Version: "v1", Kind: "Volume", Description: "Amazon EBS volumes"}: resourcers.NewRegionalResourcer(resourcers.ListEC2Volumes, resourcers.GetEC2Volume),
				{Group: "ec2", Version: "v1", Kind: "Snapshot", Description: "Amazon EBS volume snapshots"}: resourcers.NewRegionalResourcer(resourcers.ListEC2Snapshots, resourcers.GetEC2Snapshot),
				{Group: "ec2", Version: "v1", Kind: "ElasticIP", Description: "Elastic IP addresses"}: resourcers.NewRegionalResourcer(resourcers.ListEC2Addresses, resourcers.GetEC2Address),
				{Group: "ec2", Version: "v1", Kind: "PlacementGroup", Description: "EC2 placement groups for instance placement strategy"}: resourcers.NewRegionalResourcer(resourcers.ListEC2PlacementGroups, resourcers.GetEC2PlacementGroup),

				// ===== VPC =====
				{Group: "vpc", Version: "v1", Kind: "VPC", Description: "Amazon Virtual Private Clouds"}: resourcers.NewRegionalResourcer(resourcers.ListVPCs, resourcers.GetVPC),
				{Group: "vpc", Version: "v1", Kind: "Subnet", Description: "VPC subnets"}: resourcers.NewRegionalResourcer(resourcers.ListSubnets, resourcers.GetSubnet),
				{Group: "vpc", Version: "v1", Kind: "SecurityGroup", Description: "VPC security groups (firewalls)"}: resourcers.NewRegionalResourcer(resourcers.ListSecurityGroups, resourcers.GetSecurityGroup),
				{Group: "vpc", Version: "v1", Kind: "InternetGateway", Description: "Internet gateways for VPC internet access"}: resourcers.NewRegionalResourcer(resourcers.ListInternetGateways, resourcers.GetInternetGateway),
				{Group: "vpc", Version: "v1", Kind: "NATGateway", Description: "NAT gateways for outbound internet access"}: resourcers.NewRegionalResourcer(resourcers.ListNATGateways, resourcers.GetNATGateway),
				{Group: "vpc", Version: "v1", Kind: "RouteTable", Description: "VPC route tables"}: resourcers.NewRegionalResourcer(resourcers.ListRouteTables, resourcers.GetRouteTable),
				{Group: "vpc", Version: "v1", Kind: "NetworkACL", Description: "Network access control lists"}: resourcers.NewRegionalResourcer(resourcers.ListNetworkACLs, resourcers.GetNetworkACL),
				{Group: "vpc", Version: "v1", Kind: "NetworkInterface", Description: "Elastic network interfaces"}: resourcers.NewRegionalResourcer(resourcers.ListNetworkInterfaces, resourcers.GetNetworkInterface),
				{Group: "vpc", Version: "v1", Kind: "VPCEndpoint", Description: "VPC endpoints for AWS service access"}: resourcers.NewRegionalResourcer(resourcers.ListVPCEndpoints, resourcers.GetVPCEndpoint),
				{Group: "vpc", Version: "v1", Kind: "VPCPeeringConnection", Description: "VPC peering connections"}: resourcers.NewRegionalResourcer(resourcers.ListVPCPeeringConnections, resourcers.GetVPCPeeringConnection),
				{Group: "vpc", Version: "v1", Kind: "TransitGateway", Description: "Transit gateways for network hub connectivity"}: resourcers.NewRegionalResourcer(resourcers.ListTransitGateways, resourcers.GetTransitGateway),
				{Group: "vpc", Version: "v1", Kind: "FlowLog", Description: "VPC flow logs"}: resourcers.NewRegionalResourcer(resourcers.ListFlowLogs, resourcers.GetFlowLog),
				{Group: "vpc", Version: "v1", Kind: "DHCPOptionsSet", Description: "VPC DHCP options sets"}: resourcers.NewRegionalResourcer(resourcers.ListDHCPOptionsSets, resourcers.GetDHCPOptionsSet),

				// ===== EKS =====
				{Group: "eks", Version: "v1", Kind: "Cluster", Description: "Amazon EKS Kubernetes clusters"}: resourcers.NewRegionalResourcer(resourcers.ListEKSClusters, resourcers.GetEKSCluster),
				{Group: "eks", Version: "v1", Kind: "Nodegroup", Description: "EKS managed node groups"}: resourcers.NewRegionalResourcer(resourcers.ListEKSNodegroups, resourcers.GetEKSNodegroup),
				{Group: "eks", Version: "v1", Kind: "Addon", Description: "EKS cluster add-ons"}: resourcers.NewRegionalResourcer(resourcers.ListEKSAddons, resourcers.GetEKSAddon),

				// ===== S3 (Global) =====
				{Group: "s3", Version: "v1", Kind: "Bucket", Description: "Amazon S3 storage buckets"}: resourcers.NewGlobalResourcer(resourcers.ListS3Buckets, resourcers.GetS3Bucket),

				// ===== RDS =====
				{Group: "rds", Version: "v1", Kind: "DBInstance", Description: "Amazon RDS database instances"}: resourcers.NewRegionalResourcer(resourcers.ListRDSInstances, resourcers.GetRDSInstance),
				{Group: "rds", Version: "v1", Kind: "DBCluster", Description: "Amazon RDS Aurora database clusters"}: resourcers.NewRegionalResourcer(resourcers.ListRDSClusters, resourcers.GetRDSCluster),
				{Group: "rds", Version: "v1", Kind: "DBSubnetGroup", Description: "RDS database subnet groups"}: resourcers.NewRegionalResourcer(resourcers.ListRDSSubnetGroups, resourcers.GetRDSSubnetGroup),
				{Group: "rds", Version: "v1", Kind: "DBSnapshot", Description: "RDS database snapshots"}: resourcers.NewRegionalResourcer(resourcers.ListRDSSnapshots, resourcers.GetRDSSnapshot),
				{Group: "rds", Version: "v1", Kind: "DBParameterGroup", Description: "RDS database parameter groups"}: resourcers.NewRegionalResourcer(resourcers.ListRDSParameterGroups, resourcers.GetRDSParameterGroup),

				// ===== ElastiCache =====
				{Group: "elasticache", Version: "v1", Kind: "CacheCluster", Description: "Amazon ElastiCache clusters"}: resourcers.NewRegionalResourcer(resourcers.ListElastiCacheClusters, resourcers.GetElastiCacheCluster),
				{Group: "elasticache", Version: "v1", Kind: "ReplicationGroup", Description: "ElastiCache Redis replication groups"}: resourcers.NewRegionalResourcer(resourcers.ListElastiCacheReplicationGroups, resourcers.GetElastiCacheReplicationGroup),
				{Group: "elasticache", Version: "v1", Kind: "CacheSubnetGroup", Description: "ElastiCache subnet groups"}: resourcers.NewRegionalResourcer(resourcers.ListElastiCacheSubnetGroups, resourcers.GetElastiCacheSubnetGroup),

				// ===== Lambda =====
				{Group: "lambda", Version: "v1", Kind: "Function", Description: "AWS Lambda serverless functions"}: resourcers.NewRegionalResourcer(resourcers.ListLambdaFunctions, resourcers.GetLambdaFunction),
				{Group: "lambda", Version: "v1", Kind: "Layer", Description: "Lambda function layers"}: resourcers.NewRegionalResourcer(resourcers.ListLambdaLayers, resourcers.GetLambdaLayer),
				{Group: "lambda", Version: "v1", Kind: "EventSourceMapping", Description: "Lambda event source mappings"}: resourcers.NewRegionalResourcer(resourcers.ListLambdaEventSourceMappings, resourcers.GetLambdaEventSourceMapping),

				// ===== ELB =====
				{Group: "elbv2", Version: "v1", Kind: "LoadBalancer", Description: "Application and Network Load Balancers"}: resourcers.NewRegionalResourcer(resourcers.ListLoadBalancers, resourcers.GetLoadBalancer),
				{Group: "elbv2", Version: "v1", Kind: "TargetGroup", Description: "Load balancer target groups"}: resourcers.NewRegionalResourcer(resourcers.ListTargetGroups, resourcers.GetTargetGroup),
				{Group: "elbv2", Version: "v1", Kind: "Listener", Description: "Load balancer listeners"}: resourcers.NewRegionalResourcer(resourcers.ListListeners, resourcers.GetListener),

				// ===== Route53 (Global) =====
				{Group: "route53", Version: "v1", Kind: "HostedZone", Description: "Route 53 DNS hosted zones"}: resourcers.NewGlobalResourcer(resourcers.ListRoute53HostedZones, resourcers.GetRoute53HostedZone),
				{Group: "route53", Version: "v1", Kind: "HealthCheck", Description: "Route 53 health checks"}: resourcers.NewGlobalResourcer(resourcers.ListRoute53HealthChecks, resourcers.GetRoute53HealthCheck),
				{Group: "route53", Version: "v1", Kind: "RecordSet", Description: "Route 53 DNS record sets"}: resourcers.NewGlobalResourcer(resourcers.ListRoute53RecordSets, resourcers.GetRoute53RecordSet),

				// ===== CloudFront (Global) =====
				{Group: "cloudfront", Version: "v1", Kind: "Distribution", Description: "CloudFront CDN distributions"}: resourcers.NewGlobalResourcer(resourcers.ListCloudFrontDistributions, resourcers.GetCloudFrontDistribution),
				{Group: "cloudfront", Version: "v1", Kind: "CachePolicy", Description: "CloudFront cache policies"}: resourcers.NewGlobalResourcer(resourcers.ListCloudFrontCachePolicies, resourcers.GetCloudFrontCachePolicy),

				// ===== EFS =====
				{Group: "efs", Version: "v1", Kind: "FileSystem", Description: "Amazon EFS file systems"}: resourcers.NewRegionalResourcer(resourcers.ListEFSFileSystems, resourcers.GetEFSFileSystem),
				{Group: "efs", Version: "v1", Kind: "AccessPoint", Description: "EFS access points"}: resourcers.NewRegionalResourcer(resourcers.ListEFSAccessPoints, resourcers.GetEFSAccessPoint),
				{Group: "efs", Version: "v1", Kind: "MountTarget", Description: "EFS mount targets"}: resourcers.NewRegionalResourcer(resourcers.ListEFSMountTargets, resourcers.GetEFSMountTarget),

				// ===== Redshift =====
				{Group: "redshift", Version: "v1", Kind: "Cluster", Description: "Amazon Redshift data warehouse clusters"}: resourcers.NewRegionalResourcer(resourcers.ListRedshiftClusters, resourcers.GetRedshiftCluster),
				{Group: "redshift", Version: "v1", Kind: "SubnetGroup", Description: "Redshift cluster subnet groups"}: resourcers.NewRegionalResourcer(resourcers.ListRedshiftSubnetGroups, resourcers.GetRedshiftSubnetGroup),

				// ===== IAM (Global) =====
				{Group: "iam", Version: "v1", Kind: "User", Description: "IAM users"}: resourcers.NewGlobalResourcer(resourcers.ListIAMUsers, resourcers.GetIAMUser),
				{Group: "iam", Version: "v1", Kind: "Role", Description: "IAM roles"}: resourcers.NewGlobalResourcer(resourcers.ListIAMRoles, resourcers.GetIAMRole),
				{Group: "iam", Version: "v1", Kind: "Policy", Description: "IAM policies"}: resourcers.NewGlobalResourcer(resourcers.ListIAMPolicies, resourcers.GetIAMPolicy),
				{Group: "iam", Version: "v1", Kind: "Group", Description: "IAM groups"}: resourcers.NewGlobalResourcer(resourcers.ListIAMGroups, resourcers.GetIAMGroup),
				{Group: "iam", Version: "v1", Kind: "InstanceProfile", Description: "IAM instance profiles for EC2"}: resourcers.NewGlobalResourcer(resourcers.ListIAMInstanceProfiles, resourcers.GetIAMInstanceProfile),

				// ===== Auto Scaling =====
				{Group: "autoscaling", Version: "v1", Kind: "AutoScalingGroup", Description: "EC2 Auto Scaling groups"}: resourcers.NewRegionalResourcer(resourcers.ListAutoScalingGroups, resourcers.GetAutoScalingGroup),
				{Group: "autoscaling", Version: "v1", Kind: "LaunchConfiguration", Description: "Auto Scaling launch configurations"}: resourcers.NewRegionalResourcer(resourcers.ListLaunchConfigurations, resourcers.GetLaunchConfiguration),
				{Group: "autoscaling", Version: "v1", Kind: "ScalingPolicy", Description: "Auto Scaling scaling policies"}: resourcers.NewRegionalResourcer(resourcers.ListScalingPolicies, resourcers.GetScalingPolicy),

				// ===== CloudWatch =====
				{Group: "cloudwatch", Version: "v1", Kind: "Alarm", Description: "CloudWatch metric alarms"}: resourcers.NewRegionalResourcer(resourcers.ListCloudWatchAlarms, resourcers.GetCloudWatchAlarm),
				{Group: "cloudwatch", Version: "v1", Kind: "LogGroup", Description: "CloudWatch log groups"}: resourcers.NewRegionalResourcer(resourcers.ListCloudWatchLogGroups, resourcers.GetCloudWatchLogGroup),
				{Group: "cloudwatch", Version: "v1", Kind: "Dashboard", Description: "CloudWatch dashboards"}: resourcers.NewRegionalResourcer(resourcers.ListCloudWatchDashboards, resourcers.GetCloudWatchDashboard),

				// ===== SNS =====
				{Group: "sns", Version: "v1", Kind: "Topic", Description: "SNS notification topics"}: resourcers.NewRegionalResourcer(resourcers.ListSNSTopics, resourcers.GetSNSTopic),
				{Group: "sns", Version: "v1", Kind: "Subscription", Description: "SNS topic subscriptions"}: resourcers.NewRegionalResourcer(resourcers.ListSNSSubscriptions, resourcers.GetSNSSubscription),

				// ===== SQS =====
				{Group: "sqs", Version: "v1", Kind: "Queue", Description: "SQS message queues"}: resourcers.NewRegionalResourcer(resourcers.ListSQSQueues, resourcers.GetSQSQueue),

				// ===== DynamoDB =====
				{Group: "dynamodb", Version: "v1", Kind: "Table", Description: "DynamoDB NoSQL tables"}: resourcers.NewRegionalResourcer(resourcers.ListDynamoDBTables, resourcers.GetDynamoDBTable),

				// ===== ECS =====
				{Group: "ecs", Version: "v1", Kind: "Cluster", Description: "ECS container clusters"}:           resourcers.NewRegionalResourcer(resourcers.ListECSClusters, resourcers.GetECSCluster),
				{Group: "ecs", Version: "v1", Kind: "Service", Description: "ECS services"}:                     resourcers.NewRegionalResourcer(resourcers.ListECSServices, resourcers.GetECSService),
				{Group: "ecs", Version: "v1", Kind: "Task", Description: "ECS running tasks"}:                   resourcers.NewRegionalResourcer(resourcers.ListECSTasks, resourcers.GetECSTask),
				{Group: "ecs", Version: "v1", Kind: "TaskDefinition", Description: "ECS task definitions"}:      resourcers.NewRegionalResourcer(resourcers.ListECSTaskDefinitions, resourcers.GetECSTaskDefinition),
				{Group: "ecs", Version: "v1", Kind: "ContainerInstance", Description: "ECS container instances"}: resourcers.NewRegionalResourcer(resourcers.ListECSContainerInstances, resourcers.GetECSContainerInstance),

				// ===== KMS =====
				{Group: "kms", Version: "v1", Kind: "Key", Description: "KMS encryption keys"}:  resourcers.NewRegionalResourcer(resourcers.ListKMSKeys, resourcers.GetKMSKey),
				{Group: "kms", Version: "v1", Kind: "Alias", Description: "KMS key aliases"}:    resourcers.NewRegionalResourcer(resourcers.ListKMSAliases, resourcers.GetKMSAlias),

				// ===== Secrets Manager =====
				{Group: "secretsmanager", Version: "v1", Kind: "Secret", Description: "Secrets Manager secrets"}: resourcers.NewRegionalResourcer(resourcers.ListSecrets, resourcers.GetSecret),

				// ===== ACM =====
				{Group: "acm", Version: "v1", Kind: "Certificate", Description: "ACM SSL/TLS certificates"}: resourcers.NewRegionalResourcer(resourcers.ListACMCertificates, resourcers.GetACMCertificate),

				// ===== CloudFormation =====
				{Group: "cloudformation", Version: "v1", Kind: "Stack", Description: "CloudFormation stacks"}:       resourcers.NewRegionalResourcer(resourcers.ListCloudFormationStacks, resourcers.GetCloudFormationStack),
				{Group: "cloudformation", Version: "v1", Kind: "StackSet", Description: "CloudFormation stack sets"}: resourcers.NewRegionalResourcer(resourcers.ListCloudFormationStackSets, resourcers.GetCloudFormationStackSet),

				// ===== API Gateway =====
				{Group: "apigateway", Version: "v1", Kind: "HttpApi", Description: "API Gateway HTTP APIs"}:       resourcers.NewRegionalResourcer(resourcers.ListAPIGatewayAPIs, resourcers.GetAPIGatewayAPI),
				{Group: "apigateway", Version: "v1", Kind: "Stage", Description: "API Gateway stages"}:            resourcers.NewRegionalResourcer(resourcers.ListAPIGatewayStages, resourcers.GetAPIGatewayStage),
				{Group: "apigateway", Version: "v1", Kind: "DomainName", Description: "API Gateway domain names"}: resourcers.NewRegionalResourcer(resourcers.ListAPIGatewayDomainNames, resourcers.GetAPIGatewayDomainName),

				// ===== ECR =====
				{Group: "ecr", Version: "v1", Kind: "Repository", Description: "ECR container image repositories"}: resourcers.NewRegionalResourcer(resourcers.ListECRRepositories, resourcers.GetECRRepository),
			},
		},
	)
}
