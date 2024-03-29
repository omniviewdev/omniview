import React from "react";

// material-ui
import Table from "@mui/joy/Table";
import Chip from "@mui/joy/Chip";
import Sheet from "@mui/joy/Sheet";

// types
import { IngressBackend, IngressRule } from "kubernetes-types/networking/v1";
import { Typography } from "@mui/joy";
import { BrowserOpenURL } from "../../../../utils/ide";

interface Props {
  rule: IngressRule;
}

export const RuleTable: React.FC<Props> = ({ rule }) => {
  const handleLinkClick = (host?: string, path?: string) => {
    if (host) {
      const targetHost = host.startsWith("http") ? host : "https://" + host;
      const targetPath = path?.startsWith("/") ? path : "/" + path;
      BrowserOpenURL(targetHost + targetPath);
    }
  };

  return (
    <Table aria-label="rules table">
      <thead>
        <tr>
          <th>Path</th>
          <th style={{ width: "150px" }}>Type</th>
          <th>Target</th>
        </tr>
      </thead>
      <tbody>
        {rule.http?.paths.map((path) => (
          <tr>
            <td
              style={{
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                cursor: "pointer",
              }}
              onClick={() => handleLinkClick(rule.host, path.path)}
            >
              {path.path ?? "/"}
            </td>
            <td>{path.pathType}</td>
            <td>
              <IngressBackendChip backend={path.backend} />
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
};

const IngressBackendChip: React.FC<{ backend: IngressBackend }> = ({
  backend,
}) => {
  if (backend.service !== undefined) {
    return (
      backend.service.port && (
        <Chip
          startDecorator={
            <Sheet variant="soft" sx={{ borderRadius: "sm", px: 1 }}>
              <Typography level="body-sm">{backend.service.name}</Typography>
            </Sheet>
          }
          sx={{ borderRadius: "sm", p: 0.25 }}
          size="sm"
          variant="outlined"
        >
          <Typography level="body-sm" px={1}>
            {backend.service.port.number ?? backend.service.port.name}
          </Typography>
        </Chip>
      )
    );
  }
};

export default RuleTable;
