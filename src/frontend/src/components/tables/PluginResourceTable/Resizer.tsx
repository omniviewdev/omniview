import { type FC } from 'react';

// Material-ui
import { styled } from '@mui/joy';

/**
 * Resize handler for the column resizing
 */
const ResizerBlock = styled('div')(({ theme }) => ({
  position: 'absolute',
  top: 5,
  bottom: 5,
  width: '1px',
  background: theme.palette.divider,
  paddingTop: 1,
  paddingBottom: 2,
  cursor: 'col-resize',
  userSelect: 'none',
  touchAction: 'none',
  '&.ltr': {
    right: 0,
  },
  '&.rtl': {
    left: 0,
  },
  '&.isResizing': {
    background: theme.palette.common.white,
    opacity: 1,
    width: '5px',
    top: 0,
    bottom: 0,
  },
  '@media (hover: hover)': {
    opacity: 0,
    '&:hover': {
      top: 0,
      bottom: 0,
      width: '5px',
      opacity: 1,
    },
  },
}));

type ResizerProps = {
  header: any;
  table: any;
};

/**
 * Resizer component for resizing columns
 */
const Resizer: FC<ResizerProps> = ({ header, table }) => (
  <ResizerBlock
    {...{
      onDoubleClick: () => header.column.resetSize(),
      onMouseDown: header.getResizeHandler(),
      onTouchStart: header.getResizeHandler(),
      className: `resizer ${table.options.columnResizeDirection
      } ${header.column.getIsResizing() ? 'isResizing' : ''
      }`,
      style: {
        transform:
            header.column.getIsResizing()
            	? `translateX(${(table.options.columnResizeDirection
                === 'rtl'
            		? -1
            		: 1)
              * (table.getState().columnSizingInfo
              	.deltaOffset ?? 0)
            	}px)`
            	: '',
      },
    }}
  />
);

export default Resizer;
