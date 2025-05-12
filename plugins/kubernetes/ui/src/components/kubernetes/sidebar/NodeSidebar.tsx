import React from "react";

// material-ui
import Stack from "@mui/joy/Stack";
import Table from "@mui/joy/Table";
import Chip from '@mui/joy/Chip';

// types
import { Node } from "kubernetes-types/core/v1";

// project-imports
import ObjectMetaSection from "../../shared/ObjectMetaSection";
import CommonCard from "../../shared/Card";
import { Avatar, Card, CardContent, CardOverflow, Grid, Typography } from "@mui/joy";
import DynamicIcon from "../../../stories/components/DynamicIcon";
import { convertKubernetesByteUnits } from "../../../utils/convert";

interface Props {
  data: object;
}

export const NodeSidebar: React.FC<Props> = ({ data }) => {
  const node = data as Node;

  // compose your component here
  return (
    <Stack direction="column" width={"100%"} spacing={1}>
      <ObjectMetaSection data={node.metadata} />
      <div>
        <Grid container spacing={0.5}>
          <Grid xs={5}>
            <HardwareInfo node={node} />
          </Grid>
          <Grid xs={7}>
            <OSInfo node={node} />
          </Grid>
          <Grid xs={5}>
            <TopologyInfo node={node} />
          </Grid>
          <Grid xs={7}>
            <KubernetesInfo node={node} />
          </Grid>
          <Grid xs={12}>
            <EndpointsInfo node={node} />
          </Grid>
          <Grid xs={12}>
            <ResourcesInfo node={node} />
          </Grid>
          {node?.metadata?.labels?.["karpenter.sh/initialized"] && (
            <Grid xs={12}>
              <KarpenterInfo node={node} />
            </Grid>
          )}
          <Grid xs={12}>
            <ImagesInfo node={node} />
          </Grid>
        </Grid>
      </div>
      {/* <pre>{JSON.stringify(data, null, 2)}</pre>; */}
    </Stack>
  );
};

function findValueByKeys<T>(obj: T, keys: string[]): string {
  for (const key of keys) {
    /* eslint-disable */
    let currentObject: any = obj;
    const keyParts = key.split(".");
    let found = true;

    for (let part of keyParts) {
      if (
        currentObject &&
        typeof currentObject === "object" &&
        part in currentObject
      ) {
        currentObject = currentObject[part];
      } else {
        found = false;
        break;
      }
    }

    if (found) {
      // Ensuring the found value is a string before returning it.
      // If the value is not a string, you might want to return a string representation or handle it differently
      return typeof currentObject === "string" ? currentObject : "";
    }
  }
  return "";
}

interface NodeInfoSectionProps {
  node: Node;
}

const ResourcesInfo: React.FC<NodeInfoSectionProps> = ({ node }) => {
  const data = [
    {
      name: "Capacity",
      cpu: node.status?.capacity?.cpu,
      memory: node.status?.capacity?.memory,
      ephemeralStorage: node.status?.capacity?.["ephemeral-storage"],
      pods: node.status?.capacity?.pods,
      hugepages1Gi: node.status?.capacity?.["hugepages-1Gi"],
      hugepages2Mi: node.status?.capacity?.["hugepages-2Mi"],
    },
    {
      name: "Allocatable",
      cpu: node.status?.allocatable?.cpu,
      memory: node.status?.allocatable?.memory,
      ephemeralStorage: node.status?.allocatable?.["ephemeral-storage"],
      pods: node.status?.allocatable?.pods,
      hugepages1Gi: node.status?.allocatable?.["hugepages-1Gi"],
      hugepages2Mi: node.status?.allocatable?.["hugepages-2Mi"],
    },
  ];

  return (
    <CommonCard title="Resources" icon="LuServer">
      <Table aria-label="resources table">
        <thead>
          <tr style={{ height: 30 }}>
            <th style={{ width: "100px" }}></th>
            <th style={{ fontSize: 12 }}>CPU</th>
            <th style={{ fontSize: 12 }}>Memory</th>
            <th style={{ fontSize: 12 }}>Ephemeral Storage</th>
            <th style={{ fontSize: 12 }}>Pods</th>
            <th style={{ fontSize: 12 }}>Hugepages 1Gi</th>
            <th style={{ fontSize: 12 }}>Hugepages 2Mi</th>
          </tr>
        </thead>
        <tbody>
          {data.map((entry) => (
            <tr>
              <td>{entry.name}</td>
              <td>{entry.cpu}</td>
              <td>
                {convertKubernetesByteUnits({
                  from: entry.memory || "",
                  to: "GB",
                })}
              </td>
              <td>
                {convertKubernetesByteUnits({
                  from: entry.ephemeralStorage || "",
                  to: "GB",
                })}
              </td>
              <td>{entry.pods}</td>
              <td>{entry.hugepages1Gi}</td>
              <td>{entry.hugepages2Mi}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </CommonCard>
  );
};

const HardwareInfo: React.FC<NodeInfoSectionProps> = ({ node }) => {
  const data = [
    {
      key: "CPUs",
      value: node.status?.capacity?.cpu,
      icon: "LuCpu",
      ratio: [6.5, 5.5],
    },
    {
      key: "Memory",
      value: convertKubernetesByteUnits({
        from: findValueByKeys(node, ["status.capacity.memory"]),
        to: "GB",
      }),
      icon: "LuMemoryStick",
      ratio: [6.5, 5.5],
    },
    {
      key: "Architecture",
      value: findValueByKeys(node, ["status.nodeInfo.architecture"]),
      icon: "LuPuzzle",
      ratio: [6.5, 5.5],
    },
    {
      key: "Storage",
      value: convertKubernetesByteUnits({
        from: findValueByKeys(node, ["status.capacity.ephemeral-storage"]),
        to: "GB",
      }),
      icon: "LuHardDrive",
      ratio: [6.5, 5.5],
    },
  ] as DetailsCardEntry[];
  return <DetailsCard title="Hardware" icon="LuComputer" data={data} />;
};

const OSInfo: React.FC<NodeInfoSectionProps> = ({ node }) => {
  const data = [
    {
      key: "Platform",
      value: findValueByKeys(node, ["status.nodeInfo.operatingSystem"]),
      icon: "LuCog",
    },
    {
      key: "Kernel Version",
      value: findValueByKeys(node, ["status.nodeInfo.kernelVersion"]),
      icon: "LuNut",
    },
    {
      key: "OS Image",
      value: findValueByKeys(node, ["status.nodeInfo.osImage"]),
      icon: "LuImage",
    },
    {
      key: "Boot ID",
      value: findValueByKeys(node, ["status.nodeInfo.bootID"]),
      icon: "LuKey",
    },
  ] as DetailsCardEntry[];
  return <DetailsCard title="OS" icon="LuCog" data={data} />;
};

const TopologyInfo: React.FC<NodeInfoSectionProps> = ({ node }) => {
  const data = [
    {
      key: "Cloud",
      value: findValueByKeys(node, ["spec.providerID"]).split(":")[0] || "",
      icon: "LuCloud",
      ratio: [6.5, 5.5],
    },
    {
      key: "Region",
      value: node.metadata?.labels?.["topology.kubernetes.io/region"] || "",
      icon: "LuMap",
      ratio: [6.5, 5.5],
    },
    {
      key: "Zone",
      value: node.metadata?.labels?.["topology.kubernetes.io/zone"] || "",
      icon: "LuMapPin",
      ratio: [6.5, 5.5],
    },
    {
      key: "Instance",
      value: node.metadata?.labels?.["node.kubernetes.io/instance-type"] || "",
      icon: "LuHammer",
      ratio: [6.5, 5.5],
    },
  ] as DetailsCardEntry[];
  return <DetailsCard title="Topology" icon="LuGlobe2" data={data} />;
};

const KubernetesInfo: React.FC<NodeInfoSectionProps> = ({ node }) => {
  const data = [
    {
      key: "Kubelet",
      value: findValueByKeys(node, ["status.nodeInfo.kubeletVersion"]),
    },
    {
      key: "Kube Proxy",
      value: findValueByKeys(node, ["status.nodeInfo.kubeProxyVersion"]),
    },
    {
      key: "Container Runtime",
      value: findValueByKeys(node, ["status.nodeInfo.containerRuntimeVersion"]),
    },
    {
      key: "Pod Limit",
      value: findValueByKeys(node, ["status.allocatable.pods"]),
    },
  ] as DetailsCardEntry[];
  return <DetailsCard title="Kubernetes" icon="SiKubernetes" data={data} />;
};

const ImagesInfo: React.FC<NodeInfoSectionProps> = ({ node }) => {
  const totalSize = node?.status?.images?.reduce((prev, curr) => {
    const additional = curr.sizeBytes ? curr.sizeBytes : 0
    return prev + additional
  }, 0)

  const data = node?.status?.images?.map((image) => {
    const entries: Array<DetailsCardEntry> = []
    image.names?.forEach((name) => {
      entries.push({
        key: name,
        value: convertKubernetesByteUnits({
          from: `${image.sizeBytes}B`,
          to: "MB",
        }),
        ratio: [10, 2],
      })
    })

    // return {
    //   key: image.names?.find((name) => !name.includes("sha256")),
    //   value: convertKubernetesByteUnits({
    //     from: `${image.sizeBytes}B`,
    //     to: "MB",
    //   }),
    //   ratio: [10, 2],
    // };

    return entries
  }).flat() as DetailsCardEntry[];

  return <DetailsCard
    endAdornment={<Chip variant="soft">{
      convertKubernetesByteUnits({
        from: `${totalSize}B`,
        to: "MB",
      })}</Chip>}
    title="Images"
    icon="LuLayers"
    data={data}
  />;
};

const EndpointsInfo: React.FC<NodeInfoSectionProps> = ({ node }) => {
  const data = node?.status?.addresses?.map((address) => {
    return {
      key: address.type,
      value: address.address,
    };
  }) as DetailsCardEntry[];
  return <DetailsCard title="Endpoints" icon="LuNetwork" data={data} />;
};

const KarpenterInfo: React.FC<NodeInfoSectionProps> = ({ node }) => {
  const data = [
    {
      key: "Instance Family",
      value: node.metadata?.labels?.["karpenter.k8s.aws/instance-family"],
    },
    {
      key: "Instance Size",
      value: node.metadata?.labels?.["karpenter.k8s.aws/instance-size"],
    },
    {
      key: "Hypervisor",
      value: node.metadata?.labels?.["karpenter.k8s.aws/instance-hypervisor"],
    },
    {
      key: "Network Bandwidth",
      value:
        node.metadata?.labels?.["karpenter.k8s.aws/instance-network-bandwidth"],
    },
    {
      key: "Encryption In Transit",
      value:
        node.metadata?.labels?.[
        "karpenter.k8s.aws/instance-encryption-in-transit-supported"
        ],
    },
    {
      key: "Capacity Type",
      value: node.metadata?.labels?.["karpenter.sh/capacity-type"],
    },
    {
      key: "Provisioner",
      value: node.metadata?.labels?.["karpenter.sh/provisioner-name"],
    },
  ] as DetailsCardEntry[];
  return (
    <DetailsCard
      title="Karpenter"
      icon="https://d3g9o9u8re44ak.cloudfront.net/logo/55cad6f2-84cb-49a7-9d60-265f7e4ea91e/8a67fa7b-85bd-44e4-823c-d7d5690777b1.png"
      data={data}
    />
  );
};

interface DetailsCardEntry {
  key: string;
  value: string;
  icon?: string | React.ReactNode;
  ratio?: [number, number];
  used?: string;
}

interface DetailsCardProps {
  title: string;
  icon: string | React.ReactNode;
  data: DetailsCardEntry[];
  endAdornment?: React.ReactNode;
}

const DetailsCard: React.FC<DetailsCardProps> = ({ title, icon, data, endAdornment }) => {
  return (
    <Card
      variant="outlined"
      sx={{
        bgcolor: 'background.level1'
      }}
    >
      <CardOverflow sx={{ p: 1, display: 'flex', flexDirection: 'row', justifyContent: 'space-between', bgcolor: 'background.surface', borderBottom: '1px solid divider' }}>
        <Stack direction="row" spacing={1} alignItems={"center"}>
          {typeof icon === "string" ? (
            icon.startsWith("http") ? (
              <Avatar
                src={icon}
                size="sm"
                sx={{ maxHeight: 16, maxWidth: 16, borderRadius: 4 }}
              />
            ) : (
              <DynamicIcon name={icon} size={14} />
            )
          ) : (
            icon
          )}
          <Typography level="title-sm">{title}</Typography>
        </Stack>
        {endAdornment}
      </CardOverflow>
      <CardContent>
        <Grid container spacing={1}>
          {data.map((entry) => (
            <>
              <Grid xs={entry.ratio?.[0] ?? 5}>
                <Stack direction="row" spacing={1} alignItems={"center"}>
                  {entry.icon &&
                    (typeof entry.icon === "string" ? (
                      entry.icon.startsWith("http") ? (
                        <Avatar src={entry.icon} size="sm" />
                      ) : (
                        <DynamicIcon name={entry.icon} size={14} />
                      )
                    ) : (
                      icon
                    ))}
                  <Typography level="body-xs">{entry.key}</Typography>
                </Stack>
              </Grid>
              <Grid xs={entry.ratio?.[1] ?? 7}>
                <Typography textColor={"neutral.300"} level="body-xs" noWrap>
                  {!!entry.used
                    ? `${entry.used} / ${entry.value}`
                    : entry.value}
                </Typography>
              </Grid>
            </>
          ))}
        </Grid>
      </CardContent>
    </Card>
  );
};

NodeSidebar.displayName = "NodeSidebar";
export default NodeSidebar;
