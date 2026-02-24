import React from 'react';
import { LuCode, LuSquareChartGantt, LuZap } from 'react-icons/lu';
import type { DrawerComponentView, DrawerContext } from '@omniviewdev/runtime';

import { createMetricsView } from './pages/metrics/ResourceMetricsPage';
import ResourceEventsView from '../../kubernetes/sidebar/ResourceEventsView';
import BaseEditorPage from './pages/editor/BaseEditorPage';

/**
 * Returns the canonical set of drawer views for a Kubernetes resource sidebar:
 * [Overview, Metrics, Events, Editor].
 *
 * Tables use this for their `views` array (keeping custom `actions` alongside),
 * and the drawer factory in `entry.ts` uses it so linked-resource clicks get the
 * same view set.
 */
export function createStandardViews<T = any>(opts: {
  SidebarComponent: React.FC<{ ctx: DrawerContext<T> }>;
  onEditorSubmit?: (ctx: DrawerContext<T>, value: Record<string, any>) => void;
}): Array<DrawerComponentView<T>> {
  const { SidebarComponent, onEditorSubmit } = opts;

  return [
    {
      title: 'Overview',
      icon: <LuSquareChartGantt />,
      component: (ctx) => <SidebarComponent ctx={ctx} />,
    },
    createMetricsView(),
    {
      title: 'Events',
      icon: <LuZap />,
      component: (ctx) => <ResourceEventsView ctx={ctx as DrawerContext} />,
    },
    {
      title: 'Editor',
      icon: <LuCode />,
      component: onEditorSubmit
        ? (ctx) => <BaseEditorPage data={ctx.data as any} onSubmit={(val) => onEditorSubmit(ctx, val)} />
        : (ctx) => <BaseEditorPage data={ctx.data as any} />,
    },
  ];
}
