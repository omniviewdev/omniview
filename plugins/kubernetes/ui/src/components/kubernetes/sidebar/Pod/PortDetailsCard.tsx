import React from "react";

// material-ui
import Stack from "@mui/joy/Stack";
import Card from "@mui/joy/Card";
import CardContent from "@mui/joy/CardContent";
import Avatar from "@mui/joy/Avatar";
import Divider from "@mui/joy/Divider";
import Grid from "@mui/joy/Grid";
import Typography from "@mui/joy/Typography";

// project imports
import Icon from "../../../shared/Icon";
import { Button } from "@mui/joy";

export interface DetailsCardEntry {
  key: string;
  value: string;
  icon?: string | React.ReactNode;
  ratio?: [number, number];
  used?: string;
  defaultValue?: string;
}

export interface DetailsCardProps {
  title?: string;
  titleSize?: "sm" | "md" | "lg";
  icon?: string | React.ReactNode;
  data: DetailsCardEntry[];
  /** Show the kv pair even if the value is undefined */
  showUndefined?: boolean;
}

const getTitleFontSize = (size: "sm" | "md" | "lg") => {
  switch (size) {
    case "sm":
      return 12;
    case "md":
      return 14;
    case "lg":
      return 16;
    default:
      return 14;
  }
};

const getTitleContainerSpacing = (size: "sm" | "md" | "lg") => {
  switch (size) {
    case "sm":
      return 0.5;
    case "md":
      return 1;
    case "lg":
      return 2;
    default:
      return 1;
  }
};

const getTitleIconSize = (size: "sm" | "md" | "lg") => {
  switch (size) {
    case "sm":
      return 12;
    case "md":
      return 14;
    case "lg":
      return 16;
    default:
      return 14;
  }
};

/**
 * Renders a card for showing a key-value pairs of details
 */
export const PortDetailsCard: React.FC<DetailsCardProps> = ({
  title,
  titleSize = "md",
  icon,
  data,
  showUndefined = false,
}) => {
  return (
    <Card
      variant="outlined"
      sx={{ p: 1, gap: getTitleContainerSpacing(titleSize) }}
    >
      {title && (
        <>
          <Stack
            direction="row"
            spacing={getTitleContainerSpacing(titleSize)}
            alignItems={"center"}
          >
            {icon &&
              (typeof icon === "string" ? (
                icon.startsWith("http") ? (
                  <Avatar
                    src={icon}
                    size="sm"
                    sx={{ maxHeight: 16, maxWidth: 16, borderRadius: 4 }}
                  />
                ) : (
                  <Icon name={icon} size={getTitleIconSize(titleSize)} />
                )
              ) : (
                icon
              ))}
            <Typography fontSize={getTitleFontSize(titleSize)} level="title-sm">
              {title}
            </Typography>
          </Stack>
          <Divider />
        </>
      )}
      <CardContent>
        <Grid container spacing={0.5}>
          {data.map((entry) => {
            if (entry.value || showUndefined) {
              return (
                <>
                  <Grid 
                    sx={{
                      display: "flex",
                      alignItems: "center",
                    }}
                    xs={entry.ratio?.[0] ?? 5}
                  >
                    <Stack direction="row" spacing={1} alignItems={"center"}>
                      {entry.icon &&
                        (typeof entry.icon === "string" ? (
                          entry.icon.startsWith("http") ? (
                            <Avatar src={entry.icon} size="sm" />
                          ) : (
                            <Icon name={entry.icon} size={14} />
                          )
                        ) : (
                          icon
                        ))}
                      <Typography level="body-xs">{entry.key}</Typography>
                    </Stack>
                  </Grid>
                  <Grid xs={entry.ratio?.[1] ?? 7}>
                    <Stack direction="row" spacing={1} justifyContent={"space-between"} alignItems={"center"}>
                      <Typography
                        textColor={"neutral.300"}
                        level="body-xs"
                        noWrap
                      >
                        {entry.used
                          ? `${entry.used} / ${entry.value}`
                          : entry.value}
                      </Typography>
                      <Button 
                        sx={{
                          py: 0,
                          px: 4,
                          minHeight: 28,
                        }}
                        color="primary"
                        variant="soft" 
                        size="sm"
                      >
                        <Typography fontSize={12}>
                          Forward
                        </Typography>
                      </Button>
                    </Stack>
                  </Grid>
                </>
              );
            }
          })}
        </Grid>
      </CardContent>
    </Card>
  );
};

PortDetailsCard.displayName = "PortDetailsCard";
export default PortDetailsCard;
