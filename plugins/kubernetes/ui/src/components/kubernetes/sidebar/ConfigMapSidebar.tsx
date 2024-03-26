import React from "react";

interface Props {
  data: object;
}

export const ConfigMapSidebar: React.FC<Props> = ({ data }) => {
  // compose your component here

  return <pre>{JSON.stringify(data, null, 2)}</pre>;
};

ConfigMapSidebar.displayName = "ConfigMapSidebar";
export default ConfigMapSidebar;
