import React from 'react'
//@ts-ignore
window.PluginReact = React

import { PluginWindow } from '@omniviewdev/runtime';
import { RouteObject } from 'react-router-dom';

import AccountsPage from './pages/AccountsPage';
import AccountEditPage from './pages/AccountEditPage';
import AccountResourcesPage from './pages/AccountResourcesPage';

import DefaultTable from './components/aws/table/default/Table';

// ec2
import EC2InstanceTable from './components/aws/table/ec2/InstanceTable';
import EC2VolumeTable from './components/aws/table/ec2/VolumeTable';
import LaunchTemplateTable from './components/aws/table/ec2/LaunchTemplateTable';

// vpc
import VPCTable from './components/aws/table/vpc/VPCTable';
import SubnetTable from './components/aws/table/vpc/SubnetTable';
import SecurityGroupTable from './components/aws/table/vpc/SecurityGroupTable';

// eks
import EKSClusterTable from './components/aws/table/eks/ClusterTable';

// s3
import S3BucketTable from './components/aws/table/s3/BucketTable';

// rds
import RDSDBInstanceTable from './components/aws/table/rds/DBInstanceTable';

// lambda
import LambdaFunctionTable from './components/aws/table/lambda/FunctionTable';

// elbv2
import ELBLoadBalancerTable from './components/aws/table/elbv2/LoadBalancerTable';

// iam
import IAMRoleTable from './components/aws/table/iam/RoleTable';
import IAMUserTable from './components/aws/table/iam/UserTable';

// route53
import Route53HostedZoneTable from './components/aws/table/route53/HostedZoneTable';
import RecordSetTable from './components/aws/table/route53/RecordSetTable';

// cloudwatch
import CloudWatchAlarmTable from './components/aws/table/cloudwatch/AlarmTable';

// dynamodb
import DynamoDBTableView from './components/aws/table/dynamodb/DynamoDBTable';

// ecs
import ECSClusterTable from './components/aws/table/ecs/ClusterTable';
import ECSServiceTable from './components/aws/table/ecs/ServiceTable';
import ECSTaskTable from './components/aws/table/ecs/TaskTable';
import TaskDefinitionTable from './components/aws/table/ecs/TaskDefinitionTable';

// autoscaling
import AutoScalingGroupTable from './components/aws/table/autoscaling/AutoScalingGroupTable';

// acm
import ACMCertificateTable from './components/aws/table/acm/CertificateTable';

// cloudformation
import CloudFormationStackTable from './components/aws/table/cloudformation/StackTable';

// ecr
import ECRRepositoryTable from './components/aws/table/ecr/RepositoryTable';

// detail pages
import ECSClusterDetailPage from './pages/detail/ECSClusterDetailPage';
import ELBLoadBalancerDetailPage from './pages/detail/ELBLoadBalancerDetailPage';
import Route53ZoneDetailPage from './pages/detail/Route53ZoneDetailPage';
import EKSClusterDetailPage from './pages/detail/EKSClusterDetailPage';
import VPCDetailPage from './pages/detail/VPCDetailPage';

const routes: Array<RouteObject> = [
  {
    path: '/',
    Component: AccountsPage,
  },
  {
    path: '/accounts',
    Component: AccountsPage,
  },
  {
    path: '/account/:id',
    children: [
      {
        path: 'edit',
        Component: AccountEditPage,
      },
      {
        path: 'resources',
        Component: AccountResourcesPage,
        children: [
          // ec2
          { path: 'ec2_v1_Instance', Component: EC2InstanceTable },
          { path: 'ec2_v1_Volume', Component: EC2VolumeTable },
          { path: 'ec2_v1_Snapshot', Component: DefaultTable },
          { path: 'ec2_v1_Image', Component: DefaultTable },
          { path: 'ec2_v1_KeyPair', Component: DefaultTable },
          { path: 'ec2_v1_ElasticIP', Component: DefaultTable },
          { path: 'ec2_v1_LaunchTemplate', Component: LaunchTemplateTable },
          { path: 'ec2_v1_PlacementGroup', Component: DefaultTable },

          // vpc
          { path: 'vpc_v1_VPC', Component: VPCTable },
          { path: 'vpc_v1_VPC/:resourceId', Component: VPCDetailPage },
          { path: 'vpc_v1_Subnet', Component: SubnetTable },
          { path: 'vpc_v1_SecurityGroup', Component: SecurityGroupTable },
          { path: 'vpc_v1_InternetGateway', Component: DefaultTable },
          { path: 'vpc_v1_NATGateway', Component: DefaultTable },
          { path: 'vpc_v1_RouteTable', Component: DefaultTable },
          { path: 'vpc_v1_NetworkACL', Component: DefaultTable },
          { path: 'vpc_v1_NetworkInterface', Component: DefaultTable },
          { path: 'vpc_v1_VPCEndpoint', Component: DefaultTable },
          { path: 'vpc_v1_VPCPeeringConnection', Component: DefaultTable },
          { path: 'vpc_v1_TransitGateway', Component: DefaultTable },

          // eks
          { path: 'eks_v1_Cluster', Component: EKSClusterTable },
          { path: 'eks_v1_Cluster/:resourceId', Component: EKSClusterDetailPage },
          { path: 'eks_v1_Nodegroup', Component: DefaultTable },
          { path: 'eks_v1_Addon', Component: DefaultTable },

          // s3
          { path: 's3_v1_Bucket', Component: S3BucketTable },

          // rds
          { path: 'rds_v1_DBInstance', Component: RDSDBInstanceTable },
          { path: 'rds_v1_DBCluster', Component: DefaultTable },
          { path: 'rds_v1_DBSubnetGroup', Component: DefaultTable },
          { path: 'rds_v1_DBSnapshot', Component: DefaultTable },
          { path: 'rds_v1_DBParameterGroup', Component: DefaultTable },

          // lambda
          { path: 'lambda_v1_Function', Component: LambdaFunctionTable },
          { path: 'lambda_v1_Layer', Component: DefaultTable },
          { path: 'lambda_v1_EventSourceMapping', Component: DefaultTable },

          // elbv2
          { path: 'elbv2_v1_LoadBalancer', Component: ELBLoadBalancerTable },
          { path: 'elbv2_v1_LoadBalancer/:resourceId', Component: ELBLoadBalancerDetailPage },
          { path: 'elbv2_v1_TargetGroup', Component: DefaultTable },
          { path: 'elbv2_v1_Listener', Component: DefaultTable },

          // iam
          { path: 'iam_v1_Role', Component: IAMRoleTable },
          { path: 'iam_v1_User', Component: IAMUserTable },
          { path: 'iam_v1_Policy', Component: DefaultTable },
          { path: 'iam_v1_Group', Component: DefaultTable },
          { path: 'iam_v1_InstanceProfile', Component: DefaultTable },

          // route53
          { path: 'route53_v1_HostedZone', Component: Route53HostedZoneTable },
          { path: 'route53_v1_HostedZone/:resourceId', Component: Route53ZoneDetailPage },
          { path: 'route53_v1_HealthCheck', Component: DefaultTable },
          { path: 'route53_v1_RecordSet', Component: RecordSetTable },

          // cloudfront
          { path: 'cloudfront_v1_Distribution', Component: DefaultTable },
          { path: 'cloudfront_v1_CachePolicy', Component: DefaultTable },

          // cloudwatch
          { path: 'cloudwatch_v1_Alarm', Component: CloudWatchAlarmTable },
          { path: 'cloudwatch_v1_LogGroup', Component: DefaultTable },

          // autoscaling
          { path: 'autoscaling_v1_AutoScalingGroup', Component: AutoScalingGroupTable },
          { path: 'autoscaling_v1_LaunchConfiguration', Component: DefaultTable },
          { path: 'autoscaling_v1_ScalingPolicy', Component: DefaultTable },

          // elasticache
          { path: 'elasticache_v1_CacheCluster', Component: DefaultTable },
          { path: 'elasticache_v1_ReplicationGroup', Component: DefaultTable },
          { path: 'elasticache_v1_CacheSubnetGroup', Component: DefaultTable },

          // efs
          { path: 'efs_v1_FileSystem', Component: DefaultTable },
          { path: 'efs_v1_AccessPoint', Component: DefaultTable },
          { path: 'efs_v1_MountTarget', Component: DefaultTable },

          // redshift
          { path: 'redshift_v1_Cluster', Component: DefaultTable },
          { path: 'redshift_v1_SubnetGroup', Component: DefaultTable },

          // sns
          { path: 'sns_v1_Topic', Component: DefaultTable },
          { path: 'sns_v1_Subscription', Component: DefaultTable },

          // sqs
          { path: 'sqs_v1_Queue', Component: DefaultTable },

          // dynamodb
          { path: 'dynamodb_v1_Table', Component: DynamoDBTableView },

          // ecs
          { path: 'ecs_v1_Cluster', Component: ECSClusterTable },
          { path: 'ecs_v1_Cluster/:resourceId', Component: ECSClusterDetailPage },
          { path: 'ecs_v1_Service', Component: ECSServiceTable },
          { path: 'ecs_v1_Task', Component: ECSTaskTable },
          { path: 'ecs_v1_TaskDefinition', Component: TaskDefinitionTable },
          { path: 'ecs_v1_ContainerInstance', Component: DefaultTable },

          // ecr
          { path: 'ecr_v1_Repository', Component: ECRRepositoryTable },

          // kms
          { path: 'kms_v1_Key', Component: DefaultTable },
          { path: 'kms_v1_Alias', Component: DefaultTable },

          // secretsmanager
          { path: 'secretsmanager_v1_Secret', Component: DefaultTable },

          // acm
          { path: 'acm_v1_Certificate', Component: ACMCertificateTable },

          // cloudformation
          { path: 'cloudformation_v1_Stack', Component: CloudFormationStackTable },
          { path: 'cloudformation_v1_StackSet', Component: DefaultTable },

          // apigateway
          { path: 'apigateway_v1_HttpApi', Component: DefaultTable },
          { path: 'apigateway_v1_Stage', Component: DefaultTable },
          { path: 'apigateway_v1_DomainName', Component: DefaultTable },

          // cloudwatch (new sub-resource)
          { path: 'cloudwatch_v1_Dashboard', Component: DefaultTable },

          // vpc (new sub-resources)
          { path: 'vpc_v1_FlowLog', Component: DefaultTable },
          { path: 'vpc_v1_DHCPOptionsSet', Component: DefaultTable },

          // Catch-all for any remaining or custom resources
          { path: ':resourceKey', Component: DefaultTable }
        ]
      }
    ]
  }
]

export const plugin = new PluginWindow()
  .setRootPage(AccountsPage)
  .withRoutes(routes)
