import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import {
  LuGitBranch,
  LuBell,
  LuTriangleAlert,
  LuCircleAlert,
  LuCheck,
  LuRefreshCw,
  LuCloudOff,
  LuClock,
  LuZap,
  LuWifi,
} from 'react-icons/lu';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import ImportStatement from '../helpers/ImportStatement';
import IDEStatusFooter from '../../feedback/IDEStatusFooter';

export default function IDEStatusFooterPage() {
  const [progress, setProgress] = useState(65);

  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 'var(--ov-weight-bold)', color: 'var(--ov-fg-base)', mb: '32px' }}>
        IDEStatusFooter
      </Typography>

      <Section title="IDEStatusFooter" description="VS Code-style thin status bar with compound sub-components: Chip, Dot, Text, Spinner, Progress, Circular, Separator, Button, Badge, Timer.">
        <ImportStatement code="import { IDEStatusFooter } from '@omniviewdev/ui/feedback';" />

        <Example title="Full IDE Status Bar">
          <Box sx={{ border: '1px solid var(--ov-border-default)', borderRadius: '6px', overflow: 'hidden' }}>
            <IDEStatusFooter
              left={
                <>
                  <IDEStatusFooter.Chip
                    label="Development Mode"
                    bgColor="#1a7f37"
                    color="#fff"
                    tooltip="Running in development mode"
                  />
                  <IDEStatusFooter.Separator />
                  <IDEStatusFooter.Text
                    icon={<LuGitBranch size={11} />}
                    onClick={() => console.log('Branch clicked')}
                    tooltip="Current branch"
                  >
                    feature/plugin-sdk
                  </IDEStatusFooter.Text>
                  <IDEStatusFooter.Separator />
                  <IDEStatusFooter.Dot color="var(--ov-success-default)" tooltip="Cluster connected" />
                  <IDEStatusFooter.Text tooltip="Active cluster">
                    prod-east-1
                  </IDEStatusFooter.Text>
                </>
              }
              right={
                <>
                  <IDEStatusFooter.Spinner label="Indexing..." tooltip="Indexing workspace files" />
                  <IDEStatusFooter.Separator />
                  <IDEStatusFooter.Progress value={progress} width={60} label="Build" showValue tooltip="Plugin build progress" />
                  <IDEStatusFooter.Separator />
                  <IDEStatusFooter.Badge count={3} icon={<LuTriangleAlert size={10} />} tooltip="3 warnings" color="var(--ov-warning-default)" />
                  <IDEStatusFooter.Badge count={0} icon={<LuCircleAlert size={10} />} tooltip="0 errors" />
                  <IDEStatusFooter.Separator />
                  <IDEStatusFooter.Text icon={<LuCheck size={10} />}>
                    UTF-8
                  </IDEStatusFooter.Text>
                  <IDEStatusFooter.Button
                    icon={<LuBell size={10} />}
                    onClick={() => console.log('Notifications')}
                    tooltip="Notifications"
                  />
                </>
              }
            />
          </Box>
          <Box sx={{ mt: 1 }}>
            <Typography component="span" sx={{ fontSize: 'var(--ov-text-xs)', color: 'var(--ov-fg-faint)' }}>
              Progress:{' '}
            </Typography>
            <input
              type="range"
              min={0}
              max={100}
              value={progress}
              onChange={(e) => setProgress(Number(e.target.value))}
              style={{ width: 120, verticalAlign: 'middle' }}
            />
            <Typography component="span" sx={{ fontSize: 'var(--ov-text-xs)', color: 'var(--ov-fg-faint)', ml: 0.5 }}>
              {progress}%
            </Typography>
          </Box>
        </Example>

        <Example title="Sub-Components Gallery">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {/* Chips */}
            <Box>
              <Typography sx={{ fontSize: 'var(--ov-text-xs)', color: 'var(--ov-fg-muted)', mb: 0.5, fontWeight: 600 }}>
                Chip — Colored mode indicators
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, height: 22, alignItems: 'center', bgcolor: 'var(--ov-bg-surface)', px: 0.5, borderRadius: '4px' }}>
                <IDEStatusFooter.Chip label="DEV" bgColor="#1a7f37" />
                <IDEStatusFooter.Chip label="STAGING" bgColor="#9a6700" />
                <IDEStatusFooter.Chip label="PRODUCTION" bgColor="#cf222e" />
                <IDEStatusFooter.Chip label="Debug" bgColor="#6639ba" icon={<LuZap size={9} />} />
              </Box>
            </Box>

            {/* Dots */}
            <Box>
              <Typography sx={{ fontSize: 'var(--ov-text-xs)', color: 'var(--ov-fg-muted)', mb: 0.5, fontWeight: 600 }}>
                Dot — Status indicators (static & pulsing)
              </Typography>
              <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                  <IDEStatusFooter.Dot color="var(--ov-success-default)" tooltip="Connected" />
                  <Typography sx={{ fontSize: 'var(--ov-text-xs)', color: 'var(--ov-fg-muted)' }}>Connected</Typography>
                </Box>
                <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                  <IDEStatusFooter.Dot color="var(--ov-warning-default)" pulse tooltip="Connecting..." />
                  <Typography sx={{ fontSize: 'var(--ov-text-xs)', color: 'var(--ov-fg-muted)' }}>Connecting</Typography>
                </Box>
                <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                  <IDEStatusFooter.Dot color="var(--ov-danger-default)" tooltip="Disconnected" />
                  <Typography sx={{ fontSize: 'var(--ov-text-xs)', color: 'var(--ov-fg-muted)' }}>Error</Typography>
                </Box>
              </Box>
            </Box>

            {/* Progress variants */}
            <Box>
              <Typography sx={{ fontSize: 'var(--ov-text-xs)', color: 'var(--ov-fg-muted)', mb: 0.5, fontWeight: 600 }}>
                Progress — Inline linear progress bars
              </Typography>
              <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', height: 22, bgcolor: 'var(--ov-bg-surface)', px: 0.5, borderRadius: '4px' }}>
                <IDEStatusFooter.Progress value={35} label="Download" showValue width={100} />
                <IDEStatusFooter.Separator />
                <IDEStatusFooter.Progress label="Indexing..." width={80} />
                <IDEStatusFooter.Separator />
                <IDEStatusFooter.Progress value={100} label="Done" color="var(--ov-success-default)" width={60} />
              </Box>
            </Box>

            {/* Circular variants */}
            <Box>
              <Typography sx={{ fontSize: 'var(--ov-text-xs)', color: 'var(--ov-fg-muted)', mb: 0.5, fontWeight: 600 }}>
                Circular — Tiny circular progress
              </Typography>
              <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', height: 22, bgcolor: 'var(--ov-bg-surface)', px: 0.5, borderRadius: '4px' }}>
                <IDEStatusFooter.Circular value={75} tooltip="75% complete" />
                <IDEStatusFooter.Circular tooltip="Loading..." />
                <IDEStatusFooter.Circular value={100} color="var(--ov-success-default)" tooltip="Complete" />
              </Box>
            </Box>

            {/* Buttons & Badges */}
            <Box>
              <Typography sx={{ fontSize: 'var(--ov-text-xs)', color: 'var(--ov-fg-muted)', mb: 0.5, fontWeight: 600 }}>
                Button & Badge — Actions and notification counts
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', height: 22, bgcolor: 'var(--ov-bg-surface)', px: 0.5, borderRadius: '4px' }}>
                <IDEStatusFooter.Button icon={<LuRefreshCw size={10} />} label="Sync" onClick={() => {}} tooltip="Sync resources" />
                <IDEStatusFooter.Separator />
                <IDEStatusFooter.Badge count={5} icon={<LuBell size={10} />} onClick={() => {}} tooltip="5 notifications" />
                <IDEStatusFooter.Badge count={142} icon={<LuTriangleAlert size={10} />} maxCount={99} tooltip="142 warnings" color="var(--ov-warning-default)" />
                <IDEStatusFooter.Badge count={0} icon={<LuCircleAlert size={10} />} tooltip="0 errors" />
              </Box>
            </Box>

            {/* Timer */}
            <Box>
              <Typography sx={{ fontSize: 'var(--ov-text-xs)', color: 'var(--ov-fg-muted)', mb: 0.5, fontWeight: 600 }}>
                Timer — Elapsed time / countdown display
              </Typography>
              <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', height: 22, bgcolor: 'var(--ov-bg-surface)', px: 0.5, borderRadius: '4px' }}>
                <IDEStatusFooter.Timer time="02:34" icon={<LuClock size={10} />} running tooltip="Build elapsed time" />
                <IDEStatusFooter.Separator />
                <IDEStatusFooter.Timer time="1h 23m" tooltip="Session duration" />
              </Box>
            </Box>

            {/* Spinners */}
            <Box>
              <Typography sx={{ fontSize: 'var(--ov-text-xs)', color: 'var(--ov-fg-muted)', mb: 0.5, fontWeight: 600 }}>
                Spinner — Activity indicators
              </Typography>
              <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', height: 22, bgcolor: 'var(--ov-bg-surface)', px: 0.5, borderRadius: '4px' }}>
                <IDEStatusFooter.Spinner label="Indexing workspace..." />
                <IDEStatusFooter.Separator />
                <IDEStatusFooter.Spinner label="Building plugin..." tooltip="kubernetes plugin build in progress" />
              </Box>
            </Box>
          </Box>
        </Example>

        <Example title="Themed Status Bars">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {/* Connected state */}
            <Box sx={{ border: '1px solid var(--ov-border-default)', borderRadius: '6px', overflow: 'hidden' }}>
              <IDEStatusFooter
                left={
                  <>
                    <IDEStatusFooter.Chip label="Connected" bgColor="#1a7f37" icon={<LuWifi size={9} />} />
                    <IDEStatusFooter.Text icon={<LuGitBranch size={11} />}>main</IDEStatusFooter.Text>
                  </>
                }
                right={
                  <IDEStatusFooter.Text>Ready</IDEStatusFooter.Text>
                }
              />
            </Box>

            {/* Building state */}
            <Box sx={{ border: '1px solid var(--ov-border-default)', borderRadius: '6px', overflow: 'hidden' }}>
              <IDEStatusFooter
                left={
                  <>
                    <IDEStatusFooter.Chip label="Building" bgColor="#9a6700" icon={<LuZap size={9} />} />
                    <IDEStatusFooter.Progress width={100} label="Compiling..." />
                  </>
                }
                right={
                  <>
                    <IDEStatusFooter.Timer time="00:12" icon={<LuClock size={10} />} running />
                    <IDEStatusFooter.Circular />
                  </>
                }
              />
            </Box>

            {/* Error state */}
            <Box sx={{ border: '1px solid var(--ov-border-default)', borderRadius: '6px', overflow: 'hidden' }}>
              <IDEStatusFooter
                left={
                  <>
                    <IDEStatusFooter.Chip label="Error" bgColor="#cf222e" icon={<LuCloudOff size={9} />} />
                    <IDEStatusFooter.Text>Connection lost to prod-east-1</IDEStatusFooter.Text>
                  </>
                }
                right={
                  <>
                    <IDEStatusFooter.Badge count={2} icon={<LuCircleAlert size={10} />} color="var(--ov-danger-default)" />
                    <IDEStatusFooter.Button icon={<LuRefreshCw size={10} />} label="Retry" onClick={() => {}} />
                  </>
                }
              />
            </Box>
          </Box>
        </Example>
      </Section>
    </Box>
  );
}
