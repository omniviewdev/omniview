module github.com/omniviewdev/aws-plugin

go 1.23.8

replace github.com/omniviewdev/omniview => ../../

replace github.com/omniviewdev/plugin-sdk => ../../../omniviewdev/plugin-sdk

require (
	github.com/aws/aws-sdk-go-v2 v1.41.1
	github.com/aws/aws-sdk-go-v2/config v1.32.7
	github.com/aws/aws-sdk-go-v2/service/ssooidc v1.35.13
	github.com/aws/aws-sdk-go-v2/service/sts v1.41.6
	github.com/omniviewdev/plugin-sdk v0.0.0-20240318235919-60d1ec21c49c
	gopkg.in/ini.v1 v1.67.0
)

require (
	github.com/aws/aws-sdk-go-v2/service/acm v1.37.19
	github.com/aws/aws-sdk-go-v2/service/apigatewayv2 v1.33.5
	github.com/aws/aws-sdk-go-v2/service/autoscaling v1.64.0
	github.com/aws/aws-sdk-go-v2/service/cloudformation v1.71.5
	github.com/aws/aws-sdk-go-v2/service/cloudfront v1.60.0
	github.com/aws/aws-sdk-go-v2/service/cloudwatch v1.54.0
	github.com/aws/aws-sdk-go-v2/service/cloudwatchlogs v1.63.1
	github.com/aws/aws-sdk-go-v2/service/dynamodb v1.55.0
	github.com/aws/aws-sdk-go-v2/service/ec2 v1.289.0
	github.com/aws/aws-sdk-go-v2/service/ecr v1.55.1
	github.com/aws/aws-sdk-go-v2/service/ecs v1.71.0
	github.com/aws/aws-sdk-go-v2/service/efs v1.41.10
	github.com/aws/aws-sdk-go-v2/service/eks v1.80.0
	github.com/aws/aws-sdk-go-v2/service/elasticache v1.51.9
	github.com/aws/aws-sdk-go-v2/service/elasticloadbalancingv2 v1.54.6
	github.com/aws/aws-sdk-go-v2/service/iam v1.53.2
	github.com/aws/aws-sdk-go-v2/service/kms v1.49.5
	github.com/aws/aws-sdk-go-v2/service/lambda v1.88.0
	github.com/aws/aws-sdk-go-v2/service/rds v1.115.0
	github.com/aws/aws-sdk-go-v2/service/redshift v1.62.1
	github.com/aws/aws-sdk-go-v2/service/route53 v1.62.1
	github.com/aws/aws-sdk-go-v2/service/s3 v1.96.0
	github.com/aws/aws-sdk-go-v2/service/secretsmanager v1.41.1
	github.com/aws/aws-sdk-go-v2/service/sns v1.39.11
	github.com/aws/aws-sdk-go-v2/service/sqs v1.42.21
)

require (
	github.com/aws/aws-sdk-go-v2/aws/protocol/eventstream v1.7.4 // indirect
	github.com/aws/aws-sdk-go-v2/credentials v1.19.7 // indirect
	github.com/aws/aws-sdk-go-v2/feature/ec2/imds v1.18.17 // indirect
	github.com/aws/aws-sdk-go-v2/internal/configsources v1.4.17 // indirect
	github.com/aws/aws-sdk-go-v2/internal/endpoints/v2 v2.7.17 // indirect
	github.com/aws/aws-sdk-go-v2/internal/ini v1.8.4 // indirect
	github.com/aws/aws-sdk-go-v2/internal/v4a v1.4.17 // indirect
	github.com/aws/aws-sdk-go-v2/service/internal/accept-encoding v1.13.4 // indirect
	github.com/aws/aws-sdk-go-v2/service/internal/checksum v1.9.8 // indirect
	github.com/aws/aws-sdk-go-v2/service/internal/endpoint-discovery v1.11.17 // indirect
	github.com/aws/aws-sdk-go-v2/service/internal/presigned-url v1.13.17 // indirect
	github.com/aws/aws-sdk-go-v2/service/internal/s3shared v1.19.17 // indirect
	github.com/aws/aws-sdk-go-v2/service/signin v1.0.5 // indirect
	github.com/aws/aws-sdk-go-v2/service/sso v1.30.9 // indirect
	github.com/aws/smithy-go v1.24.0 // indirect
	github.com/fatih/color v1.14.1 // indirect
	github.com/golang/protobuf v1.5.3 // indirect
	github.com/google/uuid v1.4.0 // indirect
	github.com/grpc-ecosystem/go-grpc-middleware/v2 v2.1.0 // indirect
	github.com/hashicorp/go-hclog v1.6.2 // indirect
	github.com/hashicorp/go-plugin v1.6.0 // indirect
	github.com/hashicorp/yamux v0.1.1 // indirect
	github.com/mattn/go-colorable v0.1.13 // indirect
	github.com/mattn/go-isatty v0.0.19 // indirect
	github.com/mitchellh/go-testing-interface v0.0.0-20171004221916-a61a99592b77 // indirect
	github.com/oklog/run v1.0.0 // indirect
	go.uber.org/multierr v1.11.0 // indirect
	go.uber.org/zap v1.27.0 // indirect
	golang.org/x/net v0.21.0 // indirect
	golang.org/x/sys v0.32.0 // indirect
	golang.org/x/text v0.14.0 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20240213162025-012b6fc9bca9 // indirect
	google.golang.org/grpc v1.61.1 // indirect
	google.golang.org/protobuf v1.33.0 // indirect
	gopkg.in/yaml.v3 v3.0.1 // indirect
)
