import { act, cleanup, render, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import { createContext, StrictMode, useContext, useState, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as kit from '@omniviewdev/kit';
import { rootWrites } from '../../../scripts/rootWrites.ts';
import { HoverCardHost, type HoverCardContent, type HoverCardHostProps } from './HoverCard';
import * as examples from './HoverCard.examples';
import { hoverCard, hoverCardAnchor } from './card';

// jsdom has neither layout nor the Popover API, nor a reliable :focus-visible: the tests give the host what a browser would.
const inTopLayer = new WeakSet<Element>();
let focusVisible = true;
const realMatches = Element.prototype.matches;

beforeEach(() => {
  vi.useFakeTimers();
  focusVisible = true;
  HTMLElement.prototype.showPopover = function showPopover(this: HTMLElement) {
    inTopLayer.add(this);
    // What :popover-open does to the engine's own rules: a closed popover is display none, and nothing in it can take the focus.
    this.style.display = 'block';
  };

  HTMLElement.prototype.hidePopover = function hidePopover(this: HTMLElement) {
    inTopLayer.delete(this);
    this.style.display = '';
  };

  Object.defineProperty(Element.prototype, 'matches', {
    configurable: true,
    writable: true,
    value: function matches(this: Element, selector: string) {
      if (selector === ':focus-visible') {
        return focusVisible && this === document.activeElement;
      }

      return selector === ':hover' ? false : realMatches.call(this, selector);
    },
  });
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 1440 });
  Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: 900 });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  Element.prototype.matches = realMatches;
  Reflect.deleteProperty(HTMLElement.prototype, 'showPopover');
  Reflect.deleteProperty(HTMLElement.prototype, 'hidePopover');
});

const dialog = (): HTMLElement => {
  const element = document.querySelector<HTMLElement>('[role="dialog"]');
  if (element === null) {
    throw new Error('no hover card host is mounted');
  }

  return element;
};

const region = (): HTMLElement => {
  const element = document.querySelector<HTMLElement>('[role="status"]');
  if (element === null) {
    throw new Error('no live region is mounted');
  }

  return element;
};

const isOpen = () => inTopLayer.has(dialog());
const advance = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

/** The pointer reaches `element` and rests there until the card opens. */
function hover(element: Element, ms = 500) {
  act(() => {
    element.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
  });
  advance(ms);
}

function leave(element: Element) {
  act(() => {
    element.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse', relatedTarget: document.body }));
  });
  advance(120);
}

function tabTo(element: HTMLElement) {
  focusVisible = true;
  act(() => {
    element.focus();
  });
}

const press = (key: string) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  act(() => {
    (document.activeElement ?? document.body).dispatchEvent(event);
  });
  return event;
};

const CARDS: Readonly<Record<string, HoverCardContent>> = {
  one: {
    label: 'Card one',
    announce: 'Press Down Arrow to reach its actions.',
    content: (
      <>
        <p>First card</p>
        <a href="#open">Open</a>
        <button type="button">Stop</button>
      </>
    ),
  },
  two: { label: 'Card two', content: <p>Second card</p> },
};

const trigger = (key: string, arrow = true): ReactElement => (
  <div {...hoverCardAnchor()} key={key}>
    <button type="button" {...hoverCard(key, arrow ? { arrow: 'down' } : {})}>
      Trigger {key}
    </button>
  </div>
);

function mount(renderCard: HoverCardHostProps['render'] = (key) => CARDS[key], children: ReactNode = [trigger('one'), trigger('two')]) {
  return render(
    <>
      <HoverCardHost render={renderCard} />
      {children}
    </>,
  );
}

const triggerOf = (name: string) => screen.getByRole('button', { name });

describe('HoverCardHost', () => {
  it('is one popover element with role dialog and a live region beside it, both empty until a card opens', () => {
    mount();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.querySelectorAll('[role="status"]')).toHaveLength(1);
    const element = dialog();
    expect(element.getAttribute('popover')).toBe('manual');
    expect(element.getAttribute('data-ov-part')).toBe('hover-card');
    expect(element.childElementCount).toBe(0);
    expect(element.hasAttribute('aria-label')).toBe(false);
    expect(element.hasAttribute('aria-hidden')).toBe(false);
    expect(isOpen()).toBe(false);
    expect(region().getAttribute('aria-live')).toBe('polite');
    expect(region().textContent).toBe('');
    expect(region().childElementCount).toBe(0);
  });

  it('refuses a second host in the same window: there is one popup for the whole page', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() =>
      render(
        <>
          <HoverCardHost render={() => undefined} />
          <HoverCardHost render={() => undefined} />
        </>,
      ),
    ).toThrow(/one HoverCardHost/i);
  });

  it('mounts again after it unmounted, and under StrictMode, which runs its effects twice', () => {
    const first = render(<HoverCardHost render={() => undefined} />);
    first.unmount();
    expect(() => render(<HoverCardHost render={() => undefined} />)).not.toThrow();
    cleanup();
    expect(() =>
      render(
        <StrictMode>
          <HoverCardHost render={(key) => CARDS[key]} />
          {trigger('one')}
        </StrictMode>,
      ),
    ).not.toThrow();
    hover(triggerOf('Trigger one'));
    expect(isOpen()).toBe(true);
  });

  it('is not part of the tree it serves: nothing binds per trigger, and 1,000 triggers add no listener', () => {
    const add = vi.spyOn(EventTarget.prototype, 'addEventListener');
    const addWindow = vi.spyOn(window, 'addEventListener');
    const view = render(<HoverCardHost render={(key) => CARDS[key]} />);
    expect(add.mock.calls.length + addWindow.mock.calls.length).toBeGreaterThan(0);
    add.mockClear();
    addWindow.mockClear();
    const many = Array.from({ length: 1000 }, (_, index) => (
      <button key={index} type="button" {...hoverCard('one')}>
        {index}
      </button>
    ));
    view.rerender(
      <>
        <HoverCardHost render={(key) => CARDS[key]} />
        {many}
      </>,
    );
    expect(document.querySelectorAll('[data-ov-card]')).toHaveLength(1000);
    expect(add).not.toHaveBeenCalled();
    expect(addWindow).not.toHaveBeenCalled();
  });

  it('draws what render gives for the key of the trigger, 500 ms after the pointer reaches it, named by its label', () => {
    mount();
    const one = triggerOf('Trigger one');
    act(() => {
      one.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
    });
    advance(499);
    expect(isOpen()).toBe(false);
    expect(dialog().childElementCount).toBe(0);
    advance(1);
    expect(isOpen()).toBe(true);
    const card = screen.getByRole('dialog', { name: 'Card one' });
    expect(card).toBe(dialog());
    expect(within(card).getByText('First card')).toBeTruthy();
    expect(within(card).getAllByRole('link')).toHaveLength(1);
    expect(within(card).getAllByRole('button').map((button) => button.textContent)).toEqual(['Stop']);
    expect(card.querySelector('[aria-hidden]')).toBeNull();
    expect(card.getAttribute('data-placement')).toBe('bottom');
    expect(one.hasAttribute('aria-describedby')).toBe(false);
    expect(one.hasAttribute('aria-haspopup')).toBe(false);
  });

  it('draws the content inside its own element, so the providers above the host apply and a store the content reads is its own', () => {
    const Theme = createContext('light');
    function Reads() {
      const [count, setCount] = useState(0);
      return (
        <button type="button" onClick={() => {
          setCount(count + 1); 
        }}>
          {useContext(Theme)} {count}
        </button>
      );
    }

    render(
      <Theme.Provider value="dark">
        <HoverCardHost render={() => ({ label: 'Reads', content: <Reads /> })} />
        <button type="button" {...hoverCard('x')}>
          Trigger x
        </button>
      </Theme.Provider>,
    );
    hover(triggerOf('Trigger x'));
    const reads = within(dialog()).getByRole('button', { name: 'dark 0' });
    act(() => {
      reads.click();
    });
    expect(within(dialog()).getByRole('button', { name: 'dark 1' })).toBe(reads);
    expect(isOpen()).toBe(true);
  });

  it('closes an open card when render has none for its key now, and never opens one that has none', () => {
    const view = mount();
    hover(triggerOf('Trigger one'));
    expect(isOpen()).toBe(true);
    view.rerender(
      <>
        <HoverCardHost render={() => undefined} />
        {trigger('one')}
        {trigger('two')}
      </>,
    );
    expect(isOpen()).toBe(false);
    expect(dialog().childElementCount).toBe(0);
    expect(dialog().hasAttribute('aria-label')).toBe(false);
    leave(triggerOf('Trigger one'));
    hover(triggerOf('Trigger one'), 2000);
    expect(isOpen()).toBe(false);
  });

  it('does not carry the state of one card to the next: the content of another key starts afresh', () => {
    function Counter() {
      const [count, setCount] = useState(0);
      return (
        <button type="button" onClick={() => {
          setCount(count + 1); 
        }}>
          {`Count ${count}`}
        </button>
      );
    }

    mount((key) => ({ label: key, content: <Counter /> }));
    hover(triggerOf('Trigger one'));
    act(() => {
      within(dialog()).getByRole('button', { name: 'Count 0' }).click();
    });
    expect(within(dialog()).getByRole('button', { name: 'Count 1' })).toBeTruthy();
    hover(triggerOf('Trigger two'), 0);
    expect(within(dialog()).getByRole('button', { name: 'Count 0' })).toBeTruthy();
    expect(dialog().getAttribute('aria-label')).toBe('two');
  });

  it('says its announcement once through the live region when keyboard focus opens a card with controls, and clears it when the card closes', () => {
    mount();
    const one = triggerOf('Trigger one');
    tabTo(one);
    advance(499);
    expect(region().textContent).toBe('');
    advance(1);
    expect(region().textContent).toBe('Press Down Arrow to reach its actions.');
    expect(region().closest('[popover]')).toBeNull();
    press('Escape');
    expect(region().textContent).toBe('');
    expect(isOpen()).toBe(false);
  });

  it('says nothing for the pointer, and nothing for a card that has no controls or no announcement', () => {
    mount();
    hover(triggerOf('Trigger one'));
    expect(region().textContent).toBe('');
    leave(triggerOf('Trigger one'));
    const two = triggerOf('Trigger two');
    tabTo(two);
    advance(500);
    expect(isOpen()).toBe(true);
    expect(region().textContent).toBe('');
  });

  it('is entered by the Down arrow on a trigger that asks, which takes the focus to the first control; Escape closes it and gives the focus back', () => {
    mount();
    const one = triggerOf('Trigger one');
    tabTo(one);
    const event = press('ArrowDown');
    expect(event.defaultPrevented).toBe(true);
    expect(isOpen()).toBe(true);
    expect(document.activeElement).toBe(within(dialog()).getByRole('link'));
    press('Tab');
    expect(document.activeElement).toBe(within(dialog()).getByRole('button', { name: 'Stop' }));
    press('Tab');
    expect(document.activeElement).toBe(within(dialog()).getByRole('link'));
    expect(press('Escape').defaultPrevented).toBe(true);
    expect(isOpen()).toBe(false);
    expect(document.activeElement).toBe(one);
  });

  it('closes after a click on a control in the card, once the control has handled it', () => {
    const onStop = vi.fn();
    mount((key) => ({ label: key, content: <button type="button" onClick={onStop}>Stop</button> }));
    hover(triggerOf('Trigger one'));
    act(() => {
      within(dialog()).getByRole('button', { name: 'Stop' }).click();
    });
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(isOpen()).toBe(true);
    advance(0);
    expect(isOpen()).toBe(false);
  });

  it('writes nothing to the document root or the body, while it opens, moves and closes', () => {
    mount();
    const writes = rootWrites(() => {
      hover(triggerOf('Trigger one'));
      hover(triggerOf('Trigger two'), 0);
      press('Escape');
    });
    expect(writes).toEqual([]);
    expect(document.documentElement.getAttribute('style')).toBeNull();
    expect([...document.documentElement.style].filter((property) => property.startsWith('--'))).toEqual([]);
  });

  it('has closed props: render, and nothing else', () => {
    // Types only: these are never rendered.
    const accepted: HoverCardHostProps = { render: () => undefined };
    // @ts-expect-error className is not a prop of a kit part
    const withClass: HoverCardHostProps = { render: () => undefined, className: 'x' };
    // @ts-expect-error style is not a prop of a kit part
    const withStyle: HoverCardHostProps = { render: () => undefined, style: { color: 'red' } };
    // @ts-expect-error the host draws what render gives: it takes no children
    const withChildren: HoverCardHostProps = { render: () => undefined, children: 'x' };
    // @ts-expect-error a host with nothing to render has no cards
    const noRender: HoverCardHostProps = {};
    // @ts-expect-error a card has a name: an accessible name is not optional
    const noLabel: HoverCardContent = { content: 'x' };
    // @ts-expect-error the announcement is text
    const loudNumber: HoverCardContent = { label: 'x', content: 'x', announce: 3 };
    expect([accepted, withClass, withStyle, withChildren, noRender, noLabel, loudNumber]).toHaveLength(7);
  });

  it('is the whole public surface of the part: the host, the trigger helper and the anchor helper', () => {
    expect(Object.keys(kit).filter((name) => /hovercard/i.test(name)).sort()).toEqual(['HoverCardHost', 'hoverCard', 'hoverCardAnchor']);
    expect(kit.hoverCard).toBe(hoverCard);
    expect(kit.hoverCardAnchor).toBe(hoverCardAnchor);
    expect(kit.HoverCardHost).toBe(HoverCardHost);
  });
});

// The a11y matrix of the examples: what a user of assistive technology meets for each state a hover card is shown in.
type CardRow = {
  /** The name of the card: the accessible name of its dialog. */
  readonly name: string;
  /** The links and buttons in it, in order. */
  readonly controls: readonly string[];
  /** The sentence said when keyboard focus opens it, if it says one. */
  readonly announce?: string;
};
type Row = {
  /** The triggers, by name, with the key of the card each opens. */
  readonly triggers: Readonly<Record<string, string>>;
  /** The triggers that ask for the Down arrow. */
  readonly arrow: readonly string[];
  /** The cards, by key. */
  readonly cards: Readonly<Record<string, CardRow>>;
};
const MATRIX: Readonly<Record<string, Row>> = {
  TabsWithCards: {
    triggers: { 'Logs · orders-api': 'logs', 'Shell · orders-api': 'shell', Notes: 'notes' },
    arrow: ['Logs · orders-api', 'Shell · orders-api'],
    cards: {
      logs: {
        name: 'Logs for orders-api',
        controls: ['Service orders-api', 'Open service', 'Stop'],
        announce: 'Logs for orders-api, streaming since 08:41. Press Down Arrow to reach its actions.',
      },
      shell: {
        name: 'Shell in orders-api',
        controls: ['Service orders-api', 'Open service', 'Retry'],
        announce: 'Shell in orders-api, failed. Press Down Arrow to reach its actions.',
      },
      notes: { name: 'About notes', controls: [] },
    },
  },
};

/** What the WCAG rules that need no layout say about the page: contrast needs real styles, which jsdom has none of. */
async function violations(): Promise<string[]> {
  vi.useRealTimers();
  const result = await axe.run(document.body, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
    rules: { 'color-contrast': { enabled: false } },
    resultTypes: ['violations'],
  });
  vi.useFakeTimers();
  return result.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.html).join(' | ')}`);
}

describe('HoverCard examples: the a11y matrix', () => {
  it('has a row for every example, and an example for every row', () => {
    expect(Object.keys(examples).sort()).toEqual(Object.keys(MATRIX).sort());
  });

  for (const [exampleName, row] of Object.entries(MATRIX)) {
    const Example = (examples as Record<string, () => ReactElement>)[exampleName];
    it(`${exampleName}: triggers ${Object.keys(row.triggers).join(', ')}; a card for each, named, with its controls, and nothing for axe to find`, async () => {
      expect(Example).toBeDefined();
      if (Example === undefined) {
        return;
      }

      render(<Example />);
      expect(await violations()).toEqual([]);
      for (const [name, key] of Object.entries(row.triggers)) {
        const element = triggerOf(name);
        expect(element.getAttribute('data-ov-card')).toBe(key);
        expect(element.getAttribute('data-ov-card-arrow') === 'down').toBe(row.arrow.includes(name));
        expect(element.tabIndex).toBe(0);
        expect(element.hasAttribute('title')).toBe(false);
      }

      // the anchor of a tab holds its trigger and its close button, so the card never covers it
      for (const anchor of document.querySelectorAll('[data-ov-card-anchor]')) {
        expect(within(anchor as HTMLElement).getAllByRole('button')).toHaveLength(2);
      }

      for (const [name, key] of Object.entries(row.triggers)) {
        const card = row.cards[key];
        expect(card, key).toBeDefined();
        if (card === undefined) {
          continue;
        }

        const element = triggerOf(name);
        tabTo(element);
        advance(500);
        const opened = screen.getByRole('dialog', { name: card.name });
        expect(inTopLayer.has(opened), key).toBe(true);
        expect(
          within(opened)
            .queryAllByRole('link')
            .concat(within(opened).queryAllByRole('button'))
            .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
            .map((control) => control.textContent),
          key,
        ).toEqual(card.controls);
        expect(region().textContent, key).toBe(card.announce ?? '');
        // nothing the card says or offers is hidden from assistive technology: only decoration (a glyph, a kind tile) is
        expect(opened.hasAttribute('aria-hidden'), key).toBe(false);
        for (const hidden of opened.querySelectorAll('[aria-hidden="true"]')) {
          expect(hidden.textContent?.trim(), key).toBe('');
          expect(hidden.querySelector('a[href], button'), key).toBeNull();
        }

        expect(await violations(), key).toEqual([]);
        press('Escape');
        expect(inTopLayer.has(opened), key).toBe(false);
        act(() => {
          element.blur();
        });
      }
    });
  }
});
