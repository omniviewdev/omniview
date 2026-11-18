import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentType, ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { cssRules, declarationsOf } from '../../../scripts/cssRules.ts';
import { rootWrites } from '../../../scripts/rootWrites.ts';
import { Link, LinkProvider, type LinkActivation, type LinkHandler, type LinkProps, type LinkTarget } from './Link';
import * as examples from './Link.examples';

const TARGET: LinkTarget = { page: 'items', params: { name: 'orders-api' } };

function handlerOf() {
  const onOpen = vi.fn<(target: LinkTarget, activation: LinkActivation) => void>();
  const hrefOf = vi.fn((target: LinkTarget) => `#/${target.page}/${target.params?.name ?? ''}`);
  const handler: LinkHandler = { hrefOf, onOpen };
  return { handler, onOpen, hrefOf };
}

const FACTS = { type: 'click', button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };

function renderLink(props: Partial<LinkProps> = {}) {
  const parts = handlerOf();
  const view = render(
    <LinkProvider handler={parts.handler}>
      <Link to={TARGET} {...props}>
        orders-api
      </Link>
    </LinkProvider>,
  );
  return { ...parts, ...view, link: screen.getByRole('link', { name: 'orders-api' }) };
}

describe('Link', () => {
  it('is one native anchor, whose address is the handler\'s, with no title, no target and no tab index of its own', () => {
    const { link, container, hrefOf } = renderLink();
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('#/items/orders-api');
    expect(hrefOf).toHaveBeenCalledWith(TARGET);
    expect(link.getAttribute('data-ov-part')).toBe('link');
    expect(link.textContent).toBe('orders-api');
    for (const attribute of ['title', 'target', 'rel', 'tabindex', 'style', 'role', 'aria-label']) {
      expect(link.hasAttribute(attribute), attribute).toBe(false);
    }

    expect(link.hasAttribute('data-ov-mono')).toBe(false);
    expect(container.querySelectorAll('*')).toHaveLength(1);
  });

  it('follows the handler: another target is another address', () => {
    const parts = handlerOf();
    const { rerender } = render(
      <LinkProvider handler={parts.handler}>
        <Link to={{ page: 'groups', params: { name: 'north-yard' } }}>north-yard</Link>
      </LinkProvider>,
    );
    expect(screen.getByRole('link').getAttribute('href')).toBe('#/groups/north-yard');
    rerender(
      <LinkProvider handler={parts.handler}>
        <Link to={{ page: 'groups' }}>groups</Link>
      </LinkProvider>,
    );
    expect(screen.getByRole('link').getAttribute('href')).toBe('#/groups/');
  });

  it('marks the code face with a data attribute, and only when asked', () => {
    const { link, rerender, handler } = renderLink({ mono: true });
    expect(link).toHaveProperty('dataset.ovMono', 'true');
    rerender(
      <LinkProvider handler={handler}>
        <Link to={TARGET} mono={false}>
          orders-api
        </Link>
      </LinkProvider>,
    );
    expect(screen.getByRole('link').hasAttribute('data-ov-mono')).toBe(false);
  });

  describe('activation', () => {
    it('hands a plain left click to the handler as facts, and stops the platform\'s own navigation', () => {
      const { link, onOpen } = renderLink();
      const stopped = !fireEvent.click(link);
      expect(stopped).toBe(true);
      expect(onOpen).toHaveBeenCalledTimes(1);
      expect(onOpen).toHaveBeenCalledWith(TARGET, FACTS);
    });

    it('tells the modifiers a click carried, each on its own', () => {
      const { link, onOpen } = renderLink();
      fireEvent.click(link, { metaKey: true });
      fireEvent.click(link, { ctrlKey: true });
      fireEvent.click(link, { shiftKey: true });
      fireEvent.click(link, { altKey: true });
      fireEvent.click(link, { metaKey: true, shiftKey: true });
      expect(onOpen.mock.calls.map(([, activation]) => activation)).toEqual([
        { ...FACTS, metaKey: true },
        { ...FACTS, ctrlKey: true },
        { ...FACTS, shiftKey: true },
        { ...FACTS, altKey: true },
        { ...FACTS, metaKey: true, shiftKey: true },
      ]);
    });

    it('treats Enter as the platform\'s click of detail 0, with the modifiers it carried', () => {
      const { link, onOpen } = renderLink();
      fireEvent.click(link, { detail: 0, ctrlKey: true });
      expect(onOpen).toHaveBeenCalledTimes(1);
      expect(onOpen).toHaveBeenCalledWith(TARGET, { ...FACTS, ctrlKey: true });
    });

    it('opens on a middle click (auxclick, button 1), and the platform does not open its own tab', () => {
      const { link, onOpen } = renderLink();
      const stopped = !fireEvent(link, new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }));
      expect(stopped).toBe(true);
      expect(onOpen).toHaveBeenCalledTimes(1);
      expect(onOpen).toHaveBeenCalledWith(TARGET, { ...FACTS, type: 'auxclick', button: 1 });
    });

    it('prevents the autoscroll of a middle press, and leaves every other press alone', () => {
      const { link } = renderLink();
      expect(fireEvent.mouseDown(link, { button: 1 })).toBe(false);
      expect(fireEvent.mouseDown(link, { button: 0 })).toBe(true);
      expect(fireEvent.mouseDown(link, { button: 2 })).toBe(true);
    });

    it('leaves a right click to the platform: no call, no prevented default', () => {
      const { link, onOpen } = renderLink();
      expect(fireEvent.contextMenu(link, { button: 2 })).toBe(true);
      expect(fireEvent(link, new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 2 }))).toBe(true);
      expect(onOpen).not.toHaveBeenCalled();
    });

    it('does not take a click that something else already took, and never calls twice for one activation', () => {
      const parts = handlerOf();
      render(
        <LinkProvider handler={parts.handler}>
          <div
            onClickCapture={(event) => {
              if ((event.target as HTMLElement).dataset.taken === 'true') {
                event.preventDefault();
              }
            }}
          >
            <Link to={TARGET} data-taken="true">
              taken
            </Link>
            <Link to={TARGET}>orders-api</Link>
          </div>
        </LinkProvider>,
      );
      fireEvent.click(screen.getByRole('link', { name: 'taken' }));
      expect(parts.onOpen).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('link', { name: 'orders-api' }));
      expect(parts.onOpen).toHaveBeenCalledTimes(1);
    });

    it('lets a click inside it that a child took stay the child\'s', () => {
      const parts = handlerOf();
      render(
        <LinkProvider handler={parts.handler}>
          <Link to={TARGET}>
            <span
              data-testid="inner"
              onClick={(event) => {
                event.preventDefault();
              }}
            >
              inner
            </span>
          </Link>
        </LinkProvider>,
      );
      fireEvent.click(screen.getByTestId('inner'));
      expect(parts.onOpen).not.toHaveBeenCalled();
    });

    it('still bubbles its click to a parent that listens, so a row keeps its own rule about the controls inside it', () => {
      const parts = handlerOf();
      const row = vi.fn();
      render(
        <LinkProvider handler={parts.handler}>
          <div onClick={row}>
            <Link to={TARGET}>orders-api</Link>
          </div>
        </LinkProvider>,
      );
      fireEvent.click(screen.getByRole('link'));
      expect(parts.onOpen).toHaveBeenCalledTimes(1);
      expect(row).toHaveBeenCalledTimes(1);
    });
  });

  it('throws a TypeError named for what is missing when there is no provider', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(() => render(<Link to={TARGET}>orders-api</Link>)).toThrow(new TypeError('Link needs a LinkProvider'));
      expect(() => render(<Link to={TARGET}>orders-api</Link>)).toThrow(TypeError);
    } finally {
      quiet.mockRestore();
    }
  });

  it('passes data-* attributes through and nothing else', () => {
    const Loose = Link as unknown as ComponentType<Record<string, unknown>>;
    const loose: Record<string, unknown> = { to: TARGET, children: 'orders-api', 'data-testid': 'probe', className: 'restyled', style: { color: 'red' }, id: 'x', title: 'hint', href: '#elsewhere', target: '_blank', role: 'button', tabIndex: 5 };
    render(
      <LinkProvider handler={handlerOf().handler}>
        <Loose {...loose} />
      </LinkProvider>,
    );
    const link = screen.getByTestId('probe');
    expect(link.getAttribute('class')).not.toContain('restyled');
    expect(link.getAttribute('href')).toBe('#/items/orders-api');
    for (const attribute of ['style', 'id', 'title', 'target', 'role', 'tabindex']) {
      expect(link.hasAttribute(attribute), attribute).toBe(false);
    }
  });

  it('has closed props: a target, children, mono; no className, no style, no title, no href of its own', () => {
    // Types only: these are never rendered.
    const accepted: LinkProps[] = [{ to: TARGET, children: 'orders-api' }, { to: { page: 'items' }, children: 'orders-api', mono: true }, { to: { page: 'items', params: undefined }, children: 'orders-api', mono: undefined }];
    // @ts-expect-error className is not a prop of a kit part
    const withClass: LinkProps = { to: TARGET, children: 'x', className: 'x' };
    // @ts-expect-error style is not a prop of a kit part
    const withStyle: LinkProps = { to: TARGET, children: 'x', style: { color: 'red' } };
    // @ts-expect-error a title is not a prop: a tooltip is the shared host's
    const withTitle: LinkProps = { to: TARGET, children: 'x', title: 'hint' };
    // @ts-expect-error the address is the handler's, not the link's
    const withHref: LinkProps = { to: TARGET, children: 'x', href: '#x' };
    // @ts-expect-error a link goes to a target
    const noTarget: LinkProps = { children: 'x' };
    // @ts-expect-error a target is a page, not a string
    const textTarget: LinkProps = { to: 'items', children: 'x' };
    // @ts-expect-error the parameters of a target are text
    const numberParams: LinkProps = { to: { page: 'items', params: { count: 3 } }, children: 'x' };
    expect([accepted, withClass, withStyle, withTitle, withHref, noTarget, textTarget, numberParams]).toHaveLength(8);
  });

  it('writes nothing to the document root: no attribute, no style, no custom property', () => {
    const root = document.documentElement;
    const before = root.getAttribute('style');
    const writes = rootWrites(() => {
      const { link } = renderLink({ mono: true });
      fireEvent.click(link);
    });
    expect(writes).toEqual([]);
    expect(root.getAttribute('style')).toBe(before);
    expect([...root.style].filter((property) => property.startsWith('--'))).toEqual([]);
  });
});

// The a11y matrix of the examples: what a user of assistive technology meets for each state a Link is shown in.
type Row = {
  /** The links in the example, by name. */
  readonly links: readonly string[];
  /** The text the example reads as. */
  readonly text: string;
  readonly mono?: boolean;
};
const MATRIX: Readonly<Record<string, Row>> = {
  InSentence: { links: ['north-yard'], text: 'Owned by thenorth-yardgroup, which runs it.' },
  Mono: { links: ['orders-api-7d8c6f49b-x7k2m'], text: 'orders-api-7d8c6f49b-x7k2m', mono: true },
  ClippedByNarrowBox: { links: ['orders-reconciliation-worker-6f9d8b7c5d-x7k2m'], text: 'orders-reconciliation-worker-6f9d8b7c5d-x7k2m' },
  ShortInNarrowBox: { links: ['orders-api'], text: 'orders-api' },
  ReportsItsActivation: { links: ['orders-api'], text: 'orders-apiNothing opened yet.' },
};

describe('Link examples: the a11y matrix', () => {
  it('has a row for every example, and an example for every row', () => {
    expect(Object.keys(examples).sort()).toEqual(Object.keys(MATRIX).sort());
  });

  for (const [exampleName, row] of Object.entries(MATRIX)) {
    const Example = (examples as Record<string, () => ReactElement>)[exampleName];
    it(`${exampleName}: ${row.links.length} link named ${row.links.join(', ')}`, () => {
      expect(Example).toBeDefined();
      if (Example === undefined) {
        return;
      }

      const { container } = render(<Example />);
      const links = screen.queryAllByRole('link');
      expect(links).toHaveLength(row.links.length);
      for (const name of row.links) {
        const link = screen.getByRole('link', { name });
        // a real anchor with an address, in the tab order with nothing to make it mouse-only
        expect(link.tagName).toBe('A');
        expect(link.getAttribute('href')).toMatch(/^#\//);
        expect(link.tabIndex).toBe(0);
        link.focus();
        expect(document.activeElement).toBe(link);
        expect(link.hasAttribute('data-ov-mono')).toBe(row.mono === true);
      }

      expect(container.textContent?.replace(/\s+/g, ' ').trim()).toBe(row.text);
      expect(screen.queryAllByRole('button')).toHaveLength(0);
      expect(container.querySelector('[title]')).toBeNull();
    });
  }

  it('ReportsItsActivation writes how the destination was asked to open, from the facts of the event', () => {
    const Example = examples.ReportsItsActivation;
    render(<Example />);
    const link = screen.getByRole('link', { name: 'orders-api' });
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('Nothing opened yet.');
    const ways: ReadonlyArray<readonly [Record<string, boolean>, string]> = [
      [{}, 'plain'],
      [{ altKey: true }, 'here'],
      [{ metaKey: true }, 'background'],
      [{ ctrlKey: true }, 'background'],
      [{ metaKey: true, shiftKey: true }, 'new'],
      [{ shiftKey: true }, 'window'],
    ];
    for (const [modifiers, way] of ways) {
      fireEvent.click(link, modifiers);
      expect(status.textContent, way).toBe(`Opened items as ${way}`);
    }

    fireEvent(link, new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }));
    expect(status.textContent).toBe('Opened items as background');
  });

  it('ClippedByNarrowBox: the link holds the name once, whole, and the box is the narrow one', () => {
    const Example = examples.ClippedByNarrowBox;
    const { container } = render(<Example />);
    const link = screen.getByRole('link');
    expect(link.querySelectorAll('[data-ov-clip]')).toHaveLength(1);
    expect(link.parentElement).toBe(container.firstElementChild);
  });
});

// The stylesheet, as the rules it holds: jsdom lays nothing out, so what the stylesheet must say is asserted here and what a browser
// paints from it is measured in WebKit and Chromium against the mock.
const css = await readFile(path.join(import.meta.dirname, 'Link.module.css'), 'utf8');
const rule = (selector: string) => declarationsOf(css, selector);

describe('the Link stylesheet', () => {
  it('sits in the components layer, and only there', () => {
    expect(css.trimStart()).toMatch(/^@layer ov\.components \{/);
    for (const entry of cssRules(css)) {
      expect(entry.context[0], entry.selector).toBe('@layer ov.components');
    }
  });

  it('is the mock\'s link: the link colour, no underline at rest, an underline on hover, the pointer', () => {
    expect(rule('.root')).toEqual({ color: 'var(--ov-link)', 'text-decoration': 'none', cursor: 'pointer' });
    expect(rule('.root:hover')).toEqual({ 'text-decoration': 'underline' });
  });

  it('draws the ring of every control for the keyboard only: 2 px, outside the box by 2 px', () => {
    expect(rule('.root:focus-visible')).toEqual({ outline: '2px solid var(--ov-accent)', 'outline-offset': '2px' });
    expect(css).not.toMatch(/:focus\s*[{,]/);
  });

  it('sets no type of its own at rest: a link takes the size, weight and line of its sentence, cell or row', () => {
    const root = rule('.root');
    for (const property of ['font-size', 'font-weight', 'line-height', 'font-family']) {
      expect(root, property).not.toHaveProperty(property);
    }
  });

  it('draws the code face of the mock\'s `.mono`: 13/18, no ligatures, and a heading keeps its own size', () => {
    expect(rule('.root[data-ov-mono=\'true\']')).toMatchObject({
      'font-family': 'var(--ov-font-code)',
      'font-size': 'var(--ov-fs-13)',
      'line-height': 'var(--ov-lh-18)',
      'font-variant-ligatures': 'none',
    });
    for (const heading of ['h1', 'h2', 'h3', 'h4']) {
      expect(rule(`${heading} .root[data-ov-mono='true']`), heading).toEqual({ 'font-size': 'inherit', 'line-height': 'inherit' });
    }
  });

  it('makes the anchor a box of the line\'s width that holds a clipping child, so a name inside can be cut', () => {
    expect(rule('.root:has(> [data-ov-clip])')).toEqual({ display: 'inline-block', 'min-width': '0', 'max-width': '100%', 'vertical-align': 'bottom' });
  });

  it('never fades a state with opacity, and takes its paint from tokens', () => {
    expect(css).not.toMatch(/opacity\s*:/);
    for (const token of ['--ov-link', '--ov-accent', '--ov-font-code']) {
      expect(css, token).toContain(`var(${token})`);
    }
  });
});
