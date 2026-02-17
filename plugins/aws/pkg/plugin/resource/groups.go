package resource

import "github.com/omniviewdev/plugin-sdk/pkg/resource/types"

//nolint:gochecknoglobals // resource groups definition
var ResourceGroups = []types.ResourceGroup{
	{
		ID:          "ec2",
		Name:        "EC2",
		Description: "Elastic Compute Cloud",
		Icon:        "LuServer",
	},
	{
		ID:          "vpc",
		Name:        "VPC",
		Description: "Virtual Private Cloud",
		Icon:        "LuNetwork",
	},
	{
		ID:          "eks",
		Name:        "EKS",
		Description: "Elastic Kubernetes Service",
		Icon:        "LuContainer",
	},
	{
		ID:          "s3",
		Name:        "S3",
		Description: "Simple Storage Service",
		Icon:        "LuArchive",
	},
	{
		ID:          "rds",
		Name:        "RDS",
		Description: "Relational Database Service",
		Icon:        "LuDatabase",
	},
	{
		ID:          "dynamodb",
		Name:        "DynamoDB",
		Description: "DynamoDB NoSQL Database",
		Icon:        "LuTable",
	},
	{
		ID:          "elasticache",
		Name:        "ElastiCache",
		Description: "ElastiCache In-Memory Store",
		Icon:        "LuMemoryStick",
	},
	{
		ID:          "lambda",
		Name:        "Lambda",
		Description: "Serverless Functions",
		Icon:        "LuZap",
	},
	{
		ID:          "elbv2",
		Name:        "ELB",
		Description: "Elastic Load Balancing",
		Icon:        "LuScale",
	},
	{
		ID:          "route53",
		Name:        "Route 53",
		Description: "DNS & Domain Management",
		Icon:        "LuGlobe",
	},
	{
		ID:          "cloudfront",
		Name:        "CloudFront",
		Description: "Content Delivery Network",
		Icon:        "LuCloud",
	},
	{
		ID:          "efs",
		Name:        "EFS",
		Description: "Elastic File System",
		Icon:        "LuFolderOpen",
	},
	{
		ID:          "redshift",
		Name:        "Redshift",
		Description: "Data Warehouse",
		Icon:        "LuWarehouse",
	},
	{
		ID:          "iam",
		Name:        "IAM",
		Description: "Identity & Access Management",
		Icon:        "LuShield",
	},
	{
		ID:          "autoscaling",
		Name:        "Auto Scaling",
		Description: "Auto Scaling Groups",
		Icon:        "LuGauge",
	},
	{
		ID:          "cloudwatch",
		Name:        "CloudWatch",
		Description: "Monitoring & Observability",
		Icon:        "LuActivity",
	},
	{
		ID:          "sns",
		Name:        "SNS",
		Description: "Simple Notification Service",
		Icon:        "LuBell",
	},
	{
		ID:          "sqs",
		Name:        "SQS",
		Description: "Simple Queue Service",
		Icon:        "LuList",
	},
	{
		ID:          "ecs",
		Name:        "ECS",
		Description: "Elastic Container Service",
		Icon:        "LuContainer",
	},
	{
		ID:          "kms",
		Name:        "KMS",
		Description: "Key Management Service",
		Icon:        "LuKeyRound",
	},
	{
		ID:          "secretsmanager",
		Name:        "Secrets Manager",
		Description: "AWS Secrets Manager",
		Icon:        "LuLock",
	},
	{
		ID:          "acm",
		Name:        "ACM",
		Description: "AWS Certificate Manager",
		Icon:        "LuShieldCheck",
	},
	{
		ID:          "cloudformation",
		Name:        "CloudFormation",
		Description: "Infrastructure as Code",
		Icon:        "LuLayers",
	},
	{
		ID:          "apigateway",
		Name:        "API Gateway",
		Description: "API Gateway v2",
		Icon:        "LuPlug",
	},
	{
		ID:          "ecr",
		Name:        "ECR",
		Description: "Elastic Container Registry",
		Icon:        "LuPackage",
	},
}
