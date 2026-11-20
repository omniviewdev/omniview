import { useEffect, useState } from 'react';
import { createPanelStore, HOST, type PanelStore, type Session, type SessionInput, type ToolId, type ToolInput } from '../core/panel';
import type { PanelBindings } from './host';

// Test and probe support: a panel whose tools and sessions are invented, so a test or a probe can draw the bottom panel without a plugin host. Nothing in the product imports this file; the
// panel's tests, the shell probe's fixture and the panel probe's fixture do. The model is the real one (core/panel): only what a tool's body says, what a card says and what a `+` opens
// are invented here, where the product's host asks the plugins.

/** How often a running stream gets a line: fast enough for a check to see it count while the body is hidden. */
export const LINE_MS = 100;

/** The body of an invented stream: it counts lines while its session runs and keeps counting while its body is hidden, as a streaming session keeps its buffer (HLT-32). `data-lines` is what a check reads. */
export function StreamBody({ session, visible }: { readonly session: Session; readonly visible: boolean }) {
  const [lines, setLines] = useState(0);
  const running = session.state === 'running';
  useEffect(() => {
    if (!running) {
      return undefined;
    }

    const timer = setInterval(() => {
      setLines((count) => count + 1);
    }, LINE_MS);
    return () => {
      clearInterval(timer);
    };
  }, [running]);

  return (
    <div data-fixture="stream" data-session={session.title} data-state={session.state} data-visible={visible ? 'true' : 'false'} data-lines={lines}>
      {`${session.title} · ${session.state} · ${String(lines)} lines`}
    </div>
  );
}

/** A session a static panel opens: the model's input, in the host's name. */
export type StaticSession = Omit<SessionInput, 'plugin'>;

export type StaticPanelOptions = {
  /** An existing model; default: a new one. */
  readonly store?: PanelStore | undefined;
  /** The tools of the host, in the order they register. Default: none. */
  readonly tools?: readonly ToolInput[] | undefined;
  /** Sessions open from the start, in the host's name. They do not reveal the panel. */
  readonly sessions?: readonly StaticSession[] | undefined;
  /** Where the panel starts: open on its tool, or hidden. Default: hidden. */
  readonly open?: boolean | undefined;
  /** What the `+` of a tool opens, by tool id: a tool that is not listed has no `+`. */
  readonly start?: Readonly<Record<ToolId, { readonly label: string; readonly open: () => Omit<StaticSession, 'tool'> }>> | undefined;
  readonly renderBody?: PanelBindings['renderBody'] | undefined;
  readonly cardOf?: PanelBindings['cardOf'] | undefined;
  readonly linkOf?: PanelBindings['linkOf'] | undefined;
  readonly emptyOf?: PanelBindings['emptyOf'] | undefined;
};

/** What the shell asks of its host to draw a panel, answered with invented tools and sessions over the real model. The model is `bindings.store`. */
export function staticPanel(options: StaticPanelOptions = {}): PanelBindings {
  const store = options.store ?? createPanelStore();
  for (const tool of options.tools ?? []) {
    store.registerTool(tool);
  }

  for (const session of options.sessions ?? []) {
    store.openSession({ ...session, plugin: HOST }, { reveal: false });
  }

  if (options.open === true) {
    store.show();
  }

  return {
    store,
    renderBody: options.renderBody ?? ((session, visible) => <StreamBody session={session} visible={visible} />),
    cardOf: options.cardOf ?? (() => undefined),
    emptyOf: options.emptyOf,
    newSessionOf: (tool) => {
      const add = options.start?.[tool];
      return add === undefined
        ? undefined
        : {
          label: add.label,
          start: () => {
            store.openSession({ ...add.open(), tool, plugin: HOST });
          },
        };
    },
    linkOf: options.linkOf ?? ((route) => ({ href: `#/${route.plugin}/${route.contribution}`, open: () => undefined })),
  };
}
