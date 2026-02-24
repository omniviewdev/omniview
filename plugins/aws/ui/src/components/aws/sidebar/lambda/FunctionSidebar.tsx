import React from "react";
import { Stack } from "@omniviewdev/ui/layout";
import { Text } from "@omniviewdev/ui/typography";
import MetadataSection from "../../../shared/sidebar/pages/overview/sections/MetadataSection";
import DetailsCard from "../../../shared/DetailsCard";
import ExpandableSection from "../../../shared/ExpandableSection";
import StatusSection from "../sections/StatusSection";
import NetworkingSection from "../sections/NetworkingSection";
import TagsSection from "../sections/TagsSection";

interface Props {
  ctx: { data?: Record<string, any> };
}

function formatBytes(bytes: number | undefined): string | undefined {
  if (bytes === undefined || bytes === null) return undefined;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const FunctionSidebar: React.FC<Props> = ({ ctx }) => {
  const data = ctx.data || {};

  const vpcConfig = data?.VpcConfig;
  const hasVpc = vpcConfig?.VpcId;

  const envVars = data?.Environment?.Variables;
  const envKeys = envVars ? Object.keys(envVars) : [];

  const layers = Array.isArray(data?.Layers) ? data.Layers : [];

  const architectures = Array.isArray(data?.Architectures)
    ? data.Architectures.join(", ")
    : data?.Architectures;

  const hasErrorHandling =
    !!data?.DeadLetterConfig?.TargetArn || !!data?.LastUpdateStatus;

  const fileSystemConfigs = Array.isArray(data?.FileSystemConfigs)
    ? data.FileSystemConfigs
    : [];

  return (
    <Stack direction="column" width="100%" spacing={1}>
      <MetadataSection data={data} />

      <StatusSection value={data?.State} />

      <DetailsCard
        title="Function Config"
        entries={[
          { label: "Function Name", value: data?.FunctionName },
          { label: "Runtime", value: data?.Runtime },
          { label: "Handler", value: data?.Handler },
          {
            label: "Memory Size",
            value: data?.MemorySize ? `${data.MemorySize} MB` : undefined,
          },
          {
            label: "Timeout",
            value: data?.Timeout ? `${data.Timeout} s` : undefined,
          },
          { label: "Code Size", value: formatBytes(data?.CodeSize) },
          { label: "Architectures", value: architectures },
          { label: "Package Type", value: data?.PackageType },
          {
            label: "Ephemeral Storage",
            value: data?.EphemeralStorage?.Size
              ? `${data.EphemeralStorage.Size} MB`
              : undefined,
          },
          { label: "Last Modified", value: data?.LastModified },
        ]}
      />

      <DetailsCard
        title="Security & Tracing"
        entries={[
          { label: "Role", value: data?.Role },
          { label: "X-Ray Tracing", value: data?.TracingConfig?.Mode },
          { label: "KMS Key", value: data?.KMSKeyArn },
        ]}
      />

      {hasErrorHandling && (
        <DetailsCard
          title="Error Handling"
          entries={[
            {
              label: "Dead Letter Queue",
              value: data?.DeadLetterConfig?.TargetArn,
            },
            {
              label: "Last Update Status",
              value: data?.LastUpdateStatus,
              color:
                data?.LastUpdateStatus === "Successful"
                  ? "success"
                  : data?.LastUpdateStatus === "Failed"
                    ? "danger"
                    : "warning",
            },
            {
              label: "Update Reason",
              value: data?.LastUpdateStatusReason,
            },
          ]}
        />
      )}

      {hasVpc && (
        <NetworkingSection
          vpcId={vpcConfig?.VpcId}
          subnetIds={vpcConfig?.SubnetIds}
          securityGroupIds={vpcConfig?.SecurityGroupIds}
        />
      )}

      <ExpandableSection
        sections={[
          ...(envKeys.length > 0
            ? [
                {
                  title: "Environment Variables",
                  count: envKeys.length,
                  defaultExpanded: false,
                  content: (
                    <Stack spacing={0.5}>
                      {envKeys.map((key) => (
                        <Text key={key} size="xs" sx={{ fontFamily: "monospace" }}>
                          {key}
                        </Text>
                      ))}
                    </Stack>
                  ),
                },
              ]
            : []),
          ...(layers.length > 0
            ? [
                {
                  title: "Layers",
                  count: layers.length,
                  defaultExpanded: false,
                  content: (
                    <Stack spacing={0.5}>
                      {layers.map(
                        (layer: { Arn?: string }, i: number) => (
                          <Text
                            key={i}
                            size="xs"
                            sx={{ fontFamily: "monospace", wordBreak: "break-all" }}
                          >
                            {layer?.Arn || `Layer ${i + 1}`}
                          </Text>
                        )
                      )}
                    </Stack>
                  ),
                },
              ]
            : []),
          ...(fileSystemConfigs.length > 0
            ? [
                {
                  title: "EFS Mounts",
                  count: fileSystemConfigs.length,
                  defaultExpanded: false,
                  content: (
                    <Stack spacing={0.5}>
                      {fileSystemConfigs.map(
                        (
                          config: {
                            Arn?: string;
                            LocalMountPath?: string;
                          },
                          i: number
                        ) => (
                          <Stack key={i} spacing={0.25}>
                            <Text
                              size="xs"
                              sx={{ fontFamily: "monospace", wordBreak: "break-all" }}
                            >
                              {config?.Arn || `EFS ${i + 1}`}
                            </Text>
                            {config?.LocalMountPath && (
                              <Text size="xs" color="neutral">
                                Mount: {config.LocalMountPath}
                              </Text>
                            )}
                          </Stack>
                        )
                      )}
                    </Stack>
                  ),
                },
              ]
            : []),
        ]}
      />

      <TagsSection data={data} />
    </Stack>
  );
};

export default FunctionSidebar;
