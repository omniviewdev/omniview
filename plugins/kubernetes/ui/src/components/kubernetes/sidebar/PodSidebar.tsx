import React from "react";

interface Props {
  data: object;
}

export const PodSidebar: React.FC<Props> = ({ data }) => {
  // compose your component here

  return <pre>{JSON.stringify(data, null, 2)}</pre>;
};

PodSidebar.displayName = "PodSidebar";
export default PodSidebar;
