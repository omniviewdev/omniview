import React from "react";
import { Chip, Stack, Typography } from "@mui/joy";
import MetadataSection from "../../../shared/sidebar/pages/overview/sections/MetadataSection";
import DetailsCard from "../../../shared/DetailsCard";
import ExpandableSection from "../../../shared/ExpandableSection";
import NetworkingSection from "../sections/NetworkingSection";
import TagsSection from "../sections/TagsSection";

interface Props {
  ctx: { data?: Record<string, any> };
}

function getStatusColor(
  status: string | undefined
): "success" | "warning" | "danger" | undefined {
  if (!status) return undefined;
  const s = status.toLowerCase();
  if (s === "active") return "success";
  if (s === "creating" || s === "pending" || s === "updating") return "warning";
  if (s === "failed" || s === "deleting") return "danger";
  return undefined;
}

const ClusterSidebar: React.FC<Props> = ({ ctx }) => {
  const data = ctx.data || {};
  const vpcConfig = data?.ResourcesVpcConfig || {};

  const hasKubernetesNetworkConfig = !!data?.KubernetesNetworkConfig;
  const hasEncryptionConfig =
    Array.isArray(data?.EncryptionConfig) && data.EncryptionConfig.length > 0;
  const clusterLogging = data?.Logging?.ClusterLogging;
  const hasLogging = Array.isArray(clusterLogging) && clusterLogging.length > 0;

  return (
    <Stack direction="column" width="100%" spacing={1}>
      <MetadataSection data={data} />

      <DetailsCard
        title="Cluster Info"
        entries={[
          { label: "Name", value: data?.Name },
          { label: "Version", value: data?.Version },
          { label: "Platform Version", value: data?.PlatformVersion },
          {
            label: "Status",
            value: data?.Status,
            color: getStatusColor(data?.Status),
          },
          { label: "Endpoint", value: data?.Endpoint },
          { label: "Role ARN", value: data?.RoleArn },
          {
            label: "Created At",
            value: data?.CreatedAt ? String(data.CreatedAt) : undefined,
          },
          { label: "OIDC Issuer", value: data?.Identity?.Oidc?.Issuer },
        ]}
      />

      <DetailsCard
        title="Endpoint Access"
        entries={[
          {
            label: "Public Access",
            value: data?.ResourcesVpcConfig?.EndpointPublicAccess,
          },
          {
            label: "Private Access",
            value: data?.ResourcesVpcConfig?.EndpointPrivateAccess,
          },
          {
            label: "Public CIDRs",
            value: Array.isArray(
              data?.ResourcesVpcConfig?.PublicAccessCidrs
            )
              ? data.ResourcesVpcConfig.PublicAccessCidrs.join(", ")
              : undefined,
          },
        ]}
      />

      {hasKubernetesNetworkConfig && (
        <DetailsCard
          title="Kubernetes Network"
          entries={[
            {
              label: "Service CIDR",
              value: data?.KubernetesNetworkConfig?.ServiceIpv4Cidr,
            },
            {
              label: "IP Family",
              value: data?.KubernetesNetworkConfig?.IpFamily,
            },
          ]}
        />
      )}

      {hasEncryptionConfig && (
        <DetailsCard
          title="Encryption"
          entries={[
            {
              label: "KMS Key",
              value: data?.EncryptionConfig?.[0]?.Provider?.KeyArn,
            },
            {
              label: "Resources",
              value: Array.isArray(data?.EncryptionConfig?.[0]?.Resources)
                ? data.EncryptionConfig[0].Resources.join(", ")
                : undefined,
            },
          ]}
        />
      )}

      <NetworkingSection
        vpcId={vpcConfig?.VpcId}
        subnetIds={vpcConfig?.SubnetIds}
        securityGroupIds={[
          ...(vpcConfig?.SecurityGroupIds || []),
          ...(vpcConfig?.ClusterSecurityGroupId
            ? [vpcConfig.ClusterSecurityGroupId]
            : []),
        ]}
      />

      {hasLogging && (
        <ExpandableSection
          sections={[
            {
              title: "Logging",
              defaultExpanded: false,
              content: (
                <Stack spacing={0.5}>
                  {clusterLogging.map(
                    (
                      entry: { Types?: string[]; Enabled?: boolean },
                      i: number
                    ) => (
                      <Stack key={i} direction="row" spacing={1} alignItems="center">
                        <Typography level="body-xs" fontFamily="monospace">
                          {Array.isArray(entry?.Types)
                            ? entry.Types.join(", ")
                            : "Unknown"}
                        </Typography>
                        <Chip
                          size="sm"
                          variant="soft"
                          color={entry?.Enabled ? "success" : "neutral"}
                          sx={{ borderRadius: "sm" }}
                        >
                          {entry?.Enabled ? "Enabled" : "Disabled"}
                        </Chip>
                      </Stack>
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

export default ClusterSidebar;
