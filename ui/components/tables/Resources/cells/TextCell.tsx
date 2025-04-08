import React from 'react';

// material ui
import Box from '@mui/joy/Box';
import Typography from '@mui/joy/Typography';
import { formatTimeDifference } from '@/utils/time';
import { convertByteUnits } from '@/utils/units';
import { type types } from '@api/models';
import { type ResourceMetadata } from '@/hooks/resource/useResourceDefinition';
import ResourceLinkCell from './ResourceLinkCell';

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
  /** Resource links to parse */
  resourceLink?: types.ResourceLink;
  /** Metadata for the resource */
  metadata?: ResourceMetadata;
  /** children */
  children?: React.ReactNode;
};

type FormattingFunction = (value: any) => string;

/**
 * Various formatters that we can apply to the contents of the cell. These need to return a string,
 * but can take in any type.
 */
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
  // Memoize the initial age calculation
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
      // Early return if value is not a valid date
      return;
    }

    const updateAge = () => {
      setTime(formatTimeDifference(date));
    };

    // Set the interval to update the age every 60 seconds
    const intervalId = setInterval(updateAge, 1000); // Adjusted to 60 seconds

    // Cleanup the interval on component unmount
    return () => {
      clearInterval(intervalId);
    };
  }, [value, initialAge]);

  return <CellBase value={time} {...rest} />;
};

/** Render a standard text row for the generic resource table. */
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
        // allow vertical scrolling, but hide scrollbar
        overflowY: 'hidden',
        overflowX: 'scroll',
        scrollbarWidth: 'none',
        '&::-webkit-scrollbar': { display: 'none' },
      }}
    >
      {children ??
        <Typography
          level='body-xs'
          color={getColor()}
          startDecorator={startDecorator}
          endDecorator={endDecorator}
          noWrap
        >
          {formatter && formatters[formatter] ? formatters[formatter](value) : `${value}`}
        </Typography>
      }
    </Box>
  );
};

const TextCell: React.FC<Props> = ({ formatter, ...props }) => {
  /**
   * Resource links have their own component type
   */
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

