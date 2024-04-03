import React from 'react';

// material ui
import Box from '@mui/joy/Box';
import Typography from '@mui/joy/Typography';

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
};

/** Render a standard text row for the generic resource table. */
export const TextRow: React.FC<Props> = ({ align, value, color, colorMap, startDecorator, endDecorator }) => {
  const getColor = () => {
    if (colorMap) {
      return colorMap[value] || 'neutral';
    }
    return color || 'neutral';
  }

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
  }

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
}

export default TextRow;
