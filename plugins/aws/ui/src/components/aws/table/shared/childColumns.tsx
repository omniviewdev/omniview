import { ColumnDef } from '@tanstack/react-table';
import StatusCell from './cells/StatusCell';

// ── ECS ───────────────────────────────────────────────────────────────────────

export const ecsServiceColumns: Array<ColumnDef<any>> = [
  { id: 'serviceName', header: 'Service Name', accessorKey: 'ServiceName', size: 250, meta: { flex: 1 } },
  { id: 'status', header: 'Status', accessorKey: 'Status', cell: ({ getValue }) => <StatusCell value={getValue() as string} />, size: 100 },
  { id: 'desiredCount', header: 'Desired', accessorKey: 'DesiredCount', size: 80 },
  { id: 'runningCount', header: 'Running', accessorKey: 'RunningCount', size: 80 },
  { id: 'launchType', header: 'Launch Type', accessorKey: 'LaunchType', size: 120 },
];

export const ecsTaskColumns: Array<ColumnDef<any>> = [
  { id: 'taskArn', header: 'Task', accessorFn: (row: any) => row.TaskArn?.split('/').pop() || row.TaskArn, size: 250, meta: { flex: 1 } },
  { id: 'lastStatus', header: 'Status', accessorKey: 'LastStatus', cell: ({ getValue }) => <StatusCell value={getValue() as string} />, size: 100 },
  { id: 'launchType', header: 'Launch Type', accessorKey: 'LaunchType', size: 120 },
  { id: 'cpu', header: 'CPU', accessorKey: 'Cpu', size: 80 },
  { id: 'memory', header: 'Memory', accessorKey: 'Memory', size: 80 },
];

export const ecsContainerInstanceColumns: Array<ColumnDef<any>> = [
  { id: 'containerInstanceArn', header: 'Instance', accessorFn: (row: any) => row.ContainerInstanceArn?.split('/').pop() || row.ContainerInstanceArn, size: 250, meta: { flex: 1 } },
  { id: 'status', header: 'Status', accessorKey: 'Status', cell: ({ getValue }) => <StatusCell value={getValue() as string} />, size: 100 },
  { id: 'runningTasksCount', header: 'Running Tasks', accessorKey: 'RunningTasksCount', size: 110 },
  { id: 'agentConnected', header: 'Agent', accessorFn: (row: any) => row.AgentConnected ? 'Connected' : 'Disconnected', size: 110 },
];

// ── ELBv2 ─────────────────────────────────────────────────────────────────────

export const elbListenerColumns: Array<ColumnDef<any>> = [
  { id: 'listenerArn', header: 'Listener', accessorFn: (row: any) => row.ListenerArn?.split('/').pop() || row.ListenerArn, size: 250, meta: { flex: 1 } },
  { id: 'protocol', header: 'Protocol', accessorKey: 'Protocol', size: 100 },
  { id: 'port', header: 'Port', accessorKey: 'Port', size: 80 },
  { id: 'defaultActions', header: 'Default Action', accessorFn: (row: any) => row.DefaultActions?.[0]?.Type || '', size: 150 },
];

export const elbTargetGroupColumns: Array<ColumnDef<any>> = [
  { id: 'targetGroupName', header: 'Target Group', accessorKey: 'TargetGroupName', size: 250, meta: { flex: 1 } },
  { id: 'protocol', header: 'Protocol', accessorKey: 'Protocol', size: 100 },
  { id: 'port', header: 'Port', accessorKey: 'Port', size: 80 },
  { id: 'targetType', header: 'Target Type', accessorKey: 'TargetType', size: 100 },
  { id: 'healthCheckPath', header: 'Health Check', accessorKey: 'HealthCheckPath', size: 150 },
];

// ── Route53 ───────────────────────────────────────────────────────────────────

export const route53RecordSetColumns: Array<ColumnDef<any>> = [
  { id: 'recordName', header: 'Name', accessorKey: 'Name', size: 300, meta: { flex: 1 } },
  { id: 'type', header: 'Type', accessorKey: 'Type', size: 80 },
  { id: 'ttl', header: 'TTL', accessorKey: 'TTL', size: 80 },
  { id: 'values', header: 'Value', accessorFn: (row: any) => (row.ResourceRecords || []).map((r: any) => r.Value).join(', ') || row.AliasTarget?.DNSName || '', size: 300 },
];

export const route53HealthCheckColumns: Array<ColumnDef<any>> = [
  { id: 'healthCheckId', header: 'Health Check ID', accessorKey: 'Id', size: 250, meta: { flex: 1 } },
  { id: 'type', header: 'Type', accessorFn: (row: any) => row.HealthCheckConfig?.Type, size: 100 },
  { id: 'fqdn', header: 'FQDN', accessorFn: (row: any) => row.HealthCheckConfig?.FullyQualifiedDomainName || '', size: 250 },
  { id: 'port', header: 'Port', accessorFn: (row: any) => row.HealthCheckConfig?.Port, size: 80 },
];

// ── EKS ───────────────────────────────────────────────────────────────────────

export const eksNodegroupColumns: Array<ColumnDef<any>> = [
  { id: 'nodegroupName', header: 'Nodegroup', accessorKey: 'NodegroupName', size: 250, meta: { flex: 1 } },
  { id: 'status', header: 'Status', accessorKey: 'Status', cell: ({ getValue }) => <StatusCell value={getValue() as string} />, size: 100 },
  { id: 'desiredSize', header: 'Desired', accessorFn: (row: any) => row.ScalingConfig?.DesiredSize, size: 80 },
  { id: 'minSize', header: 'Min', accessorFn: (row: any) => row.ScalingConfig?.MinSize, size: 60 },
  { id: 'maxSize', header: 'Max', accessorFn: (row: any) => row.ScalingConfig?.MaxSize, size: 60 },
];

export const eksAddonColumns: Array<ColumnDef<any>> = [
  { id: 'addonName', header: 'Addon', accessorKey: 'AddonName', size: 250, meta: { flex: 1 } },
  { id: 'addonVersion', header: 'Version', accessorKey: 'AddonVersion', size: 200 },
  { id: 'status', header: 'Status', accessorKey: 'Status', cell: ({ getValue }) => <StatusCell value={getValue() as string} />, size: 100 },
];

// ── VPC ───────────────────────────────────────────────────────────────────────

export const vpcSubnetColumns: Array<ColumnDef<any>> = [
  { id: 'subnetId', header: 'Subnet ID', accessorKey: 'SubnetId', size: 200, meta: { flex: 1 } },
  { id: 'cidr', header: 'CIDR Block', accessorKey: 'CidrBlock', size: 140 },
  { id: 'az', header: 'AZ', accessorKey: 'AvailabilityZone', size: 130 },
  { id: 'state', header: 'State', accessorKey: 'State', cell: ({ getValue }) => <StatusCell value={getValue() as string} />, size: 100 },
  { id: 'availableIps', header: 'Available IPs', accessorKey: 'AvailableIpAddressCount', size: 110 },
];

export const vpcRouteTableColumns: Array<ColumnDef<any>> = [
  { id: 'routeTableId', header: 'Route Table ID', accessorKey: 'RouteTableId', size: 200, meta: { flex: 1 } },
  { id: 'routes', header: 'Routes', accessorFn: (row: any) => row.Routes?.length ?? 0, size: 80 },
  { id: 'associations', header: 'Associations', accessorFn: (row: any) => row.Associations?.length ?? 0, size: 100 },
  { id: 'main', header: 'Main', accessorFn: (row: any) => (row.Associations || []).some((a: any) => a.Main) ? 'Yes' : 'No', size: 60 },
];

export const vpcSecurityGroupColumns: Array<ColumnDef<any>> = [
  { id: 'groupId', header: 'Group ID', accessorKey: 'GroupId', size: 180 },
  { id: 'groupName', header: 'Group Name', accessorKey: 'GroupName', size: 200, meta: { flex: 1 } },
  { id: 'description', header: 'Description', accessorKey: 'Description', size: 200 },
  { id: 'inbound', header: 'Inbound Rules', accessorFn: (row: any) => row.IpPermissions?.length ?? 0, size: 110 },
  { id: 'outbound', header: 'Outbound Rules', accessorFn: (row: any) => row.IpPermissionsEgress?.length ?? 0, size: 110 },
];

export const vpcInternetGatewayColumns: Array<ColumnDef<any>> = [
  { id: 'gatewayId', header: 'Gateway ID', accessorKey: 'InternetGatewayId', size: 200, meta: { flex: 1 } },
  { id: 'state', header: 'State', accessorFn: (row: any) => row.Attachments?.[0]?.State || '', cell: ({ getValue }) => <StatusCell value={getValue() as string} />, size: 100 },
  { id: 'vpcId', header: 'VPC', accessorFn: (row: any) => row.Attachments?.[0]?.VpcId || '', size: 180 },
];

export const vpcNATGatewayColumns: Array<ColumnDef<any>> = [
  { id: 'natGatewayId', header: 'NAT Gateway ID', accessorKey: 'NatGatewayId', size: 200, meta: { flex: 1 } },
  { id: 'state', header: 'State', accessorKey: 'State', cell: ({ getValue }) => <StatusCell value={getValue() as string} />, size: 100 },
  { id: 'subnetId', header: 'Subnet', accessorKey: 'SubnetId', size: 200 },
  { id: 'connectivityType', header: 'Type', accessorKey: 'ConnectivityType', size: 100 },
];
