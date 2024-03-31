import React from "react";

// project imports
import ContainerSection, { Props as ContainerProps } from "./container";
import ExpandableSections from "../../../shared/ExpandableSections";

// types
import { ContainerStatus, Pod } from "kubernetes-types/core/v1";
import { logoMap } from "./logos";
import { ContainerStatusDecorator } from "./ContainerStatuses";
import { Alert, Stack } from "@mui/joy";
import { LuAlertCircle } from "react-icons/lu";

interface Props {
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
          startDecorator={<LuAlertCircle size={16} />}
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

const ContainersSection: React.FC<Props> = ({ obj }) => {
  return (
    <ExpandableSections
      sections={parseContainers(obj).map((container, idx) => ({
        title: container.container.name,
        icon: lookupLogo(container.container.name, container.container.image),
        endDecorator: <ContainerHeaderDecorator status={container.status} />,
        defaultExpanded: idx === 0,
        children: <ContainerSection {...container} />,
      }))}
    />
  );
};

function parseContainers(pod: Pod) {
  const containers = {} as Record<string, ContainerProps>;

  pod.spec?.containers?.forEach((container) => {
    containers[container.name] = {
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
