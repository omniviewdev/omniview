import React from "react";
import { Stack } from "@mui/joy";
import MetadataSection from "../../../shared/sidebar/pages/overview/sections/MetadataSection";
import DetailsCard from "../../../shared/DetailsCard";
import StatusSection from "../sections/StatusSection";
import TagsSection from "../sections/TagsSection";

interface Props {
  ctx: { data?: Record<string, any> };
}

const DBInstanceSidebar: React.FC<Props> = ({ ctx }) => {
  const data = ctx.data || {};

  const allocatedStorage = data?.AllocatedStorage
    ? `${data.AllocatedStorage} GiB`
    : undefined;

  const hasReplication =
    (Array.isArray(data?.ReadReplicaDBInstanceIdentifiers) &&
      data.ReadReplicaDBInstanceIdentifiers.length > 0) ||
    !!data?.ReadReplicaSourceDBInstanceIdentifier;

  return (
    <Stack direction="column" width="100%" spacing={1}>
      <MetadataSection data={data} />

      <StatusSection value={data?.DBInstanceStatus} />

      <DetailsCard
        title="Database Info"
        entries={[
          { label: "DB Instance ID", value: data?.DBInstanceIdentifier },
          { label: "Engine", value: data?.Engine },
          { label: "Engine Version", value: data?.EngineVersion },
          { label: "Instance Class", value: data?.DBInstanceClass },
          { label: "Allocated Storage", value: allocatedStorage },
          { label: "Multi-AZ", value: data?.MultiAZ },
          { label: "Storage Type", value: data?.StorageType },
          { label: "Storage Encrypted", value: data?.StorageEncrypted },
          { label: "License Model", value: data?.LicenseModel },
          { label: "Deletion Protection", value: data?.DeletionProtection },
          { label: "IOPS", value: data?.Iops },
          {
            label: "Max Storage",
            value: data?.MaxAllocatedStorage
              ? `${data.MaxAllocatedStorage} GiB`
              : undefined,
          },
        ]}
      />

      <DetailsCard
        title="Connectivity"
        entries={[
          { label: "Endpoint", value: data?.Endpoint?.Address },
          { label: "Port", value: data?.Endpoint?.Port },
          { label: "Availability Zone", value: data?.AvailabilityZone },
          { label: "VPC ID", value: data?.DBSubnetGroup?.VpcId },
          { label: "Publicly Accessible", value: data?.PubliclyAccessible },
          {
            label: "Subnet Group",
            value: data?.DBSubnetGroup?.DBSubnetGroupName,
          },
          { label: "CA Certificate", value: data?.CACertificateIdentifier },
        ]}
      />

      <DetailsCard
        title="Backup & Maintenance"
        entries={[
          {
            label: "Backup Retention",
            value: data?.BackupRetentionPeriod
              ? `${data.BackupRetentionPeriod} days`
              : undefined,
          },
          { label: "Backup Window", value: data?.PreferredBackupWindow },
          {
            label: "Maintenance Window",
            value: data?.PreferredMaintenanceWindow,
          },
          {
            label: "Auto Minor Upgrade",
            value: data?.AutoMinorVersionUpgrade,
          },
          {
            label: "Latest Restorable",
            value: data?.LatestRestorableTime
              ? String(data.LatestRestorableTime)
              : undefined,
          },
        ]}
      />

      <DetailsCard
        title="Monitoring"
        entries={[
          {
            label: "Performance Insights",
            value: data?.PerformanceInsightsEnabled,
          },
          {
            label: "Enhanced Monitoring",
            value: data?.MonitoringInterval
              ? `${data.MonitoringInterval}s`
              : "Disabled",
          },
          {
            label: "CloudWatch Logs",
            value:
              Array.isArray(data?.EnabledCloudwatchLogsExports) &&
              data.EnabledCloudwatchLogsExports.length > 0
                ? data.EnabledCloudwatchLogsExports.join(", ")
                : undefined,
          },
        ]}
      />

      {hasReplication && (
        <DetailsCard
          title="Replication"
          entries={[
            {
              label: "Source Instance",
              value: data?.ReadReplicaSourceDBInstanceIdentifier,
            },
            {
              label: "Read Replicas",
              value: Array.isArray(data?.ReadReplicaDBInstanceIdentifiers)
                ? data.ReadReplicaDBInstanceIdentifiers.join(", ")
                : undefined,
            },
          ]}
        />
      )}

      <TagsSection data={data} />
    </Stack>
  );
};

export default DBInstanceSidebar;
