import React from "react";

// @omniviewdev/ui
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import { Card as UiCard, Avatar, Chip } from '@omniviewdev/ui';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';

// project imports
import Icon from "./Icon";

export interface Props {
  title: string;
  icon?: string | React.ReactNode;
  titleDecorator?: string | number | React.ReactNode;
  children?: React.ReactNode;
}

/**
 * Renders a card for showing a key-value pairs of details
 */
export const Card: React.FC<Props> = ({
  title,
  titleDecorator,
  icon,
  children,
}) => {
  return (
    <UiCard variant="outlined" sx={{ p: 0, gap: 0 }}>
      <Stack
        direction="row"
        gap={1}
        sx={{ p: 1 }}
        alignItems="center"
        justifyContent="space-between"
      >
        <Stack direction="row" alignItems="center" gap={1}>
          {icon &&
            (typeof icon === "string" ? (
              icon.startsWith("http") ? (
                <Avatar
                  src={icon}
                  size="sm"
                  sx={{ maxHeight: 16, maxWidth: 16, borderRadius: 4 }}
                />
              ) : (
                <Icon name={icon} size={14} />
              )
            ) : (
              icon
            ))}
          <Text weight="semibold" size="sm">{title}</Text>
        </Stack>
        {titleDecorator &&
          (typeof titleDecorator === "string" ||
            typeof titleDecorator === "number" ? (
            <Chip
              sx={{ borderRadius: "4px" }}
              size="sm"
              color="primary"
              emphasis="outline"
              label={String(titleDecorator)}
            />
          ) : (
            titleDecorator
          ))}
      </Stack>
      <Divider />
      <Box sx={{ p: 1 }}>{children}</Box>
    </UiCard>
  );
};

Card.displayName = "Card";

export default Card;
