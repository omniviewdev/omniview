import React from "react";
import DetailsCard from "../../../shared/DetailsCard";
import type { DetailEntry } from "../../../shared/DetailsCard";

interface Props {
  data: Record<string, any>;
}

/**
 * Displays EC2 instance-specific information such as instance ID, type,
 * platform, AMI ID, launch time, key pair, architecture, and lifecycle.
 */
const InstanceInfoSection: React.FC<Props> = ({ data }) => {
  const entries: DetailEntry[] = [
    { label: "Instance ID", value: data.InstanceId },
    { label: "Instance Type", value: data.InstanceType },
    { label: "Platform", value: data.PlatformDetails || data.Platform },
    { label: "AMI ID", value: data.ImageId },
    {
      label: "Launch Time",
      value: data.LaunchTime ? String(data.LaunchTime) : undefined,
    },
    { label: "Key Pair", value: data.KeyName },
    { label: "Architecture", value: data.Architecture },
    { label: "Lifecycle", value: data.InstanceLifecycle || "on-demand" },
  ];

  return <DetailsCard title="Instance Info" entries={entries} />;
};

export default InstanceInfoSection;
