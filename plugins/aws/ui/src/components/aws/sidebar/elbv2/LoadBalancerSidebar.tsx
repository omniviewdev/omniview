import React from "react";
import { Stack } from "@mui/joy";
import MetadataSection from "../../../shared/sidebar/pages/overview/sections/MetadataSection";
import DetailsCard from "../../../shared/DetailsCard";
import ExpandableSection from "../../../shared/ExpandableSection";
import NetworkingSection from "../sections/NetworkingSection";
import TagsSection from "../sections/TagsSection";

interface Props {
  ctx: { data?: Record<string, any> };
}

function getStateColor(
  code: string | undefined
): "success" | "warning" | "danger" | undefined {
  if (!code) return undefined;
  const c = code.toLowerCase();
  if (c === "active") return "success";
  if (c === "provisioning") return "warning";
  if (c === "failed" || c === "active_impaired") return "danger";
  return undefined;
}

const LoadBalancerSidebar: React.FC<Props> = ({ ctx }) => {
  const data = ctx.data || {};

  const stateCode = data?.State?.Code;

  // Extract AZ names from AvailabilityZones array
  const azs: string[] = Array.isArray(data?.AvailabilityZones)
    ? data.AvailabilityZones.map(
        (az: { ZoneName?: string }) => az.ZoneName
      ).filter((z: string | undefined): z is string => !!z)
    : [];

  const securityGroups = Array.isArray(data?.SecurityGroups)
    ? data.SecurityGroups
    : [];

  const availabilityZones = Array.isArray(data?.AvailabilityZones)
    ? data.AvailabilityZones
    : [];

  const hasDetailedAZs =
    availabilityZones.length > 0 &&
    availabilityZones.some(
      (az: { SubnetId?: string; LoadBalancerAddresses?: unknown[] }) =>
        az.SubnetId || (Array.isArray(az.LoadBalancerAddresses) && az.LoadBalancerAddresses.length > 0)
    );

  return (
    <Stack direction="column" width="100%" spacing={1}>
      <MetadataSection data={data} />

      <DetailsCard
        title="Load Balancer Info"
        entries={[
          { label: "Name", value: data?.LoadBalancerName },
          { label: "Type", value: data?.Type },
          { label: "Scheme", value: data?.Scheme },
          { label: "DNS Name", value: data?.DNSName },
          {
            label: "State",
            value: stateCode,
            color: getStateColor(stateCode),
          },
          { label: "IP Address Type", value: data?.IpAddressType },
          { label: "ARN", value: data?.LoadBalancerArn },
          {
            label: "Created",
            value: data?.CreatedTime ? String(data.CreatedTime) : undefined,
          },
          { label: "Hosted Zone", value: data?.CanonicalHostedZoneId },
        ]}
      />

      <NetworkingSection
        vpcId={data?.VpcId}
        availabilityZones={azs}
        securityGroupIds={securityGroups}
      />

      {hasDetailedAZs && (
        <ExpandableSection
          sections={[
            {
              title: "Availability Zones",
              count: availabilityZones.length,
              defaultExpanded: false,
              content: (
                <Stack spacing={1}>
                  {availabilityZones.map(
                    (
                      az: {
                        ZoneName?: string;
                        SubnetId?: string;
                        LoadBalancerAddresses?: Array<{
                          IpAddress?: string;
                          AllocationId?: string;
                        }>;
                      },
                      i: number
                    ) => (
                      <DetailsCard
                        key={i}
                        title={az.ZoneName || `AZ ${i + 1}`}
                        entries={[
                          { label: "Subnet", value: az.SubnetId },
                          ...(Array.isArray(az.LoadBalancerAddresses)
                            ? az.LoadBalancerAddresses.map(
                                (
                                  addr: {
                                    IpAddress?: string;
                                    AllocationId?: string;
                                  },
                                  j: number
                                ) => ({
                                  label: `Address ${j + 1}`,
                                  value: addr.IpAddress || addr.AllocationId,
                                })
                              )
                            : []),
                        ]}
                      />
                    )
                  )}
                </Stack>
              ),
            },
          ]}
        />
      )}

      <TagsSection data={data} />
    </Stack>
  );
};

export default LoadBalancerSidebar;
