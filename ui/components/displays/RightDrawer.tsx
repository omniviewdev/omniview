import React from 'react';
import { IconButton, ButtonGroup, Sheet, DialogTitle, DialogContent, Stack, Typography, Tooltip, Divider } from '@mui/joy';
import { DrawerComponent, DrawerContext } from '@omniviewdev/runtime';
import { LuX } from 'react-icons/lu';

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

  return (
    <Sheet
      sx={{
        borderRadius: 'md',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'auto',
        p: 1,
        gap: 1,
      }}
    >
      <DialogTitle>
        <Stack
          direction='row'
          justifyContent={'space-between'}
          alignItems={'center'}
          flex={1}
          sx={{
            bgcolor: 'background.surface'
          }}
        >

          {/** Left Side (title and information)*/}
          <Stack
            direction='row'
            alignItems={'center'}
            justifyContent={'flex-start'}
            gap={1}
          >
            {typeof title === 'string'
              ? <Typography
                startDecorator={icon}
                level={'title-sm'}
              >
                {title}
              </Typography>
              : <>
                {icon}
                {title}
              </>
            }
          </Stack>

          {/** Right Side (pages and actions)*/}
          <Stack
            id={'pages-actions-menus'}
            direction='row'
            alignItems={'center'}
            justifyContent={'flex-end'}
            gap={1}
          >
            <ButtonGroup id={'pages-menu'} size='sm' variant='outlined'>
              {views.map((view, idx) => (
                <Tooltip arrow title={view.title} variant='plain'>
                  <span>
                    <IconButton
                      color={currentView === idx ? 'primary' : 'neutral'}
                      onClick={() => setCurrentView(idx)}
                    >
                      {view.icon}
                    </IconButton>
                  </span>
                </Tooltip>
              ))}
            </ButtonGroup>

            {!!actions.length &&
              <ButtonGroup id={'actions-menu'} size='sm' variant='outlined'>
                {actions.map((action) => (
                  <Tooltip arrow title={action.title} variant='soft'>
                    <span>
                      <IconButton
                        onClick={() => action.action(ctx?.data)}
                      >
                        {action.icon}
                      </IconButton>
                    </span>
                  </Tooltip>
                ))}
              </ButtonGroup>
            }
            <IconButton variant='outlined' size={'sm'} onClick={onClose}>
              <LuX />
            </IconButton>
          </Stack>
        </Stack>
      </DialogTitle>
      <Divider />
      <DialogContent sx={{ p: 0 }}>
        {views[currentView]?.component(ctx?.data)}
      </DialogContent>
    </Sheet>
  )
}

export default RightDrawer
