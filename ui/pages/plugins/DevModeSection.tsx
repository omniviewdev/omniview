import React from 'react';
import { Chip, StatusDot } from '@omniviewdev/base-ui';
import type { ComponentColor } from '@omniviewdev/base-ui';
import { LuCircle, LuHammer, LuPlay, LuRefreshCw, LuSquare } from 'react-icons/lu';
import { LifecycleStage } from '@omniviewdev/runtime/models';

import HintTooltip from '@/components/base/HintTooltip';
import { devToolsChannel } from '@/features/devtools/events';
import { getAggregateStatus, STATUS_COLORS } from '@/features/devtools/types';
import type { DevServerAggregateStatus } from '@/features/devtools/types';
import { useDevServer } from '@/hooks/plugin/useDevServer';
import styles from './DevModeSection.module.css';

type Props = {
  pluginId: string;
  devPath: string;
};

const STATUS_LABELS: Record<DevServerAggregateStatus, string> = {
  ready: 'Ready',
  building: 'Building',
  error: 'Error',
  stopped: 'Stopped',
  connecting: 'Connecting',
};

const DOT_CSS: Record<DevServerAggregateStatus, string> = {
  ready: '#3fb950',
  building: '#d29922',
  error: '#f85149',
  stopped: '#8b949e',
  connecting: '#58a6ff',
};

/** Maps the legacy semantic colour names in STATUS_COLORS onto base-ui colours. */
function toChipColor(color: (typeof STATUS_COLORS)[DevServerAggregateStatus]): ComponentColor {
  return color === 'primary' ? 'brand' : color;
}

/**
 * Dev mode section displayed inside InstalledPluginCard when the plugin is in dev mode.
 * Shows dev server status, controls, and build information.
 */
const DevModeSection: React.FC<Props> = ({ pluginId, devPath }) => {
  const { state, start, stop, restart } = useDevServer(pluginId);

  const aggStatus = state.data ? getAggregateStatus(state.data) : 'stopped';
  const isRunning = aggStatus === 'ready' || aggStatus === 'building' || aggStatus === 'connecting' || aggStatus === 'error';
  const dotColor = DOT_CSS[aggStatus];

  return (
    <div className={styles.Root}>
      {/* Header row */}
      <div className={styles.Header}>
        <div className={styles.HeaderLeft}>
          <span className={styles.Title}>
            Dev Server
          </span>
          <Chip
            size='xs'
            color={toChipColor(STATUS_COLORS[aggStatus])}
            variant='soft'
            className={styles.StatusChip}
            startDecorator={<LuCircle size={6} fill={dotColor} color={dotColor} />}
          >
            {STATUS_LABELS[aggStatus]}
          </Chip>
          {/* Dev-only base-ui smoke test (omn-oiaq): checks base-ui renders inside the MUI tree. */}
          {import.meta.env.DEV && (
            <StatusDot status="info" size="sm" label="base-ui" data-testid="base-ui-smoke" />
          )}
        </div>

        <div className={styles.Actions}>
          <HintTooltip content='View build output and compiler logs'>
            <ActionBtn icon={<LuHammer size={12} />} label='Build Output' onClick={() => {
              devToolsChannel.emit('onOpenBuildOutput', pluginId); 
            }} />
          </HintTooltip>
          {isRunning ? (
            <HintTooltip content='Stop the dev server'>
              <ActionBtn icon={<LuSquare size={12} />} label='Stop' onClick={() => {
                stop.mutate(pluginId); 
              }} color='var(--ov-color-danger)' />
            </HintTooltip>
          ) : (
            <HintTooltip content='Start the dev server'>
              <ActionBtn icon={<LuPlay size={12} />} label='Start' onClick={() => {
                start.mutate(pluginId); 
              }} color='var(--ov-color-success)' />
            </HintTooltip>
          )}
          <HintTooltip content='Restart the dev server'>
            <ActionBtn icon={<LuRefreshCw size={12} />} label='Restart' onClick={() => {
              restart.mutate(pluginId); 
            }} disabled={!isRunning} />
          </HintTooltip>
        </div>
      </div>

      {/* Details */}
      <div className={styles.Details}>
        <DetailRow label='Source' value={devPath} mono />
        {state.data?.vitePort != null && state.data.vitePort > 0 && (
          <DetailRow label='Vite' value={`http://127.0.0.1:${state.data.vitePort}`} mono />
        )}
        {state.data && (
          <DetailRow
            label='gRPC'
            value={state.data.rpcStatus === LifecycleStage.StageNotApplicable ? 'Not applicable' : state.data.grpcConnected ? 'Connected' : 'Disconnected'}
            valueColor={state.data.rpcStatus === LifecycleStage.StageNotApplicable ? undefined : state.data.grpcConnected ? 'var(--ov-color-success)' : 'var(--ov-color-danger)'}
          />
        )}
        {state.data?.lastError && (
          <div className={styles.Error}>
            {state.data.lastError}
          </div>
        )}
      </div>
    </div>
  );
};

function DetailRow({ label, value, mono, valueColor }: { label: string; value: string; mono?: boolean; valueColor?: string }) {
  return (
    <div className={styles.DetailRow}>
      <span className={styles.DetailLabel}>
        {label}:
      </span>
      <span
        className={styles.DetailValue}
        data-mono={mono ? 'true' : undefined}
        style={valueColor ? { color: valueColor } : undefined}
      >
        {value}
      </span>
    </div>
  );
}

const ActionBtn = React.forwardRef<HTMLButtonElement, { icon: React.ReactNode; label: string; onClick: () => void; color?: string; disabled?: boolean } & React.HTMLAttributes<HTMLButtonElement>>(
  ({ icon, label, onClick, color, disabled, style, ...rest }, ref) => (
    <button
      {...rest}
      ref={ref}
      type='button'
      className={styles.ActionBtn}
      data-disabled={disabled ? 'true' : undefined}
      onClick={disabled ? undefined : onClick}
      style={color && !disabled ? { ...style, color } : style}
    >
      {icon}
      {label}
    </button>
  ),
);

export default React.memo(DevModeSection);
