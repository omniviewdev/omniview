import { Button, Icon, KeyValue, KindTile, Link, LinkProvider, Status, Text, isIconName, type LinkActivation, type LinkHandler } from '@omniviewdev/kit';
import { useMemo, useState } from 'react';
import type { Route, SessionId } from '../core/panel';
import { cardOf, type CardAction } from './card';
import styles from './Card.module.css';
import { usePanel } from './context';
import { useSession, useToolItem } from './hooks';
import type { PanelCard } from './host';

const FALLBACK_GLYPH = 'box';

/** A plain click: what the card's own button asks of the tab model (smart open). */
const CLICK: LinkActivation = { type: 'click', button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };

/** The resource's name: a real link when it has a route (it opens the resource's page through the tab model, like every link), else text. */
function Resource({ label, route }: { readonly label: string; readonly route: Route | undefined }) {
  const { linkOf } = usePanel();
  const link = useMemo(() => (route === undefined ? undefined : linkOf(route)), [linkOf, route]);
  const handler = useMemo<LinkHandler | undefined>(() => (link === undefined ? undefined : { hrefOf: () => link.href, onOpen: (_target, activation) => {
    link.open(activation); 
  } }), [link]);
  if (route === undefined || handler === undefined) {
    return <Text>{label}</Text>;
  }

  return (
    <LinkProvider handler={handler}>
      <Link to={{ page: route.contribution }}>{label}</Link>
    </LinkProvider>
  );
}

/** One button of the card. The button that opens the resource asks the host to open it; the others are the plugin's. */
function Action({ action, route }: { readonly action: CardAction; readonly route: Route | undefined }) {
  const { linkOf } = usePanel();
  return (
    <Button
      icon={action.icon !== undefined && isIconName(action.icon) ? action.icon : undefined}
      disabledReason={action.disabledReason}
      onClick={() => {
        if (action.opens && route !== undefined) {
          linkOf(route).open(CLICK);
        } else {
          action.onSelect();
        }
      }}
    >
      {action.label}
    </Button>
  );
}

/** What the card of a session draws: the plugin's description, completed by the host (`cardOf`, ./card.ts). A description that throws is the host's own card. */
export function SessionCard({ id }: { readonly id: SessionId }) {
  const { cardOf: describe } = usePanel();
  const session = useSession(id);
  const tool = useToolItem(session?.tool ?? '');
  // When the card opened: a card is made when it opens (the hover card keys it), so the age it words is as of that moment.
  const [now] = useState(() => Date.now());
  if (session === undefined || tool === undefined) {
    return null;
  }

  let given: PanelCard | undefined;
  try {
    given = describe(session);
  } catch (error) {
    // A plugin's description that throws is the plugin's defect: the card falls back to the host's own, and the failure is in the console, not on the page (the plugin's words never reach it).
    console.warn('[panel] a session card failed to describe itself', error);
  }

  const card = cardOf(session, tool, given, now);
  const facts = [
    ...card.facts.map(([label, value]) => ({ label, value })),
    {
      label: 'State',
      value: (
        <>
          <Status role={card.state.role}>{card.state.label}</Status>
          {card.state.since === '' ? null : <span className={styles.since}>{` · since ${card.state.since}`}</span>}
        </>
      ),
    },
  ];
  return (
    <div className={styles.card} data-shell-part="sessionCard">
      <div className={styles.head}>
        <Icon name={isIconName(card.icon) ? card.icon : FALLBACK_GLYPH} />
        <Text variant="title">{card.kind}</Text>
      </div>
      {card.resource === undefined ? null : (
        <div className={styles.resource}>
          <KindTile icon={card.resource.icon !== undefined && isIconName(card.resource.icon) ? card.resource.icon : isIconName(tool.icon) ? tool.icon : FALLBACK_GLYPH} />
          <span className={styles.resourceName}>
            <Resource label={card.resource.label} route={card.resource.route} />
          </span>
        </div>
      )}
      <KeyValue rows={facts} labelWidth={96} />
      {card.state.reason === '' ? null : (
        <Text variant="caption" as="p">
          {card.state.reason}
        </Text>
      )}
      {card.actions.length === 0 ? null : (
        <div className={styles.actions}>
          {card.actions.map((action) => (
            <Action key={action.label} action={action} route={card.resource?.route} />
          ))}
        </div>
      )}
    </div>
  );
}
