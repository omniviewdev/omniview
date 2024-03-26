import React from "react";

interface Props {
  data: object;
}

export const SecretSidebar: React.FC<Props> = ({ data }) => {
  // compose your component here

  return <pre>{JSON.stringify(data, null, 2)}</pre>;
};

SecretSidebar.displayName = "SecretSidebar";
export default SecretSidebar;
