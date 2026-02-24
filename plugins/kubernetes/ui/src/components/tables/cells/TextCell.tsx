import React from 'react';

// @omniviewdev/ui
import Box from '@mui/material/Box';
import { Text } from '@omniviewdev/ui/typography';
import { type types } from '@omniviewdev/runtime/models';

import { formatTimeDifference } from '../../../utils/time';
import { convertByteUnits } from '../../../utils/units';
import { type ResourceMetadata } from '../../../hooks/useResourceDefinition';

import ResourceLinkCell from './ResourceLinkCell';

type Props = {
  value: any;
  color?: 'success' | 'warning' | 'danger' | 'primary' | 'neutral';
  colorMap?: Record<string, string>;
  startDecorator?: React.ReactNode;
  endDecorator?: React.ReactNode;
  align?: 'left' | 'right' | 'center';
  formatter?: string;
  resourceLink?: types.ResourceLink;
  metadata?: ResourceMetadata;
  children?: React.ReactNode;
};

type FormattingFunction = (value: any) => string;

const formatters: Record<string, FormattingFunction> = {
  bytes: (value: string) => convertByteUnits({ from: value }),
  sum: (value: string[] | number[] | string | number) => {
    let summed = 0;
    if (Array.isArray(value)) {
      for (const v of value) {
        summed += Number(v);
      }
    }
    if (typeof value === 'string') {
      value.split(',').forEach((v) => {
        summed += Number(v);
      });
    }
    if (typeof value === 'number') {
      summed += value;
    }
    return summed.toString();
  },
  count: (value: string[] | number[] | string | number) => {
    if (Array.isArray(value)) {
      return value.length.toString();
    }
    if (typeof value === 'string') {
      return value.split(',').length.toString();
    }
    if (typeof value === 'number') {
      return value.toString();
    }
    return '';
  },
  avg: (value: string[] | number[] | string | number) => {
    let summed = 0;
    let count = 0;
    if (Array.isArray(value)) {
      for (const v of value) {
        summed += Number(v);
        count++;
      }
    }
    return (summed / count).toString();
  },
  max: (value: string[] | number[] | string | number) => {
    let max = 0;
    if (Array.isArray(value)) {
      for (const v of value) {
        max = Math.max(max, Number(v));
      }
    }
    return max.toString();
  },
  min: (value: string[] | number[] | string | number) => {
    let min = Number.MAX_VALUE;
    if (Array.isArray(value)) {
      for (const v of value) {
        min = Math.min(min, Number(v));
      }
    }
    if (typeof value === 'string') {
      value.split(',').forEach((v) => {
        min = Math.min(min, Number(v));
      });
    }
    if (typeof value === 'number') {
      min = Math.min(min, value);
    }
    return min.toString();
  },
};

const AgeCell: React.FC<Props> = ({ value, ...rest }) => {
  const initialAge = React.useMemo(() => {
    const date = new Date(value);
    if (!value || isNaN(date.getTime())) {
      return '0s';
    }
    return formatTimeDifference(date);
  }, [value]);

  const [time, setTime] = React.useState(initialAge);

  React.useEffect(() => {
    const date = new Date(value);
    if (isNaN(date.getTime())) {
      return;
    }
    const updateAge = () => {
      setTime(formatTimeDifference(date));
    };
    const intervalId = setInterval(updateAge, 1000);
    return () => {
      clearInterval(intervalId);
    };
  }, [value, initialAge]);

  return <CellBase value={time} {...rest} />;
};

const CellBase: React.FC<Props> = ({ align, value, color, colorMap, startDecorator, endDecorator, formatter, children }) => {
  const getColor = () => {
    if (colorMap) {
      let val = colorMap[value] ?? colorMap['*'] ?? undefined;
      switch (val) {
        case 'healthy':
        case 'good':
        case 'success':
          return 'success';
        case 'warning':
          return 'warning';
        case 'error':
        case 'danger':
          return 'danger';
        case 'primary':
          return 'primary';
        default:
          return undefined;
      }
    }
    return color ?? undefined;
  };

  const getAlignment = () => {
    if (align) {
      switch (align) {
        case 'left':
          return 'flex-start';
        case 'right':
          return 'flex-end';
        case 'center':
          return 'center';
      }
    }
    return 'flex-start';
  };

  return (
    <Box
      display='flex'
      flex={1}
      justifyContent={getAlignment()}
      alignItems='center'
      sx={{
        overflowY: 'hidden',
        overflowX: 'scroll',
        scrollbarWidth: 'none',
        '&::-webkit-scrollbar': { display: 'none' },
      }}
    >
      {children ??
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          {startDecorator}
          <Text
            size='xs'
            sx={{ color: getColor() ? `${getColor()}.main` : undefined }}
            noWrap
          >
            {formatter && formatters[formatter] ? formatters[formatter](value) : `${value}`}
          </Text>
          {endDecorator}
        </Box>
      }
    </Box>
  );
};

const TextCell: React.FC<Props> = ({ formatter, ...props }) => {
  if (props.resourceLink) {
    return (
      <CellBase {...props}>
        <ResourceLinkCell value={props.value} metadata={props.metadata} {...props.resourceLink} />
      </CellBase>
    );
  }

  switch (formatter?.toLowerCase()) {
    case 'age':
      return <AgeCell {...props} />;
    default:
      return <CellBase {...props} formatter={formatter?.toLowerCase()} />;
  }
};

export default TextCell;
