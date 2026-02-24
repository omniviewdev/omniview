import { useResourceGroups } from "@omniviewdev/runtime";
import type { NavMenuItem, NavSection } from "@omniviewdev/ui/sidebars";
import React from "react";
import { types } from "@omniviewdev/runtime/models";
import {
  LuServer, LuNetwork, LuArchive, LuDatabase, LuShield, LuActivity,
  LuContainer, LuZap, LuScale, LuGlobe, LuCloud, LuFolderOpen,
  LuGauge, LuBell, LuList, LuTable, LuMemoryStick, LuWarehouse,
  LuKeyRound, LuLock, LuShieldCheck, LuLayers, LuPlug, LuPackage,
} from "react-icons/lu";

type Opts = {
  connectionID: string;
}

const toID = (meta: types.ResourceMeta) => `${meta.group}_${meta.version}_${meta.kind}`;

const labelSort = (a: NavMenuItem, b: NavMenuItem) => a.label.localeCompare(b.label)

// Human-readable display names for resource kinds (PascalCase → readable)
const kindDisplayNames: Record<string, string> = {
  'Instance': 'Instances',
  'Image': 'AMIs',
  'KeyPair': 'Key Pairs',
  'LaunchTemplate': 'Launch Templates',
  'Volume': 'Volumes',
  'Snapshot': 'Snapshots',
  'ElasticIP': 'Elastic IPs',
  'PlacementGroup': 'Placement Groups',
  'VPC': 'VPCs',
  'Subnet': 'Subnets',
  'SecurityGroup': 'Security Groups',
  'InternetGateway': 'Internet Gateways',
  'NATGateway': 'NAT Gateways',
  'DHCPOptionsSet': 'DHCP Options',
  'RouteTable': 'Route Tables',
  'NetworkACL': 'Network ACLs',
  'NetworkInterface': 'Network Interfaces',
  'VPCEndpoint': 'VPC Endpoints',
  'VPCPeeringConnection': 'Peering Connections',
  'TransitGateway': 'Transit Gateways',
  'FlowLog': 'Flow Logs',
  'Cluster': 'Clusters',
  'Nodegroup': 'Node Groups',
  'Addon': 'Add-ons',
  'Bucket': 'Buckets',
  'DBInstance': 'DB Instances',
  'DBCluster': 'DB Clusters',
  'DBSubnetGroup': 'DB Subnet Groups',
  'DBSnapshot': 'DB Snapshots',
  'DBParameterGroup': 'Parameter Groups',
  'CacheCluster': 'Cache Clusters',
  'ReplicationGroup': 'Replication Groups',
  'CacheSubnetGroup': 'Cache Subnet Groups',
  'Function': 'Functions',
  'Layer': 'Layers',
  'EventSourceMapping': 'Event Sources',
  'LoadBalancer': 'Load Balancers',
  'TargetGroup': 'Target Groups',
  'Listener': 'Listeners',
  'HostedZone': 'Hosted Zones',
  'HealthCheck': 'Health Checks',
  'RecordSet': 'Record Sets',
  'Distribution': 'Distributions',
  'CachePolicy': 'Cache Policies',
  'FileSystem': 'File Systems',
  'AccessPoint': 'Access Points',
  'MountTarget': 'Mount Targets',
  'SubnetGroup': 'Subnet Groups',
  'Table': 'Tables',
  'User': 'Users',
  'Role': 'Roles',
  'Policy': 'Policies',
  'Group': 'Groups',
  'InstanceProfile': 'Instance Profiles',
  'AutoScalingGroup': 'Auto Scaling Groups',
  'LaunchConfiguration': 'Launch Configs',
  'ScalingPolicy': 'Scaling Policies',
  'Alarm': 'Alarms',
  'LogGroup': 'Log Groups',
  'Dashboard': 'Dashboards',
  'Topic': 'Topics',
  'Subscription': 'Subscriptions',
  'Queue': 'Queues',
  'Service': 'Services',
  'Task': 'Tasks',
  'TaskDefinition': 'Task Definitions',
  'ContainerInstance': 'Container Instances',
  'Repository': 'Repositories',
  'Key': 'Keys',
  'Alias': 'Aliases',
  'Secret': 'Secrets',
  'Certificate': 'Certificates',
  'Stack': 'Stacks',
  'StackSet': 'Stack Sets',
  'HttpApi': 'HTTP APIs',
  'Stage': 'Stages',
  'DomainName': 'Domain Names',
}

type AWSCategory = 'compute' | 'networking' | 'storage' | 'database' | 'security' | 'management'

// Sub-section definitions for major service groups (AWS Console-style organization)
// Groups with <= 3 resources stay flat; groups with more get organized into sub-sections.
const GroupSubSections: Record<string, { label: string; kinds: string[] }[]> = {
  'ec2': [
    { label: 'Instances', kinds: ['Instance', 'LaunchTemplate'] },
    { label: 'Images', kinds: ['Image'] },
    { label: 'Elastic Block Store', kinds: ['Volume', 'Snapshot'] },
    { label: 'Network & Security', kinds: ['KeyPair', 'ElasticIP', 'PlacementGroup'] },
  ],
  'vpc': [
    { label: 'Your VPCs', kinds: ['VPC', 'Subnet', 'RouteTable', 'InternetGateway', 'NATGateway', 'DHCPOptionsSet'] },
    { label: 'Security', kinds: ['SecurityGroup', 'NetworkACL'] },
    { label: 'Network Interfaces', kinds: ['NetworkInterface'] },
    { label: 'Connectivity', kinds: ['VPCEndpoint', 'VPCPeeringConnection', 'TransitGateway'] },
    { label: 'Monitoring', kinds: ['FlowLog'] },
  ],
  'iam': [
    { label: 'Identities', kinds: ['User', 'Role', 'Group', 'InstanceProfile'] },
    { label: 'Policies', kinds: ['Policy'] },
  ],
  'rds': [
    { label: 'Databases', kinds: ['DBInstance', 'DBCluster'] },
    { label: 'Configuration', kinds: ['DBSubnetGroup', 'DBParameterGroup'] },
    { label: 'Snapshots', kinds: ['DBSnapshot'] },
  ],
  'ecs': [
    { label: 'Clusters', kinds: ['Cluster', 'ContainerInstance'] },
    { label: 'Services', kinds: ['Service'] },
    { label: 'Tasks', kinds: ['Task', 'TaskDefinition'] },
  ],
}

// Map group IDs directly to categories to avoid kind-name collisions (e.g. 'Cluster' in both EKS and Redshift)
const GroupCategoryMap: Record<string, AWSCategory> = {
  'ec2': 'compute',
  'eks': 'compute',
  'ecs': 'compute',
  'ecr': 'compute',
  'lambda': 'compute',
  'autoscaling': 'compute',
  'vpc': 'networking',
  'elbv2': 'networking',
  'route53': 'networking',
  'cloudfront': 'networking',
  'apigateway': 'networking',
  's3': 'storage',
  'efs': 'storage',
  'rds': 'database',
  'dynamodb': 'database',
  'elasticache': 'database',
  'redshift': 'database',
  'iam': 'security',
  'kms': 'security',
  'secretsmanager': 'security',
  'acm': 'security',
  'cloudwatch': 'management',
  'cloudformation': 'management',
  'sns': 'management',
  'sqs': 'management',
}

// Fallback: map individual kind names to categories (used when groupId is not in GroupCategoryMap)
const CategoryMap: Record<string, AWSCategory> = {
  // Compute
  'Instance': 'compute',
  'Image': 'compute',
  'KeyPair': 'compute',
  'LaunchTemplate': 'compute',
  'Volume': 'compute',
  'Snapshot': 'compute',
  'ElasticIP': 'compute',
  'Cluster': 'compute', // EKS clusters
  'Nodegroup': 'compute',
  'Addon': 'compute',
  'Function': 'compute',
  'Layer': 'compute',
  'EventSourceMapping': 'compute',
  'AutoScalingGroup': 'compute',
  'LaunchConfiguration': 'compute',
  'ScalingPolicy': 'compute',
  'PlacementGroup': 'compute',

  // Networking
  'VPC': 'networking',
  'Subnet': 'networking',
  'SecurityGroup': 'networking',
  'InternetGateway': 'networking',
  'NATGateway': 'networking',
  'DHCPOptionsSet': 'networking',
  'RouteTable': 'networking',
  'NetworkACL': 'networking',
  'NetworkInterface': 'networking',
  'VPCEndpoint': 'networking',
  'VPCPeeringConnection': 'networking',
  'TransitGateway': 'networking',
  'LoadBalancer': 'networking',
  'TargetGroup': 'networking',
  'Listener': 'networking',
  'HostedZone': 'networking',
  'HealthCheck': 'networking',
  'RecordSet': 'networking',
  'Distribution': 'networking',
  'CachePolicy': 'networking',

  // Storage
  'Bucket': 'storage',
  'FileSystem': 'storage',
  'AccessPoint': 'storage',
  'MountTarget': 'storage',

  // Database
  'DBInstance': 'database',
  'DBCluster': 'database',
  'DBSubnetGroup': 'database',
  'DBSnapshot': 'database',
  'DBParameterGroup': 'database',
  'CacheCluster': 'database',
  'ReplicationGroup': 'database',
  'CacheSubnetGroup': 'database',
  'SubnetGroup': 'database', // Redshift
  'Table': 'database', // DynamoDB

  // Security
  'User': 'security',
  'Role': 'security',
  'Policy': 'security',
  'Group': 'security',
  'InstanceProfile': 'security',

  // Management
  'Alarm': 'management',
  'LogGroup': 'management',
  'Topic': 'management',
  'Subscription': 'management',
  'Queue': 'management',

  // New services
  'Service': 'compute',
  'Task': 'compute',
  'TaskDefinition': 'compute',
  'ContainerInstance': 'compute',
  'Repository': 'compute',
  'Key': 'security',
  'Alias': 'security',
  'Secret': 'security',
  'Certificate': 'security',
  'Stack': 'management',
  'StackSet': 'management',
  'HttpApi': 'networking',
  'Stage': 'networking',
  'DomainName': 'networking',
  'Dashboard': 'management',
  'FlowLog': 'networking',
}

// Map group IDs to icons
const groupIconMap: Record<string, React.ReactNode> = {
  'ec2': <LuServer />,
  'vpc': <LuNetwork />,
  'eks': <LuContainer />,
  's3': <LuArchive />,
  'rds': <LuDatabase />,
  'dynamodb': <LuTable />,
  'elasticache': <LuMemoryStick />,
  'lambda': <LuZap />,
  'elbv2': <LuScale />,
  'route53': <LuGlobe />,
  'cloudfront': <LuCloud />,
  'efs': <LuFolderOpen />,
  'redshift': <LuWarehouse />,
  'iam': <LuShield />,
  'autoscaling': <LuGauge />,
  'cloudwatch': <LuActivity />,
  'sns': <LuBell />,
  'sqs': <LuList />,
  'ecs': <LuContainer />,
  'ecr': <LuPackage />,
  'kms': <LuKeyRound />,
  'secretsmanager': <LuLock />,
  'acm': <LuShieldCheck />,
  'cloudformation': <LuLayers />,
  'apigateway': <LuPlug />,
}

const calculateLayout = (data: Record<string, types.ResourceGroup>): Array<NavSection> => {
  if (!data) return []

  const computeResources: NavMenuItem[] = [];
  const networkingResources: NavMenuItem[] = [];
  const storageResources: NavMenuItem[] = [];
  const databaseResources: NavMenuItem[] = [];
  const securityResources: NavMenuItem[] = [];
  const managementResources: NavMenuItem[] = [];

  // Group resources by their AWS service group (ec2, vpc, rds, etc.)
  const serviceGroups: Record<string, NavMenuItem[]> = {};

  Object.values(data).forEach((group) => {
    Object.entries(group.resources).forEach(([_, metas]) => {
      metas.forEach((meta) => {
        const item: NavMenuItem = {
          id: toID(meta),
          label: kindDisplayNames[meta.kind] || meta.kind,
        };

        if (!serviceGroups[meta.group]) {
          serviceGroups[meta.group] = [];
        }
        serviceGroups[meta.group].push(item);
      });
    });
  });

  // Now organize service groups into categories
  Object.entries(serviceGroups).forEach(([groupId, items]) => {
    const groupInfo = Object.values(data).find(g => g.id === groupId);

    // Check if this group has sub-section definitions
    const subSections = GroupSubSections[groupId];
    let children: NavMenuItem[];

    if (subSections) {
      // Organize items into sub-sections (AWS Console-style)
      // Extract original kind from ID (format: group_v1_Kind) to match against sub-section definitions
      const extractKind = (id: string) => id.split('_').slice(2).join('_');
      const itemsByKind = new Map(items.map(item => [extractKind(item.id), item]));
      const usedKinds = new Set<string>();

      children = subSections
        .map(section => {
          const sectionItems = section.kinds
            .map(kind => {
              const item = itemsByKind.get(kind);
              if (item) usedKinds.add(kind);
              return item;
            })
            .filter((item): item is NavMenuItem => !!item);

          if (sectionItems.length === 0) return null;

          return {
            id: `${groupId}__${section.label.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
            label: section.label,
            children: sectionItems,
            defaultExpanded: true,
          } as NavMenuItem;
        })
        .filter((item): item is NavMenuItem => !!item);

      // Add any remaining items not covered by sub-sections
      const uncategorized = items.filter(item => !usedKinds.has(extractKind(item.id)));
      if (uncategorized.length > 0) {
        children.push({
          id: `${groupId}__other`,
          label: 'Other',
          children: uncategorized.sort(labelSort),
          defaultExpanded: true,
        });
      }
    } else {
      children = items.sort(labelSort);
    }

    const groupItem: NavMenuItem = {
      id: groupId,
      label: groupInfo?.name || groupId.toUpperCase(),
      icon: groupIconMap[groupId] || undefined,
      children,
      defaultExpanded: false,
    };

    // Determine category: prefer group-level mapping (unambiguous), fall back to kind-level
    const category = GroupCategoryMap[groupId] ?? CategoryMap[items[0]?.label];

    switch (category) {
      case 'compute': computeResources.push(groupItem); break;
      case 'networking': networkingResources.push(groupItem); break;
      case 'storage': storageResources.push(groupItem); break;
      case 'database': databaseResources.push(groupItem); break;
      case 'security': securityResources.push(groupItem); break;
      case 'management': managementResources.push(groupItem); break;
      default: computeResources.push(groupItem); break;
    }
  });

  const sections: NavSection[] = [
    {
      title: '',
      items: [
        ...(computeResources.length ? [{ id: 'compute', label: 'Compute', icon: <LuServer />, defaultExpanded: true, children: computeResources.flatMap(g => g.children || []).sort(labelSort).length > 0 ? computeResources.sort(labelSort) : [] } as NavMenuItem] : []),
        ...(networkingResources.length ? [{ id: 'networking', label: 'Networking', icon: <LuNetwork />, defaultExpanded: true, children: networkingResources.sort(labelSort) } as NavMenuItem] : []),
        ...(storageResources.length ? [{ id: 'storage', label: 'Storage', icon: <LuArchive />, defaultExpanded: true, children: storageResources.sort(labelSort) } as NavMenuItem] : []),
        ...(databaseResources.length ? [{ id: 'database', label: 'Database', icon: <LuDatabase />, defaultExpanded: true, children: databaseResources.sort(labelSort) } as NavMenuItem] : []),
        ...(securityResources.length ? [{ id: 'security', label: 'Security', icon: <LuShield />, defaultExpanded: true, children: securityResources.sort(labelSort) } as NavMenuItem] : []),
        ...(managementResources.length ? [{ id: 'management', label: 'Management', icon: <LuActivity />, defaultExpanded: true, children: managementResources.sort(labelSort) } as NavMenuItem] : []),
      ]
    },
  ];

  return sections;
}

export const useSidebarLayout = ({ connectionID }: Opts) => {
  const { groups } = useResourceGroups({ pluginID: 'aws', connectionID });
  const [layout, setLayout] = React.useState<Array<NavSection>>([])
  const [isLoading, setIsLoading] = React.useState<boolean>(true)

  React.useEffect(() => {
    if (!groups.data) return
    setIsLoading(true)
    setLayout(calculateLayout(groups.data))
    setIsLoading(false)
  }, [groups.data])

  return { layout, isLoading }
}
