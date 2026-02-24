import * as React from "react";

// material-ui
import { Card, Chip } from "@omniviewdev/ui";
import Divider from "@mui/material/Divider";
import { Stack } from "@omniviewdev/ui/layout";
import { Text } from "@omniviewdev/ui/typography";

// project imports
import Icon from "../../../shared/Icon";
import { getStatus } from "./utils";

// types
import { ContainerStatus } from "kubernetes-types/core/v1";
import {
  ContainerTerminatedStatusInfo,
  ContainerWaitingStatusInfo,
} from "./ContainerStatuses";

// third-party
import { formatRelative } from "date-fns";

interface Props {
  status: ContainerStatus;
  showContainerName?: boolean;
  showStartedAt?: boolean;
}

const ContainerStatusCard: React.FC<Props> = ({
  status,
  showContainerName = true,
  showStartedAt = true,
}) => {
  const statusInfo = getStatus(status);

  const getVariant = () => {
    switch (statusInfo.text) {
      case "Completed":
        return "outline";
      case "Waiting":
        return "soft";
      default:
        return "solid";
    }
  };

  const getStatusText = () => {
    if (status.ready && status.started) {
      return "Ready";
    } else if (!status.ready && status.started) {
      return "Started";
    }
    return "Not Ready";
  };

  return (
    <Card
      emphasis="soft"
      sx={{
        p: 0.5,
        minWidth: 300,
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        justifyContent={"space-between"}
        spacing={2}
      >

        {showContainerName && <Text size="sm">{status.name}</Text>}
        <Stack gap={1} direction={"row"} alignItems={"center"}>
          <Chip
            size="sm"
            color={statusInfo.color}
            emphasis={getVariant()}
            sx={{ borderRadius: "sm" }}
            startAdornment={
              statusInfo.icon && <Icon name={statusInfo.icon} size={16} />
            }
            label={statusInfo.text}
          />
          <Chip
            size="sm"
            color={status.ready ? "primary" : "warning"}
            emphasis={"outline"}
            sx={{ borderRadius: "sm" }}
            label={getStatusText()}
          />
        </Stack>
        {showStartedAt && status.state?.running && status.state.running.startedAt && (
          <Text size="sm">
            Started{" "}
            {formatRelative(
              new Date(status.state.running.startedAt),
              new Date(),
            )}
          </Text>
        )}
      </Stack>
      <div>
        <Stack direction="column" spacing={0}>
          {status.state?.terminated && (
            <ContainerTerminatedStatusInfo state={status.state.terminated} />
          )}
          {status.state?.waiting && (
            <ContainerWaitingStatusInfo state={status.state.waiting} />
          )}
          {status.state?.running && !status.lastState?.terminated && (
            <Text size="sm" color="success">Container is healthy</Text>
          )}
          {status.lastState?.terminated && (
            <Card emphasis="outline" sx={{ px: 1, gap: 0.5, pb: 1, pt: 0.5 }}>
              <Stack
                direction="row"
                spacing={1}
                alignItems={"center"}
                justifyContent={"space-between"}
              >
                <Text sx={{ fontSize: 12, color: "neutral.50" }}>
                  Last State
                </Text>
                <Chip
                  size="sm"
                  color="danger"
                  emphasis="outline"
                  sx={{ borderRadius: "sm" }}
                  label="Terminated"
                />
              </Stack>
              <Divider />
              <div>
                <ContainerTerminatedStatusInfo
                  state={status.lastState.terminated}
                />
              </div>
            </Card>
          )}
        </Stack>
      </div>
    </Card>
  );
};

export default ContainerStatusCard;
