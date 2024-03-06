import React from 'react'

// material-ui
import Box from '@mui/joy/Box'
import IconButton from '@mui/joy/IconButton'
import Icon from '@/components/icons/Icon'
import HeaderIconMenu from './components/HeaderIconMenu'
import HeaderIconButton from './components/HeaderIconButton'
import HeaderIconLink from './components/HeaderIconLink'

// project-imports
import { HeaderAreaItemList, HeaderAreaItemListType, HeaderAreaItemType } from '@/store/header/types'
import usePanes from '@/hooks/usePanes'
import { Tooltip } from '@mui/joy'

type Props = {
  /** The items to display in the header. */
  items: HeaderAreaItemList
}

/**
 * Display items within an item area on the header
 */
const HeaderItemsArea: React.FC<Props> = ({ items }) => {
  const { addNewPane } = usePanes()

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'row',
        gap: 1,
        width: '100%',
        height: '100%',
        justifyContent: 'flex-end',
        alignItems: 'center',
        px: 0.5,
        'WebkitUserSelect': 'none',
      }}
    >
      {items.map((item) => <HeaderItemComponent key={item.id} item={item} />)}
      {/* Temporary to test the panes */}
      <Tooltip enterDelay={1000} title="Add Pane" variant='soft' >

        <IconButton
          name={'add-pane'}
          size="md"
          variant="outlined"
          color="neutral"
          sx={{
            '--wails-draggable': 'no-drag',
          }}
          onClick={addNewPane}
        >
          <Icon name={'LuSplitSquareHorizontal'} size={18} />
        </IconButton>
      </Tooltip>
    </Box>
  )
}

const HeaderItemComponent = ({ item }: { item: HeaderAreaItemListType }): React.ReactElement => {
  switch (item.type) {
    case HeaderAreaItemType.BUTTON:
      return <HeaderIconButton {...item} />
    case HeaderAreaItemType.LINK:
      return <HeaderIconLink {...item} />
    case HeaderAreaItemType.MENU:
      return <HeaderIconMenu {...item} />
    case HeaderAreaItemType.MODAL:
    // not defined yet for now
    default:
      return <></>
  }
}

export default HeaderItemsArea
