import React from 'react';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import { formatTimeDifference } from '../utils/time';
import { convertByteUnits } from '../utils/units';

type Props = {
  /** The text value to render */
  value: any;
  /** The color of the text. Default is 'neutral' */
  color?: 'success' | 'warning' | 'danger' | 'primary' | 'neutral';
  /** Specify mapping of values to colors that will change with the input */
  colorMap?: Record<string, string>;
  /** A decorator to render before the text */
  startDecorator?: React.ReactNode;
  /** A decorator to render after the text */
  endDecorator?: React.ReactNode;
  /** The horizontal alignment of the text. Default is 'left' */
  align?: 'left' | 'right' | 'center';
  /** Formatter for the text */
  formatter?: string;
  /** children */
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
      value.split(',').forEach((v) => { summed += Number(v); });
    }
    if (typeof value === 'number') {
      summed += value;
    }
    return summed.toString();
  },
  count: (value: string[] | number[] | string | number) => {
    if (Array.isArray(value)) return value.length.toString();
    if (typeof value === 'string') return value.split(',').length.toString();
    if (typeof value === 'number') return value.toString();
    return '';
  },
  avg: (value: string[] | number[]) => {
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
  max: (value: string[] | number[]) => {
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
      value.split(',').forEach((v) => { min = Math.min(min, Number(v)); });
    }
    if (typeof value === 'number') {
      min = Math.min(min, value);
    }
    return min.toString();
  },
};

/** Map Joy-style color names to Material UI color names */
const mapColor = (color: string | undefined): 'success' | 'warning' | 'error' | 'primary' | 'inherit' | undefined => {
  switch (color) {
    case 'success':  return 'success';
    case 'warning':  return 'warning';
    case 'danger':
    case 'error':    return 'error';
    case 'primary':  return 'primary';
    case 'neutral':  return 'inherit';
    default:         return undefined;
  }
};

const AgeCell: React.FC<Props> = ({ value, ...rest }) => {
  const initialAge = React.useMemo(() => {
    const date = new Date(value);
    if (!value || isNaN(date.getTime())) return '0s';
    return formatTimeDifference(date);
  }, [value]);

  const [time, setTime] = React.useState(initialAge);

  React.useEffect(() => {
    const date = new Date(value);
    if (isNaN(date.getTime())) return;

    const updateAge = () => { setTime(formatTimeDifference(date)); };
    const intervalId = setInterval(updateAge, 1000);
    return () => { clearInterval(intervalId); };
  }, [value, initialAge]);

  return <CellBase value={time} {...rest} />;
};

const CellBase: React.FC<Props> = ({ align, value, color, colorMap, startDecorator, endDecorator, formatter, children }) => {
  const getColor = () => {
    if (colorMap) {
      const val = colorMap[value] ?? colorMap['*'] ?? undefined;
      return mapColor(val);
    }
    return mapColor(color);
  };

  const getAlignment = () => {
    switch (align) {
      case 'left':   return 'flex-start';
      case 'right':  return 'flex-end';
      case 'center': return 'center';
      default:       return 'flex-start';
    }
  };

  return (
    <Box
      display="flex"
      flex={1}
      justifyContent={getAlignment()}
      alignItems="center"
      sx={{
        overflowY: 'hidden',
        overflowX: 'scroll',
        scrollbarWidth: 'none',
        '&::-webkit-scrollbar': { display: 'none' },
      }}
    >
      {children ?? (
        <Box display="flex" alignItems="center" gap={0.5}>
          {startDecorator}
          <Typography
            variant="caption"
            color={getColor()}
            noWrap
          >
            {formatter && formatters[formatter] ? formatters[formatter](value) : `${value}`}
          </Typography>
          {endDecorator}
        </Box>
      )}
    </Box>
  );
};

/**
 * Render a text cell for the generic resource table.
 * Supports formatters: age, bytes, sum, count, avg, max, min.
 */
const TextCell: React.FC<Props> = ({ formatter, ...props }) => {
  switch (formatter?.toLowerCase()) {
    case 'age':
      return <AgeCell {...props} />;
    default:
      return <CellBase {...props} formatter={formatter?.toLowerCase()} />;
  }
};

TextCell.displayName = 'TextCell';

export default TextCell;
