import { Chip, IconButton, Separator, Text } from '@omniviewdev/base-ui';
import { type DrawerComponent, type DrawerContext } from '@omniviewdev/runtime';
import React from 'react';
import { LuX } from 'react-icons/lu';
import { ErrorBoundary } from 'react-error-boundary';
import RightDrawerActions from './RightDrawerActions';
import { PanelErrorFallback, onBoundaryError } from '@/components/errors/ErrorFallback';
import styles from './RightDrawer.module.css';

type Props = DrawerComponent & {
  ctx?: DrawerContext;
  open: boolean;
  onClose: () => void;
};

/**
 * The primary right drawer container
 */
const RightDrawer: React.FC<Props> = ({
  title, icon, views, actions, ctx,
  onClose,
}) => {
  const [currentView, setCurrentView] = React.useState<number>(0);

  return (
    <div className={styles.Root}>
      <div className={styles.Header}>
        {/** Left Side (title and information)*/}
        <div className={styles.HeaderLeft}>
          {ctx?.resource?.name && (
            <Text truncate className={styles.ResourceName}>
              {ctx.resource.name}
            </Text>
          )}
          {typeof title === 'string'
            ? <Chip
              startDecorator={React.isValidElement(icon) ? icon : undefined}
              size='sm'
              variant='outline'
              color='neutral'
              className={styles.TitleChip}
            >
              {title}
            </Chip>
            : <div className={styles.TitleNode}>
              {icon}
              {title}
            </div>
          }
        </div>

        {/** Right Side (actions)*/}
        <div id={'pages-actions-menus'} className={styles.HeaderActions}>
          {!!actions.length && <RightDrawerActions ctx={ctx ?? {}} actions={actions} />}
          <IconButton
            variant='outline'
            color='neutral'
            size='sm'
            aria-label='Close'
            onClick={onClose}
          >
            <LuX />
          </IconButton>
        </div>
      </div>
      <Separator />
      <div className={styles.Content}>
        {/* Lightweight tab bar — no forced reflows */}
        <div role="tablist" className={styles.TabList}>
          {views.map((view, idx) => (
            <button
              key={idx}
              type="button"
              role="tab"
              aria-selected={currentView === idx}
              onClick={() => {
                setCurrentView(idx);
              }}
              className={styles.Tab}
            >
              {view.icon}
              <span>{typeof view.title === 'string' ? view.title : 'View'}</span>
            </button>
          ))}
        </div>
        <div className={styles.ViewBody}>
          <ErrorBoundary
            FallbackComponent={(props) => <PanelErrorFallback {...props} label={typeof views[currentView]?.title === 'string' ? views[currentView].title : 'View'} boundary="RightDrawer" />}
            onError={onBoundaryError}
            resetKeys={[currentView]}
          >
            {views[currentView]?.component(ctx ?? {})}
          </ErrorBoundary>
        </div>
      </div>
    </div>
  );
};

export default RightDrawer;
