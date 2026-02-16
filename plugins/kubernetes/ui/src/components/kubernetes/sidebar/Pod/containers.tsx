import React from "react";

// project imports
import ContainerSection, { Props as ContainerProps } from "./container";
import ExpandableSections from "../../../shared/ExpandableSections";

// types
import { ContainerStatus, Pod, PodSpec } from "kubernetes-types/core/v1";
import { logoMap } from "./logos";
import { ContainerStatusDecorator } from "./ContainerStatuses";
import { Alert, Stack } from "@mui/joy";
import { LuCircleAlert } from "react-icons/lu";

interface Props {
  resourceID: string;
  connectionID: string;
  obj: Pod;
}

const lookupLogo = (containerName?: string, image?: string) => {
  if (!image && !containerName) {
    return "LuBox";
  }
  // try the container name first
  if (containerName && logoMap[containerName]) {
    return logoMap[containerName];
  }

  if (image) {
    const [name] = image.split(":");
    return (
      logoMap[name] ||
      logoMap[name.split("/")[name.split("/").length - 1]] ||
      "LuBox"
    );
  }
  return "LuBox";
};

const ContainerHeaderDecorator: React.FC<{ status?: ContainerStatus }> = ({
  status,
}) => {
  if (!status) {
    return null;
  }

  return (
    <Stack direction="row" spacing={1}>
      {!!status.restartCount && (
        <Alert
          variant="soft"
          startDecorator={<LuCircleAlert size={16} />}
          color="warning"
          sx={{ height: "18px", py: 0.1 }}
          size="sm"
        >
          Container Restarts: {status.restartCount}
        </Alert>
      )}
      <ContainerStatusDecorator status={status} />
    </Stack>
  );
};

const ContainersSection: React.FC<Props> = ({ obj, connectionID }) => {
  return (
    <ExpandableSections
      sections={parseContainers(obj, obj.metadata?.name || '', connectionID).map((container, idx) => ({
        title: container.container.name,
        icon: lookupLogo(container.container.name, container.container.image),
        endDecorator: <ContainerHeaderDecorator status={container.status} />,
        defaultExpanded: idx === 0,
        children: <ContainerSection {...container} />,
      }))}
    />
  );
};

export const ContainersSectionFromPodSpec: React.FC<{ resourceID: string, connectionID: string, spec?: PodSpec }> = ({
  spec,
  resourceID,
  connectionID,
}) => {
  const sections =
    spec?.containers.map((container, idx) => ({
      title: container.name,
      icon: lookupLogo(container.name, container.image),
      defaultExpanded: idx === 0,
      children: <ContainerSection resourceID={resourceID} connectionID={connectionID} container={container} />,
    })) || [];

  return <ExpandableSections sections={sections} />;
};

function parseContainers(pod: Pod, resourceID: string, connectionID: string) {
  const containers = {} as Record<string, ContainerProps>;

  pod.spec?.containers?.forEach((container) => {
    containers[container.name] = {
      resourceID,
      connectionID,
      container: container,
      status: undefined,
    };
  });

  pod.status?.containerStatuses?.forEach((containerStatus) => {
    containers[containerStatus.name].status = containerStatus;
  });

  return Object.values(containers);
}

export default ContainersSection;
