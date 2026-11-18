import { createContext, useContext, type MouseEvent, type ReactElement, type ReactNode } from 'react';
import { dataAttributes, type DataAttributes } from '../../shared/dataAttributes';
import styles from './Link.module.css';

/** Where a link goes, in the host's words: one of the pages of the plugin the link is in, and that page's parameters. The kit never reads either: it hands them to the provider. */
export type LinkTarget = { readonly page: string; readonly params?: Readonly<Record<string, string>> | undefined };

/** What the person did, as the facts of the event: the host maps them to where the destination opens. Structurally a `ModifierEvent` of the shell. */
export type LinkActivation = {
  readonly type: string;
  readonly button: number;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
};

export type LinkHandler = {
  /** The address a target stands for: the link's `href` (a real anchor: the platform shows it, "Copy Link" copies it). */
  readonly hrefOf: (target: LinkTarget) => string;
  /** The link was chosen: a click (the modifiers say how), a middle click, Enter on the focused link. */
  readonly onOpen: (target: LinkTarget, activation: LinkActivation) => void;
};

const LinkContext = createContext<LinkHandler | null>(null);

export type LinkProviderProps = {
  readonly handler: LinkHandler;
  readonly children: ReactNode;
};

/** Says what a link's address is and what choosing it does. The kit knows no router and no shell: the host (or a test, or an example) is the handler. */
export function LinkProvider({ handler, children }: LinkProviderProps): ReactElement {
  return <LinkContext.Provider value={handler}>{children}</LinkContext.Provider>;
}

export type LinkProps = {
  readonly to: LinkTarget;
  readonly children: ReactNode;
  /** The text is an identifier or a selector: the code face. */
  readonly mono?: boolean | undefined;
} & DataAttributes;

function activationOf(event: MouseEvent<HTMLAnchorElement>): LinkActivation {
  return { type: event.type, button: event.button, metaKey: event.metaKey, ctrlKey: event.ctrlKey, shiftKey: event.shiftKey, altKey: event.altKey };
}

/**
 * A link to a destination in the host: a native anchor, so the platform shows its address and offers "Copy Link", and Enter on it is a
 * click. A left click (modified or not) and a middle click are the host's to open: the link reports what the person did through the
 * provider's `onOpen` and stops the platform's own navigation, once per activation. A right click is left to the platform's menu. A click that
 * something else already took is not the link's. It needs a `LinkProvider` above it. Props are closed: no `className`, no `style`, no
 * `title`; `data-*` passes through.
 */
export function Link({ to, children, mono, ...rest }: LinkProps): ReactElement {
  const handler = useContext(LinkContext);
  if (handler === null) {
    throw new TypeError('Link needs a LinkProvider');
  }

  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0) {
      return;
    }

    event.preventDefault();
    handler.onOpen(to, activationOf(event));
  };

  // The middle button fires auxclick, not click: it opens in the background, and the platform's own new tab is not wanted.
  const onAuxClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 1) {
      return;
    }

    event.preventDefault();
    handler.onOpen(to, activationOf(event));
  };

  // No autoscroll cursor on a middle press.
  const onMouseDown = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button === 1) {
      event.preventDefault();
    }
  };

  return (
    <a
      {...dataAttributes(rest)}
      className={styles.root}
      href={handler.hrefOf(to)}
      data-ov-part="link"
      data-ov-mono={mono === true ? 'true' : undefined}
      onClick={onClick}
      onAuxClick={onAuxClick}
      onMouseDown={onMouseDown}
    >
      {children}
    </a>
  );
}
