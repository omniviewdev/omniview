import React from "react";

// project imports
import ContainerSection, { Props as ContainerProps } from "./container";
import ExpandableSections from "../../../shared/ExpandableSections";

// types
import { Pod } from "kubernetes-types/core/v1";
import { logoMap } from "./logos";

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

const ContainersSection: React.FC<Props> = ({ obj }) => {
  return (
    <ExpandableSections
      sections={parseContainers(obj).map((container, idx) => ({
        title: container.container.name,
        icon: lookupLogo(container.container.name, container.container.image),
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
