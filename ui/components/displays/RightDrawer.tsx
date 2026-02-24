import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import DialogContent from '@mui/material/DialogContent';
import { Chip } from '@omniviewdev/ui';
import { IconButton } from '@omniviewdev/ui/buttons';
import { Tabs } from '@omniviewdev/ui/navigation';
import { DrawerComponent, DrawerContext } from '@omniviewdev/runtime';
import React from 'react';
import { LuX } from 'react-icons/lu';
import { ErrorBoundary } from 'react-error-boundary';
import RightDrawerActions from './RightDrawerActions';
import { PanelErrorFallback, onBoundaryError } from '@/components/errors/ErrorFallback';

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

  const handleChangeView = (_: React.SyntheticEvent | null, value: string | number | null) => {
    if (!value) {
      setCurrentView(0)
    }
    if (typeof value === 'number') {
      setCurrentView(value)
    }
  }

  return (
    <Box
      sx={{
        borderRadius: 'md',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'auto',
        p: 0,
        bgcolor: 'background.surface',
        border: 1,
        borderColor: 'divider',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 1,
          py: 0.5,
          bgcolor: 'background.surface',
        }}
      >
        {/** Left Side (title and information)*/}
        {typeof title === 'string'
          ? <Chip
            icon={icon}
            size={'sm'}
            emphasis={'outline'}
            color='neutral'
            label={title}
            sx={{
              gap: 0.5,
              px: 0.75,
              py: 0.25,
              borderRadius: 'sm',
              fontWeight: 600,
              fontSize: '0.75rem',
            }}
          />
          : <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            {icon}
            {title}
          </Box>
        }

        {/** Right Side (actions)*/}
        <Box
          id={'pages-actions-menus'}
          sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}
        >
          {!!actions.length && <RightDrawerActions ctx={ctx || {}} actions={actions} />}
          <IconButton
            emphasis='outline'
            color='neutral'
            size={'sm'}
            onClick={onClose}
          >
            <LuX />
          </IconButton>
        </Box>
      </Box>
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
          size="sm"
          value={String(currentView)}
          onChange={(key) => handleChangeView(null, Number(key))}
          tabs={views.map((view, idx) => ({
            key: String(idx),
            label: typeof view.title === 'string' ? view.title : 'View',
            value: idx,
            icon: view.icon,
          }))}
        />
        <Box display={'flex'} flexDirection={'column'} flex={1} p={1} overflow={'auto'} minHeight={0}>
          <ErrorBoundary
            FallbackComponent={(props) => <PanelErrorFallback {...props} label={typeof views[currentView]?.title === 'string' ? views[currentView].title : 'View'} boundary="RightDrawer" />}
            onError={onBoundaryError}
            resetKeys={[currentView]}
          >
            {views[currentView]?.component(ctx || {})}
          </ErrorBoundary>
        </Box>
      </DialogContent>
    </Box>
  )
}

export default RightDrawer
