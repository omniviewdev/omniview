import React from "react";

// types
import { Namespace } from "kubernetes-types/core/v1";

// project-imports
import BaseOverviewPage from "../../../shared/sidebar/pages/overview/BaseOverviewPage";

interface Props {
  data: object;
}

/**
 * Renders a sidebar for a ConfigMap resource
 */
export const NamespaceSidebar: React.FC<Props> = ({ data }) => {
  if (!data) {
    return <React.Fragment />;
  }

  // assert this is a ConfigMap
  const obj = data as Namespace;

  // compose your component here
  return (
    <BaseOverviewPage data={obj} >
    </BaseOverviewPage>
  );
};

NamespaceSidebar.displayName = "NamespaceSidebar";
export default NamespaceSidebar;
