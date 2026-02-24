import React from "react";

// material-ui
import Table from "@mui/material/Table";
import { Chip } from "@omniviewdev/ui";
import Box from "@mui/material/Box";

// types
import { IngressBackend, IngressRule } from "kubernetes-types/networking/v1";
import { Text } from "@omniviewdev/ui/typography";
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
    <Table
      aria-label="rules table"
      sx={{
        "--TableCell-paddingY": "0rem",
      }}
    >
      <thead>
        <tr>
          <th style={{ height: "30px", paddingBottom: "6px" }}>Path</th>
          <th style={{ height: "30px", paddingBottom: "6px", width: "150px" }}>
            Type
          </th>
          <th style={{ height: "30px", paddingBottom: "6px" }}>Target</th>
        </tr>
      </thead>
      <tbody>
        {rule.http?.paths.map((path) => (
          <tr
            style={{
              padding: "0.5rem",
            }}
          >
            <td
              style={{
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                cursor: "pointer",
                height: "1.5rem",
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
          endAdornment={
            <Box sx={{ borderRadius: "sm", px: 1 }}>
              <Text size="xs">{backend.service.name}</Text>
            </Box>
          }
          sx={{ borderRadius: "sm", p: 0.25 }}
          size="sm"
          emphasis="outline"
          label={
            <Text size="xs" sx={{ px: 1 }}>
              {backend.service.port.number ?? backend.service.port.name}
            </Text>
          }
        />
      )
    );
  }
};

export default RuleTable;
