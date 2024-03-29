import React from "react";

// material-ui
import Grid from "@mui/joy/Grid";
import Stack from "@mui/joy/Stack";

// types
import { Container, ContainerStatus, Probe } from "kubernetes-types/core/v1";
import DetailsCard, { DetailsCardEntry } from "../../../shared/DetailsCard";

export interface Props {
  status?: ContainerStatus;
  container: Container;
}

const probeEntry = (probe: Probe) => {
  const probeData = [
    {
      key: "Probe",
      value: probe.httpGet?.path || probe.exec?.command?.join(" "),
      ratio: [8, 4],
    },
    {
      key: "Initial Delay",
      value: probe.initialDelaySeconds?.toString() || "0" + "s",
      ratio: [8, 4],
    },
    {
      key: "Timeout",
      value: probe.timeoutSeconds?.toString() + "s",
      ratio: [8, 4],
    },
    {
      key: "Period",
      value: probe.periodSeconds?.toString() + "s",
      ratio: [8, 4],
    },
    {
      key: "Success Threshold",
      value: probe.successThreshold?.toString(),
      ratio: [8, 4],
    },
    {
      key: "Failure Threshold",
      value: probe.failureThreshold?.toString(),
      ratio: [8, 4],
    },
  ] as DetailsCardEntry[];
  return probeData;
};

const ContainerSection: React.FC<Props> = (obj) => {
  const data = [
    {
      key: "Name",
      value: obj.container.name,
      icon: "LuBox",
      ratio: [3, 9],
    },
    {
      key: "Image",
      value: obj.container.image,
      icon: "LuImage",
      ratio: [3, 9],
    },
    {
      key: "Args",
      value: obj.container.args?.join(", ") || "N/A",
      icon: "LuTerminal",
      ratio: [3, 9],
    },
  ] as DetailsCardEntry[];

  const volumeMountsData = obj.container.volumeMounts?.map((volumeMount) => {
    return {
      key: volumeMount.name,
      icon: volumeMount.readOnly ? "LuLock" : "LuPencil",
      value:
        volumeMount.mountPath +
        (volumeMount.subPath ? `/${volumeMount.subPath}` : ""),
    } as DetailsCardEntry;
  });

  const portsData =
    obj.container.ports?.map((port) => {
      return {
        key: port.name || port.containerPort.toString(),
        value: port.containerPort.toString() + "/" + port.protocol,
        ratio: [4, 8],
      } as DetailsCardEntry;
    }) || [];

  const resourcesData = [
    {
      key: "CPU",
      value: `${obj.container.resources?.requests?.cpu || "None"} / ${obj.container.resources?.limits?.cpu || "None"}`,
      icon: "LuCpu",
    },
    {
      key: "Memory",
      value: `${obj.container.resources?.requests?.memory || "None"} / ${obj.container.resources?.limits?.memory || "None"}`,
      icon: "LuMemoryStick",
    },
    {
      key: "Storage",
      value: `${obj.container.resources?.requests?.ephemeralStorage || "None"} / ${obj.container.resources?.limits?.ephemeralStorage || "None"}`,
      icon: "LuHardDrive",
    },
  ] as DetailsCardEntry[];

  const numProbes =
    +!!obj.container.livenessProbe +
    +!!obj.container.readinessProbe +
    +!!obj.container.startupProbe;

  return (
    <Stack>
      <Grid container spacing={0.5}>
        <Grid xs={7}>
          <DetailsCard data={data} />
        </Grid>
        <Grid xs={5}>
          <DetailsCard data={resourcesData} />
        </Grid>
        {obj.container.readinessProbe && (
          <Grid xs={12 / numProbes}>
            <DetailsCard
              title="Readiness Probe"
              titleSize="sm"
              data={probeEntry(obj.container.readinessProbe)}
            />
          </Grid>
        )}
        {obj.container.livenessProbe && (
          <Grid xs={12 / numProbes}>
            <DetailsCard
              title="Liveness Probe"
              titleSize="sm"
              data={probeEntry(obj.container.livenessProbe)}
            />
          </Grid>
        )}
        {obj.container.startupProbe && (
          <Grid xs={12 / numProbes}>
            <DetailsCard
              title="Startup Probe"
              titleSize="sm"
              data={probeEntry(obj.container.startupProbe)}
            />
          </Grid>
        )}
        <Grid xs={12}>
          <DetailsCard
            title="Ports"
            icon="LuNetwork"
            titleSize="sm"
            data={portsData}
          />
        </Grid>
        {obj.container.env && (
          <Grid xs={12}>
            <DetailsCard
              title="Environment Variables"
              titleSize="sm"
              icon="LuKey"
              data={obj.container.env?.map((env) => {
                return {
                  key: env.name,
                  value: env.value,
                  ratio: [7, 5],
                } as DetailsCardEntry;
              })}
            />
          </Grid>
        )}
        {volumeMountsData && (
          <Grid xs={12}>
            <DetailsCard
              title="Volume Mounts"
              titleSize="sm"
              icon="LuHardDrive"
              data={volumeMountsData}
            />
          </Grid>
        )}
      </Grid>

      {/* <CodeEditor */}
      {/*   height="100vh" */}
      {/*   value={stringify({ obj })} */}
      {/*   language="yaml" */}
      {/*   filename="spec.yaml" */}
      {/* /> */}
    </Stack>
  );
};

export default ContainerSection;
