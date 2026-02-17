import React from "react";
import { Stack } from "@mui/joy";
import MetadataSection from "../../../shared/sidebar/pages/overview/sections/MetadataSection";
import DetailsCard from "../../../shared/DetailsCard";
import NetworkingSection from "../sections/NetworkingSection";
import StatusSection from "../sections/StatusSection";
import StorageSection from "../sections/StorageSection";
import TagsSection from "../sections/TagsSection";

interface Props {
  ctx: { data?: Record<string, any> };
}

const InstanceSidebar: React.FC<Props> = ({ ctx }) => {
  const data = ctx.data || {};

  const placement = data?.Placement || {};

  // Extract security group IDs from the SecurityGroups array
  const securityGroupIds: string[] = Array.isArray(data?.SecurityGroups)
    ? data.SecurityGroups.map(
        (sg: { GroupId?: string }) => sg.GroupId
      ).filter((id: string | undefined): id is string => !!id)
    : [];

  return (
    <Stack direction="column" width="100%" spacing={1}>
      <MetadataSection data={data} />

      <StatusSection value={data?.State?.Name} />

      <DetailsCard
        title="Instance Info"
        entries={[
          { label: "Instance ID", value: data?.InstanceId },
          { label: "Instance Type", value: data?.InstanceType },
          { label: "Platform", value: data?.PlatformDetails },
          { label: "Image ID", value: data?.ImageId },
          { label: "Launch Time", value: data?.LaunchTime },
          { label: "Key Name", value: data?.KeyName },
          { label: "Architecture", value: data?.Architecture },
          { label: "Lifecycle", value: data?.InstanceLifecycle || "on-demand" },
          { label: "EBS Optimized", value: data?.EbsOptimized },
          { label: "Root Device", value: data?.RootDeviceName },
          { label: "Root Device Type", value: data?.RootDeviceType },
        ]}
      />

      <DetailsCard
        title="Compute"
        entries={[
          { label: "CPU Cores", value: data?.CpuOptions?.CoreCount },
          { label: "Threads/Core", value: data?.CpuOptions?.ThreadsPerCore },
          { label: "Hypervisor", value: data?.Hypervisor },
          { label: "Virtualization", value: data?.VirtualizationType },
        ]}
      />

      <NetworkingSection
        vpcId={data?.VpcId}
        subnetIds={data?.SubnetId ? [data.SubnetId] : undefined}
        securityGroupIds={securityGroupIds}
        publicIp={data?.PublicIpAddress}
        privateIp={data?.PrivateIpAddress}
        publicDns={data?.PublicDnsName}
        privateDns={data?.PrivateDnsName}
      />

      <DetailsCard
        title="Security"
        entries={[
          { label: "IAM Role", value: data?.IamInstanceProfile?.Arn },
          { label: "IMDSv2", value: data?.MetadataOptions?.HttpTokens },
          { label: "Source/Dest Check", value: data?.SourceDestCheck },
          { label: "Monitoring", value: data?.Monitoring?.State },
        ]}
      />

      <StorageSection devices={data?.BlockDeviceMappings || []} />

      <DetailsCard
        title="Placement"
        entries={[
          { label: "Availability Zone", value: placement?.AvailabilityZone },
          { label: "Group Name", value: placement?.GroupName },
          { label: "Tenancy", value: placement?.Tenancy },
        ]}
      />

      <TagsSection data={data} />
    </Stack>
  );
};

export default InstanceSidebar;
