import React from "react";

interface Props {
  data: object;
}

export const NodeSidebar: React.FC<Props> = ({ data }) => {
  // compose your component here

  return <pre>{JSON.stringify(data, null, 2)}</pre>;
};

NodeSidebar.displayName = "NodeSidebar";
export default NodeSidebar;
