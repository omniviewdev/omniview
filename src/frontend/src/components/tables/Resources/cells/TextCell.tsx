import React from 'react';

// material ui
import Box from '@mui/joy/Box';
import Typography from '@mui/joy/Typography';
import { formatTimeDifference } from '@/utils/time';

type Props = {
  /** The text value to render */
  value: string;
  /** The color of the text. Default is 'neutral' */
  color?: 'success' | 'warning' | 'danger' | 'primary' | 'neutral';
  /** Specify mapping of values to colors that will change with the input */
  colorMap?: Record<string, 'success' | 'warning' | 'danger' | 'primary' | 'neutral'>;
  /** A decorator to render before the text */
  startDecorator?: React.ReactNode;
  /** A decorator to render after the text */
  endDecorator?: React.ReactNode;
  /** The horizontal alignment of the text. Default is 'left' */
  align?: 'left' | 'right' | 'center';
  /** Formatter for the text */
  formatter?: string;
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

  return <TextCellBase value={time} {...rest} />;
};

/** Render a standard text row for the generic resource table. */
const TextCellBase: React.FC<Props> = ({ align, value, color, colorMap, startDecorator, endDecorator }) => {
  const getColor = () => {
    if (colorMap) {
      return colorMap[value] || 'neutral';
    }

    return color ?? 'neutral';
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
    >
      <Typography 
        level='body-xs'
        color={getColor()}
        startDecorator={startDecorator}
        endDecorator={endDecorator}
        noWrap
      >
        {value}
      </Typography>
    </Box>
  );
};


const TextCell: React.FC<Props> = ({ formatter, ...props }) => {
  switch (formatter) {
    case 'AGE':
      console.log('using age formatter');
      return <AgeCell {...props}/>;
    default:
      return <TextCellBase {...props} />;
  }
};

export default TextCell;
  
