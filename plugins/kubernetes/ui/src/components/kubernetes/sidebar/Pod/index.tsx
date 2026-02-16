import React from "react";

// types
import { Pod } from "kubernetes-types/core/v1";

import ContainersSection from "./containers";
import BaseOverviewPage from "../../../shared/sidebar/pages/overview/BaseOverviewPage";
import { DrawerContext } from "@omniviewdev/runtime";

interface Props {
  ctx: DrawerContext<Pod>
}

export const PodSidebar: React.FC<Props> = ({ ctx }) => {
  if (!ctx.data) {
    return <></>
  }

  return (
    <BaseOverviewPage data={ctx.data} >
      <ContainersSection resourceID={ctx.resource?.id || ''} connectionID={ctx.resource?.connectionID || ''} obj={ctx.data} />
    </BaseOverviewPage>
  );
};

PodSidebar.displayName = "PodSidebar";
export default PodSidebar;
