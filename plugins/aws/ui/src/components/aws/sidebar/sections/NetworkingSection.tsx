import React from "react";
import DetailsCard from "../../../shared/DetailsCard";
import type { DetailEntry } from "../../../shared/DetailsCard";

interface Props {
  vpcId?: string;
  subnetIds?: string[];
  securityGroupIds?: string[];
  publicIp?: string;
  privateIp?: string;
  publicDns?: string;
  privateDns?: string;
  availabilityZones?: string[];
}

/**
 * Displays networking-related details for an AWS resource.
 * Renders a DetailsCard with entries for each non-empty prop.
 */
const NetworkingSection: React.FC<Props> = ({
  vpcId,
  subnetIds,
  securityGroupIds,
  publicIp,
  privateIp,
  publicDns,
  privateDns,
  availabilityZones,
}) => {
  const entries: DetailEntry[] = [
    { label: "VPC ID", value: vpcId },
    {
      label: "Subnet IDs",
      value: subnetIds && subnetIds.length > 0 ? subnetIds.join(", ") : undefined,
    },
    {
      label: "Security Groups",
      value:
        securityGroupIds && securityGroupIds.length > 0
          ? securityGroupIds.join(", ")
          : undefined,
    },
    { label: "Public IP", value: publicIp },
    { label: "Private IP", value: privateIp },
    { label: "Public DNS", value: publicDns },
    { label: "Private DNS", value: privateDns },
    {
      label: "Availability Zones",
      value:
        availabilityZones && availabilityZones.length > 0
          ? availabilityZones.join(", ")
          : undefined,
    },
  ];

  return <DetailsCard title="Networking" entries={entries} />;
};

export default NetworkingSection;
