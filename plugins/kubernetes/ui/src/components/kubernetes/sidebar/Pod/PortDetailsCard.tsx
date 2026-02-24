import React from "react";
import Box from "@mui/material/Box";
import Grid from "@mui/material/Grid";
import Popover from "@mui/material/Popover";
import { Avatar, Chip } from "@omniviewdev/ui";
import { Stack } from "@omniviewdev/ui/layout";
import { Text } from "@omniviewdev/ui/typography";
import { Button } from "@omniviewdev/ui/buttons";
import { Tooltip } from "@omniviewdev/ui/overlays";
import Icon from "../../../shared/Icon";
import { useResourcePortForwarder } from "@omniviewdev/runtime";
import { BrowserOpenURL } from "@omniviewdev/runtime/runtime";
import { networker } from "@omniviewdev/runtime/models";
import { ContainerPort, Pod } from "kubernetes-types/core/v1";

export interface PortDetailsCardProps {
  title?: string;
  titleSize?: "sm" | "md" | "lg";
  icon?: string | React.ReactNode;
  data: ContainerPort[];
  resourceID: string;
  connectionID: string;
  /** Full pod object used for port-forward calls (provides real name/namespace) */
  podData?: Pod;
}

const sizeConfig = {
  sm: {
    fontSize: 13,
    iconSize: 14,
    headerPy: 0.5,
    headerPx: 1,
    bodyP: 1,
    gap: 0.5,
  },
  md: {
    fontSize: 14,
    iconSize: 14,
    headerPy: 0.75,
    headerPx: 1.25,
    bodyP: 1.25,
    gap: 0.75,
  },
  lg: {
    fontSize: 16,
    iconSize: 16,
    headerPy: 1,
    headerPx: 1.25,
    bodyP: 1.25,
    gap: 1,
  },
} as const;

// ---------------------------------------------------------------------------
// Config popover shown when clicking "Forward"
// ---------------------------------------------------------------------------

interface ForwardConfigPopoverProps {
  anchorEl: HTMLElement | null;
  port: ContainerPort | null;
  onClose: () => void;
  onConfirm: (opts: {
    localPort?: number;
    protocol: "TCP" | "UDP";
    openInBrowser: boolean;
  }) => void;
}

function ForwardConfigPopover({
  anchorEl,
  port,
  onClose,
  onConfirm,
}: ForwardConfigPopoverProps) {
  const [localPort, setLocalPort] = React.useState("");
  const [protocol, setProtocol] = React.useState<"TCP" | "UDP">("TCP");
  const [openInBrowser, setOpenInBrowser] = React.useState(true);

  // Reset state when popover opens with a new port
  React.useEffect(() => {
    if (anchorEl && port) {
      setLocalPort("");
      setProtocol((port.protocol as "TCP" | "UDP") || "TCP");
      setOpenInBrowser(true);
    }
  }, [anchorEl, port]);

  const handleConfirm = () => {
    const parsed = localPort ? parseInt(localPort, 10) : undefined;
    onConfirm({
      localPort: parsed && !isNaN(parsed) ? parsed : undefined,
      protocol,
      openInBrowser,
    });
    onClose();
  };

  return (
    <Popover
      open={Boolean(anchorEl) && Boolean(port)}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: "top", horizontal: "center" }}
      transformOrigin={{ vertical: "bottom", horizontal: "center" }}
      slotProps={{
        paper: {
          sx: {
            bgcolor: "var(--ov-bg-elevated, #1c2128)",
            border: "1px solid var(--ov-border-default, #30363d)",
            borderRadius: "8px",
            p: 0,
            minWidth: 240,
            maxWidth: 300,
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            color: "var(--ov-fg-default, #c9d1d9)",
          },
        },
      }}
    >
      {/* Header */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 1.5,
          py: 1,
          borderBottom: "1px solid var(--ov-border-default, #30363d)",
        }}
      >
        <Icon name="LuNetwork" size={12} />
        <Box
          sx={{
            fontSize: "0.8125rem",
            fontWeight: 600,
            fontFamily: "var(--ov-font-ui)",
            color: "var(--ov-fg-base, #e6edf3)",
          }}
        >
          Port Forward — :{port?.containerPort}
        </Box>
      </Box>

      {/* Config fields */}
      <Box sx={{ px: 1.5, py: 1.25, display: "flex", flexDirection: "column", gap: 1.25 }}>
        {/* Remote port (read-only) */}
        <ConfigRow label="Remote Port">
          <Box
            sx={{
              fontSize: "0.75rem",
              fontFamily: "var(--ov-font-mono, monospace)",
              color: "var(--ov-fg-muted, #8b949e)",
            }}
          >
            {port?.containerPort}/{port?.protocol || "TCP"}
          </Box>
        </ConfigRow>

        {/* Local port */}
        <ConfigRow label="Local Port">
          <Box
            component="input"
            type="number"
            placeholder="Auto"
            value={localPort}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setLocalPort(e.target.value)
            }
            sx={{
              all: "unset",
              width: 80,
              fontSize: "0.75rem",
              fontFamily: "var(--ov-font-mono, monospace)",
              color: "var(--ov-fg-base, #e6edf3)",
              bgcolor: "rgba(255,255,255,0.04)",
              border: "1px solid var(--ov-border-default, #30363d)",
              borderRadius: "4px",
              px: "6px",
              py: "3px",
              "&::placeholder": { color: "var(--ov-fg-faint, #484f58)" },
              "&:focus": {
                borderColor: "var(--ov-primary-default, #58a6ff)",
              },
            }}
          />
        </ConfigRow>

        {/* Protocol */}
        <ConfigRow label="Protocol">
          <Box sx={{ display: "flex", gap: 0.5 }}>
            {(["TCP", "UDP"] as const).map((p) => (
              <Box
                key={p}
                component="button"
                onClick={() => setProtocol(p)}
                sx={{
                  all: "unset",
                  fontSize: "0.6875rem",
                  fontWeight: 600,
                  fontFamily: "var(--ov-font-ui)",
                  px: "8px",
                  py: "2px",
                  borderRadius: "4px",
                  cursor: "pointer",
                  border: "1px solid",
                  borderColor:
                    protocol === p
                      ? "var(--ov-primary-default, #58a6ff)"
                      : "var(--ov-border-default, #30363d)",
                  color:
                    protocol === p
                      ? "var(--ov-primary-default, #58a6ff)"
                      : "var(--ov-fg-muted, #8b949e)",
                  bgcolor:
                    protocol === p
                      ? "rgba(88,166,255,0.1)"
                      : "transparent",
                  "&:hover": { bgcolor: "rgba(255,255,255,0.06)" },
                }}
              >
                {p}
              </Box>
            ))}
          </Box>
        </ConfigRow>

        {/* Open in browser */}
        <ConfigRow label="Open Browser">
          <Box
            component="input"
            type="checkbox"
            checked={openInBrowser}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setOpenInBrowser(e.target.checked)
            }
            sx={{
              accentColor: "var(--ov-primary-default, #58a6ff)",
              width: 14,
              height: 14,
              cursor: "pointer",
            }}
          />
        </ConfigRow>
      </Box>

      {/* Footer actions */}
      <Box
        sx={{
          display: "flex",
          justifyContent: "flex-end",
          px: 1.5,
          py: 1,
          borderTop: "1px solid var(--ov-border-default, #30363d)",
        }}
      >
        <Button
          size="sm"
          color="primary"
          emphasis="soft"
          sx={{ py: 0, px: 3, minHeight: 26 }}
          onClick={handleConfirm}
        >
          <Text sx={{ fontSize: 12 }}>Forward</Text>
        </Button>
      </Box>
    </Popover>
  );
}

function ConfigRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <Box
        sx={{
          fontSize: "0.6875rem",
          color: "var(--ov-fg-faint, #8b949e)",
          minWidth: 72,
          flexShrink: 0,
        }}
      >
        {label}
      </Box>
      {children}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// PortDetailsCard
// ---------------------------------------------------------------------------

const PortDetailsCard: React.FC<PortDetailsCardProps> = ({
  resourceID,
  connectionID,
  title,
  titleSize = "md",
  icon,
  data,
  podData,
}) => {
  const cfg = sizeConfig[titleSize];

  // Popover state
  const [configAnchor, setConfigAnchor] = React.useState<HTMLElement | null>(null);
  const [configPort, setConfigPort] = React.useState<ContainerPort | null>(null);

  const { sessions, forward, close } = useResourcePortForwarder({
    pluginID: "kubernetes",
    connectionID,
    resourceID,
  });

  const portMap =
    sessions.data?.reduce(
      (prev, curr) => ({ ...prev, [curr.remote_port]: curr }),
      {} as Record<number, networker.PortForwardSession>,
    ) || {};

  const handleStartPortForward = (
    port: number,
    opts?: { localPort?: number; protocol?: "TCP" | "UDP"; openInBrowser?: boolean },
  ) => {
    forward({
      opts: {
        resourceId: resourceID,
        resourceKey: "core::v1::Pod",
        resource: podData ?? { metadata: { name: resourceID, namespace: "default" } },
        remotePort: port,
        localPort: opts?.localPort,
        protocol: opts?.protocol ?? "TCP",
        openInBrowser: opts?.openInBrowser ?? true,
        parameters: {},
      },
    });
  };

  const handleStopPortForward = (sessionID: string) => {
    close({ opts: { sessionID } });
  };

  const handleOpenConfig = (e: React.MouseEvent<HTMLElement>, port: ContainerPort) => {
    setConfigAnchor(e.currentTarget);
    setConfigPort(port);
  };

  const handleCloseConfig = () => {
    setConfigAnchor(null);
    setConfigPort(null);
  };

  return (
    <Box
      sx={{
        borderRadius: 1,
        border: "1px solid",
        borderColor: "divider",
        bgcolor: "background.level1",
        overflow: "hidden",
      }}
    >
      {title && (
        <Box
          sx={{
            py: cfg.headerPy,
            px: cfg.headerPx,
            display: "flex",
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            bgcolor: "background.surface",
            borderBottom: "1px solid",
            borderColor: "divider",
          }}
        >
          <Stack direction="row" gap={cfg.gap} alignItems="center">
            {icon &&
              (typeof icon === "string" ? (
                icon.startsWith("http") ? (
                  <Avatar
                    src={icon}
                    size="sm"
                    sx={{ maxHeight: 16, maxWidth: 16, borderRadius: 4 }}
                  />
                ) : (
                  <Icon name={icon} size={cfg.iconSize} />
                )
              ) : (
                icon
              ))}
            <Text
              sx={{ fontSize: cfg.fontSize }}
              weight="semibold"
              size="sm"
            >
              {title}
            </Text>
          </Stack>
        </Box>
      )}
      <Box sx={{ p: cfg.bodyP }}>
        <Grid container spacing={0.5}>
          {data.map((entry) => {
            const existing = portMap[Number(entry.containerPort)];
            return (
              <React.Fragment key={entry.containerPort}>
                <Grid
                  sx={{ display: "flex", alignItems: "center" }}
                  size={4}
                >
                  <Text sx={{ fontSize: 13 }}>
                    {entry.name || entry.containerPort}
                  </Text>
                </Grid>
                <Grid size={8}>
                  <Stack
                    direction="row"
                    spacing={1}
                    justifyContent="space-between"
                    alignItems="center"
                  >
                    <Text
                      sx={{ color: "neutral.300", fontSize: 13 }}
                      noWrap
                    >
                      {entry.containerPort}/{entry.protocol}
                    </Text>
                    {!!existing && (
                      <Tooltip content="Open in browser">
                        <Chip
                          emphasis="soft"
                          sx={{ borderRadius: "sm" }}
                          onClick={() =>
                            BrowserOpenURL(
                              `http://localhost:${existing.local_port}`,
                            )
                          }
                          label={`http://localhost:${existing.local_port}`}
                        />
                      </Tooltip>
                    )}
                    <Button
                      sx={{ py: 0, px: 4, minHeight: 28 }}
                      color="primary"
                      emphasis="soft"
                      size="sm"
                      onClick={(e) => {
                        if (!existing) {
                          handleOpenConfig(e, entry);
                        } else {
                          handleStopPortForward(existing.id);
                        }
                      }}
                    >
                      <Text sx={{ fontSize: 13 }}>
                        {!existing ? "Forward" : "Stop"}
                      </Text>
                    </Button>
                  </Stack>
                </Grid>
              </React.Fragment>
            );
          })}
        </Grid>
      </Box>

      <ForwardConfigPopover
        anchorEl={configAnchor}
        port={configPort}
        onClose={handleCloseConfig}
        onConfirm={(opts) => {
          if (configPort) {
            handleStartPortForward(Number(configPort.containerPort), opts);
          }
        }}
      />
    </Box>
  );
};

PortDetailsCard.displayName = "PortDetailsCard";
export default PortDetailsCard;
