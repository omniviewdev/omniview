import React from "react";
import { Stack, Typography } from "@mui/joy";
import MetadataSection from "../../../shared/sidebar/pages/overview/sections/MetadataSection";
import DetailsCard from "../../../shared/DetailsCard";
import ExpandableSection from "../../../shared/ExpandableSection";
import TagsSection from "../sections/TagsSection";

interface Props {
  ctx: { data?: Record<string, any> };
}

const VPCSidebar: React.FC<Props> = ({ ctx }) => {
  const data = ctx.data || {};

  const ipv6Associations: Array<Record<string, any>> = Array.isArray(
    data?.Ipv6CidrBlockAssociationSet
  )
    ? data.Ipv6CidrBlockAssociationSet
    : [];

  const cidrAssociations: Array<Record<string, any>> = Array.isArray(
    data?.CidrBlockAssociationSet
  )
    ? data.CidrBlockAssociationSet
    : [];

  return (
    <Stack direction="column" width="100%" spacing={1}>
      <MetadataSection data={data} />

      <DetailsCard
        title="VPC Details"
        entries={[
          { label: "VPC ID", value: data?.VpcId },
          { label: "CIDR Block", value: data?.CidrBlock },
          { label: "State", value: data?.State },
          { label: "Default", value: data?.IsDefault },
          { label: "Tenancy", value: data?.InstanceTenancy },
          { label: "DHCP Options ID", value: data?.DhcpOptionsId },
          { label: "Owner ID", value: data?.OwnerId },
        ]}
      />

      {ipv6Associations.length > 0 && (
        <DetailsCard
          title="IPv6"
          entries={ipv6Associations.map((assoc, i) => ({
            label: `CIDR ${i + 1}`,
            value: assoc.Ipv6CidrBlock
              ? `${assoc.Ipv6CidrBlock} (${assoc.Ipv6CidrBlockState?.State || "unknown"})`
              : undefined,
          }))}
        />
      )}

      {cidrAssociations.length > 1 && (
        <ExpandableSection
          sections={[
            {
              title: "CIDR Blocks",
              count: cidrAssociations.length,
              defaultExpanded: false,
              content: (
                <Stack spacing={0.5}>
                  {cidrAssociations.map((assoc, i) => (
                    <Typography key={i} level="body-sm">
                      {assoc.CidrBlock || "—"}{" "}
                      ({assoc.CidrBlockState?.State || "unknown"})
                    </Typography>
                  ))}
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

export default VPCSidebar;
