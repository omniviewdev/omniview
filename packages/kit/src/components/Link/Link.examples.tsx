import { Link, LinkProvider, MiddleEllipsis, Stack, Text, type LinkActivation, type LinkHandler, type LinkTarget } from '@omniviewdev/kit';
import { useState } from 'react';
import styles from './Link.examples.module.css';

const hrefOf = (target: LinkTarget) => {
  const params = Object.entries<string>(target.params ?? {}).map(([key, value]) => `${key}=${value}`);
  return `#/${target.page}${params.length === 0 ? '' : `?${params.join('&')}`}`;
};

// A handler that goes nowhere: the examples that are about the look of the link.
const QUIET: LinkHandler = { hrefOf, onOpen: () => undefined };

// How a destination is asked to open, from what the person did: the same reading a host makes of the modifiers.
function wayOf(activation: LinkActivation): string {
  const command = activation.metaKey || activation.ctrlKey;
  if (activation.button === 1 || activation.type === 'auxclick') {
    return 'background';
  }

  if (command && activation.shiftKey) {
    return 'new';
  }

  if (command) {
    return 'background';
  }

  if (activation.shiftKey) {
    return 'window';
  }

  return activation.altKey ? 'here' : 'plain';
}

/**
 * A link read in a sentence. The link has no underline at rest (the mock's), so its colour alone sets it apart, and axe's rule for a
 * link inside running text asks for more; the words are therefore the sentence's separate boxes, as a row of a page lays them.
 */
export const InSentence = () => (
  <LinkProvider handler={QUIET}>
    <Stack direction="row" gap={4} align="baseline">
      <Text>Owned by the</Text>
      <Link to={{ page: 'groups', params: { name: 'north-yard' } }}>north-yard</Link>
      <Text>group, which runs it.</Text>
    </Stack>
  </LinkProvider>
);

/** An identifier or a selector: the code face. */
export const Mono = () => (
  <LinkProvider handler={QUIET}>
    <Link mono to={{ page: 'items', params: { name: 'orders-api' } }}>
      orders-api-7d8c6f49b-x7k2m
    </Link>
  </LinkProvider>
);

/** A long name in a box narrower than it: the start gives way with an ellipsis and the end stays whole. The link is the name, no wider. */
export const ClippedByNarrowBox = () => (
  <LinkProvider handler={QUIET}>
    <div className={styles.narrow}>
      <Link to={{ page: 'items', params: { name: 'orders-reconciliation-worker-6f9d8b7c5d-x7k2m' } }}>
        <MiddleEllipsis tail={6}>orders-reconciliation-worker-6f9d8b7c5d-x7k2m</MiddleEllipsis>
      </Link>
    </div>
  </LinkProvider>
);

/** The same box with a short name: nothing is cut. */
export const ShortInNarrowBox = () => (
  <LinkProvider handler={QUIET}>
    <div className={styles.narrow}>
      <Link to={{ page: 'items', params: { name: 'orders-api' } }}>
        <MiddleEllipsis>orders-api</MiddleEllipsis>
      </Link>
    </div>
  </LinkProvider>
);

/** Choose it as the host would read it: click, Enter, or a click with Command or Control, Shift or Option, or the middle button. The status line says how the destination was asked to open. */
export const ReportsItsActivation = () => {
  const [line, setLine] = useState('Nothing opened yet.');
  const handler: LinkHandler = {
    hrefOf,
    onOpen: (target, activation) => {
      setLine(`Opened ${target.page} as ${wayOf(activation)}`);
    },
  };
  return (
    <LinkProvider handler={handler}>
      <Stack gap={4} align="start">
        <Link to={{ page: 'items', params: { name: 'orders-api' } }}>orders-api</Link>
        <Text variant="caption" tone="muted">
          <span role="status">{line}</span>
        </Text>
      </Stack>
    </LinkProvider>
  );
};
