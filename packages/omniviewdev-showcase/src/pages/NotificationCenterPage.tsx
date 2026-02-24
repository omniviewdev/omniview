import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { LuCircleCheck, LuCircleAlert, LuInfo } from 'react-icons/lu';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import ImportStatement from '../helpers/ImportStatement';
import PropsTable from '../helpers/PropsTable';

import { NotificationCenter } from '@omniviewdev/ui/overlays';
import type { NotificationItem } from '@omniviewdev/ui/overlays';
import { Button } from '@omniviewdev/ui/buttons';

const initialNotifications: NotificationItem[] = [
  { id: '1', title: 'Build succeeded', message: 'kubernetes-plugin v2.4.1 built in 12s', timestamp: new Date(Date.now() - 120000), icon: <LuCircleCheck size={14} />, color: 'success', action: { label: 'View logs', onClick: () => {} } },
  { id: '2', title: 'High CPU warning', message: 'Pod nginx-abc123 is at 92% CPU usage', timestamp: new Date(Date.now() - 3600000), icon: <LuCircleAlert size={14} />, color: 'warning' },
  { id: '3', title: 'Plugin update available', message: 'kubernetes v3.0.0 is now available', timestamp: new Date(Date.now() - 7200000), icon: <LuInfo size={14} />, color: 'info', read: true, action: { label: 'Update now', onClick: () => {} } },
  { id: '4', title: 'Connection restored', message: 'cluster-prod is now reachable', timestamp: new Date(Date.now() - 86400000), icon: <LuCircleCheck size={14} />, color: 'success', read: true },
];

export default function NotificationCenterPage() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState(initialNotifications);

  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 'var(--ov-weight-bold)', color: 'var(--ov-fg-base)', mb: '32px' }}>
        Notification Center
      </Typography>

      <Section title="NotificationCenter" description="Slide-out notification panel with read/unread grouping, timestamps, dismiss, and action links.">
        <ImportStatement code="import { NotificationCenter } from '@omniviewdev/ui/overlays';" />

        <Example title="Interactive Demo">
          <Button emphasis="soft" color="primary" onClick={() => setOpen(true)}>
            Open Notifications ({notifications.filter((n) => !n.read).length} unread)
          </Button>

          <NotificationCenter
            open={open}
            onClose={() => setOpen(false)}
            notifications={notifications}
            onDismiss={(id) => setNotifications((prev) => prev.filter((n) => n.id !== id))}
            onMarkRead={(id) => setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read: true } : n))}
            onClearAll={() => setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))}
          />
        </Example>

        <PropsTable
          props={[
            { name: 'open', type: 'boolean', description: 'Whether the panel is visible.' },
            { name: 'onClose', type: '() => void', description: 'Called to close the panel.' },
            { name: 'notifications', type: 'NotificationItem[]', description: 'Notification items to display.' },
            { name: 'onDismiss', type: '(id: string) => void', description: 'Called when a notification is dismissed.' },
            { name: 'onMarkRead', type: '(id: string) => void', description: 'Called when a notification is clicked/read.' },
            { name: 'onClearAll', type: '() => void', description: 'Called when "Clear all" is clicked.' },
            { name: 'width', type: 'number', default: '360', description: 'Panel width in pixels.' },
          ]}
        />
      </Section>
    </Box>
  );
}
