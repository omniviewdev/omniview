import React from "react";

// types
import { Pod } from "kubernetes-types/core/v1";

import ContainersSection from "./containers";
import BaseOverviewPage from "../../../shared/sidebar/pages/overview/BaseOverviewPage";

interface Props {
  data?: Pod;
}

export const PodSidebar: React.FC<Props> = ({ data }) => {
  if (!data) {
    return <></>
  }

  return (
    <BaseOverviewPage data={data} >
      <ContainersSection obj={data} />
    </BaseOverviewPage>
  );
};

PodSidebar.displayName = "PodSidebar";
export default PodSidebar;
