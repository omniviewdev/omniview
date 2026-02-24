import type { ReactNode } from 'react';
import MuiStack from '@mui/material/Stack';
import type { StackProps as MuiStackProps } from '@mui/material/Stack';
import Divider from '@mui/material/Divider';


export interface StackProps extends Omit<MuiStackProps, 'divider'> {
  /** Alias for spacing */
  gap?: number;
  /** Alias for alignItems */
  align?: string;
  /** Alias for justifyContent */
  justify?: string;
  /** When true, renders dividers between children. Can also pass a ReactNode. */
  divider?: boolean | ReactNode;
  /** Shorthand: when true, flex-wrap is 'wrap' */
  wrap?: boolean;
}

export default function Stack({
  direction = 'column',
  gap,
  spacing,
  align,
  alignItems,
  justify,
  justifyContent,
  wrap,
  flexWrap,
  divider = false,
  children,
  sx,
  ...rest
}: StackProps) {
  const resolvedSpacing = spacing ?? gap ?? 1;
  const resolvedAlign = alignItems ?? align;
  const resolvedJustify = justifyContent ?? justify;
  const resolvedWrap = flexWrap ?? (wrap ? 'wrap' : undefined);

  const dividerElement = typeof divider === 'boolean'
    ? divider
      ? <Divider orientation={direction === 'row' ? 'vertical' : 'horizontal'} flexItem />
      : undefined
    : divider;

  return (
    <MuiStack
      direction={direction}
      spacing={resolvedSpacing}
      alignItems={resolvedAlign}
      justifyContent={resolvedJustify}
      flexWrap={resolvedWrap}
      divider={dividerElement}
      sx={sx}
      {...rest}
    >
      {children}
    </MuiStack>
  );
}

Stack.displayName = 'Stack';
