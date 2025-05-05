import { Box, Chip, DialogContent, DialogTitle, Divider, IconButton, ListItemDecorator, Sheet, Stack, Tab, TabList, Tabs } from '@mui/joy';
import { DrawerComponent, DrawerContext } from '@omniviewdev/runtime';
import React from 'react';
import { LuX } from 'react-icons/lu';
import RightDrawerActions from './RightDrawerActions';

type Props = DrawerComponent & {
  ctx?: DrawerContext;
  open: boolean;
  onClose: () => void;
}

/**
 * The primary right drawer container
 */
const RightDrawer: React.FC<Props> = ({
  title, icon, views, actions, ctx,
  onClose,
}) => {
  const [currentView, setCurrentView] = React.useState<number>(0)
  console.log(ctx)

  const handleChangeView = (_: React.SyntheticEvent | null, value: string | number | null) => {
    if (!value) {
      setCurrentView(0)
    }
    if (typeof value === 'number') {
      setCurrentView(value)
    }
  }

  return (
    <Sheet
      sx={{
        borderRadius: 'md',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'auto',
        p: 0,
      }}
    >
      <DialogTitle component={'div'}>
        <Stack
          direction='row'
          justifyContent={'space-between'}
          alignItems={'center'}
          flex={1}
          p={0.75}
          sx={{
            bgcolor: 'background.surface'
          }}
        >

          {/** Left Side (title and information)*/}
          <Stack
            direction='row'
            justifyContent={'flex-start'}
            gap={1}
          >
            {typeof title === 'string'
              ? <Chip
                startDecorator={icon}
                size={'md'}
                variant={'outlined'}
                color='neutral'
                sx={{
                  gap: 1,
                  px: 1,
                  py: 0.5,
                  borderRadius: 'sm',
                  fontWeight: 600,
                }}
              >
                {title}
              </Chip>
              : <>
                {icon}
                {title}
              </>
            }

          </Stack>

          {/** Right Side (actions)*/}
          <Stack
            id={'pages-actions-menus'}
            direction='row'
            alignItems={'center'}
            justifyContent={'flex-end'}
            gap={1}
          >
            {!!actions.length && <RightDrawerActions ctx={ctx || {}} actions={actions} />}
            <IconButton
              variant='outlined'
              color='neutral'
              size={'sm'}
              onClick={onClose}
            >
              <LuX />
            </IconButton>
          </Stack>
        </Stack>
      </DialogTitle>
      <Divider />
      <DialogContent
        sx={{
          p: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'auto',
        }}
      >
        <Tabs
          value={currentView}
          onChange={handleChangeView}
        >
          <TabList
            disableUnderline
            variant='outlined'
            color='neutral'
            size='sm'
            sx={{
              borderRadius: 'none',
              overflow: 'auto',
              scrollSnapType: 'x mandatory',
              '&::-webkit-scrollbar': { display: 'none' },
            }}
          >
            {views.map((view, idx) => (
              <Tab
                value={idx}
                variant='plain'
                sx={{
                  alignItems: 'center',
                  flex: 'none',
                  scrollSnapAlign: 'start',
                  borderRightColor: 'divider',
                  borderLeftColor: 'transparent',
                  fontSize: 14,
                  fontWeight: 500,
                }}
              >
                <ListItemDecorator>
                  {view.icon}
                </ListItemDecorator>
                {view.title}
              </Tab>
            ))}
          </TabList>
        </Tabs>
        <Box display={'flex'} flex={1} p={1} overflow={'auto'}>
          {views[currentView]?.component(ctx || {})}
        </Box>
      </DialogContent>
    </Sheet>
  )
}

export default RightDrawer
