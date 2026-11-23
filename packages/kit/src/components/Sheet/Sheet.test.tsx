import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode, useEffect, useRef, useState, type ComponentType, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rootWrites } from '../../../scripts/rootWrites.ts';
import { Sheet, type SheetProps } from './Sheet';

// The sheet is a modal surface that is open while it is mounted. jsdom has no modal dialog: a stand-in opens the element, as the attribute does, exactly as the palette's tests do
// (`ui-next/plugins/host/PluginHost.palette.test.tsx`). What a modal does in a real engine (the top layer, an inert page, the focus it takes, Escape) is checked in WebKit and Chromium.
const dialogPrototype = HTMLDialogElement.prototype as unknown as { showModal?: () => void; close?: () => void };
dialogPrototype.showModal ??= function showModal(this: HTMLDialogElement) {
  this.setAttribute('open', '');
};

dialogPrototype.close ??= function close(this: HTMLDialogElement) {
  this.removeAttribute('open');
};

// jsdom lays nothing out, so no element has a box and every control would count as hidden. This stand-in gives a box to what a style sheet would draw: an element with no `hidden` attribute and no
// `display: none`, and none of its ancestors with either. `layoutReads` counts the questions the part asks of the layout.
function drawn(element: Element): boolean {
  for (let node: Element | null = element; node !== null; node = node.parentElement) {
    if (node.hasAttribute('hidden') || (node instanceof HTMLElement && node.style.display === 'none')) {
      return false;
    }
  }

  return true;
}

let layoutReads = 0;

beforeEach(() => {
  layoutReads = 0;
  vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function stub(this: Element) {
    layoutReads += 1;
    return (drawn(this) ? [{ width: 1, height: 1 }] : []) as unknown as DOMRectList;
  });
});

afterEach(() => {
  // The elements a test adds to the page by hand go with the page: the next test starts with the body holding the focus.
  cleanup();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

const noop = () => undefined;

/** The microtasks a closing sheet queued have run: the focus is given back in one. */
const settle = async (): Promise<void> => {
  await act(async () => undefined);
};

/** A button of the page behind the sheet that has the focus, as the control that opened it has. It is not React's, so a test can take it out of the document the way a script does. */
function opener(): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Open';
  document.body.append(button);
  button.focus();
  return button;
}

/** A sheet with nothing in its body. */
function Bare({ title = 'Example', onClose = noop }: { readonly title?: string; readonly onClose?: () => void }): ReactElement {
  return (
    <Sheet title={title} onClose={onClose}>
      {null}
    </Sheet>
  );
}

const dialog = () => screen.getByRole('dialog');
const close = () => screen.getByRole('button', { name: 'Close' });

/** What a browser sends on Escape to a modal dialog; it is the part's to take over. */
function cancel(target: Element): Event {
  const event = new Event('cancel', { cancelable: true });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

describe('Sheet', () => {
  it('is a modal dialog named by its title, with a header and a body in a frame of its own', () => {
    render(
      <Sheet title="Example sheet" onClose={noop} data-testid="sheet">
        <p>Body text</p>
      </Sheet>,
    );
    const root = screen.getByTestId('sheet');
    expect(root).toBe(dialog());
    expect(root.tagName).toBe('DIALOG');
    expect(root).toHaveProperty('dataset.ovPart', 'sheet');
    expect(screen.getByRole('dialog', { name: 'Example sheet' })).toBe(root);
    // The dialog is the scrim and holds one frame; the frame holds the header and the body.
    expect(root.children).toHaveLength(1);
    const frame = root.firstElementChild as HTMLElement;
    expect(frame).toHaveProperty('dataset.ovPart', 'frame');
    expect([...frame.children].map((child) => child.getAttribute('data-ov-part'))).toEqual(['header', 'body']);
  });

  it('draws the title as an h2 that names the dialog, then the Close control, then the body, in that order of the document', () => {
    render(
      <Sheet title="Settings" onClose={noop}>
        <p>Body text</p>
      </Sheet>,
    );
    const heading = screen.getByRole('heading', { level: 2, name: 'Settings' });
    expect(heading.tagName).toBe('H2');
    expect(heading).toHaveProperty('dataset.ovPart', 'title');
    expect(heading.id).not.toBe('');
    expect(dialog().getAttribute('aria-labelledby')).toBe(heading.id);
    const header = heading.parentElement!;
    expect(header).toHaveProperty('dataset.ovPart', 'header');
    expect(close().parentElement).toBe(header);
    const body = dialog().querySelector<HTMLElement>('[data-ov-part="body"]')!;
    expect(heading.compareDocumentPosition(close()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(close().compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(header.contains(body)).toBe(false);
  });

  it('gives every sheet its own name: two titles, two ids', () => {
    render(
      <>
        <Bare title="First" />
        <Bare title="Second" />
      </>,
    );
    const [first, second] = screen.getAllByRole('heading', { level: 2 });
    expect(first?.id).not.toBe('');
    expect(first?.id).not.toBe(second?.id);
    expect(screen.getByRole('dialog', { name: 'First' })).toBeDefined();
    expect(screen.getByRole('dialog', { name: 'Second' })).toBeDefined();
  });

  it('puts what it is given in the body, under the header, and nothing else there', () => {
    render(
      <Sheet title="Example" onClose={noop}>
        <p>One</p>
        <p>Two</p>
      </Sheet>,
    );
    const body = dialog().querySelector<HTMLElement>('[data-ov-part="body"]')!;
    expect([...body.children].map((child) => child.textContent)).toEqual(['One', 'Two']);
    expect(dialog().querySelectorAll('[data-ov-part="body"]')).toHaveLength(1);
  });

  it('has a Close control at the end of the header: the kit\'s icon button, named Close, the 24 px target, and nothing else in the header but the title', () => {
    render(<Bare />);
    const header = dialog().querySelector<HTMLElement>('[data-ov-part="header"]')!;
    expect([...header.children].map((child) => child.tagName)).toEqual(['H2', 'BUTTON']);
    const button = close();
    expect(header.lastElementChild).toBe(button);
    expect(button).toHaveProperty('dataset.ovPart', 'close');
    expect(button.getAttribute('type')).toBe('button');
    expect(button.getAttribute('aria-label')).toBe('Close');
    expect(button.querySelector('svg')?.getAttribute('data-ov-glyph')).toBe('close');
    expect(button).toHaveProperty('dataset.ovShape', 'icon');
    expect(button).toHaveProperty('dataset.ovSize', 'row');
    expect(button).toHaveProperty('dataset.ovVariant', 'ghost');
    expect(button.hasAttribute('title')).toBe(false);
    expect(button.hasAttribute('aria-disabled')).toBe(false);
  });

  it('has the elements it says: the frame, the header, the title and the body, besides the Close control and its glyph', () => {
    render(<Bare />);
    const own = [...dialog().querySelectorAll('*')].filter((element) => !close().contains(element));
    expect(own.map((element) => element.getAttribute('data-ov-part'))).toEqual(['frame', 'header', 'title', 'body']);
  });

  it('passes data-* attributes through to the dialog and nothing else', () => {
    const Loose = Sheet as unknown as ComponentType<Record<string, unknown>>;
    const loose: Record<string, unknown> = {
      title: 'Example',
      onClose: noop,
      children: null,
      'data-testid': 'probe',
      'data-extra': 'yes',
      className: 'restyled',
      style: { color: 'red' },
      id: 'x',
      role: 'alertdialog',
      'aria-label': 'x',
      tabIndex: 3,
    };
    render(<Loose {...loose} />);
    const root = screen.getByTestId('probe');
    expect(root).toBe(dialog());
    expect(root.getAttribute('data-extra')).toBe('yes');
    expect(root.getAttribute('class')).not.toContain('restyled');
    for (const attribute of ['style', 'id', 'role', 'aria-label', 'tabindex']) {
      expect(root.hasAttribute(attribute), attribute).toBe(false);
    }
  });

  it('has closed props: a title, a way to close and a body, no className, no style, no size', () => {
    // Types only: these are never rendered.
    const accepted: SheetProps[] = [
      { title: 'Example', onClose: noop, children: null },
      { title: 'Example', onClose: noop, children: <p>x</p>, 'data-testid': 'x' },
    ];
    // @ts-expect-error className is not a prop of a kit part
    const withClass: SheetProps = { title: 'Example', onClose: noop, children: null, className: 'x' };
    // @ts-expect-error style is not a prop of a kit part
    const withStyle: SheetProps = { title: 'Example', onClose: noop, children: null, style: { color: 'red' } };
    // @ts-expect-error there is one size so far: the next screen that needs another adds the prop
    const withSize: SheetProps = { title: 'Example', onClose: noop, children: null, size: 'large' };
    // @ts-expect-error a title is text, not an element
    const elementTitle: SheetProps = { title: <b>Example</b>, onClose: noop, children: null };
    // @ts-expect-error a sheet never closes itself: the caller says what happens when it is asked to
    const withoutClose: SheetProps = { title: 'Example', children: null };
    // @ts-expect-error a sheet has a title
    const untitled: SheetProps = { onClose: noop, children: null };
    // @ts-expect-error a sheet has a body
    const empty: SheetProps = { title: 'Example', onClose: noop };
    expect([accepted, withClass, withStyle, withSize, elementTitle, withoutClose, untitled, empty]).toHaveLength(8);
  });

  it('writes nothing to the document root: no attribute, no style, no custom property', () => {
    const root = document.documentElement;
    const before = root.getAttribute('style');
    const writes = rootWrites(() => {
      const view = render(<Bare />);
      view.rerender(<Bare title="Another" />);
      view.unmount();
    });
    expect(writes).toEqual([]);
    expect(root.getAttribute('style')).toBe(before);
    expect([...root.style].filter((property) => property.startsWith('--'))).toEqual([]);
  });
});

describe('Sheet: mounting is opening', () => {
  it('opens as a modal dialog when it mounts, once, and never asks to close by itself', () => {
    const onClose = vi.fn();
    const showModal = vi.spyOn(HTMLDialogElement.prototype, 'showModal');
    render(<Bare onClose={onClose} />);
    expect(dialog().hasAttribute('open')).toBe(true);
    expect(showModal).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not open a dialog that is open: a second showModal on one is an error in an engine, and StrictMode runs the effect twice', () => {
    const showModal = vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function stub(this: HTMLDialogElement) {
      if (this.hasAttribute('open')) {
        throw new Error('InvalidStateError');
      }

      this.setAttribute('open', '');
    });
    expect(() => {
      render(
        <StrictMode>
          <Bare />
        </StrictMode>,
      );
    }).not.toThrow();
    expect(showModal).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('dialog')).toHaveLength(1);
    expect(document.querySelectorAll('dialog[open]')).toHaveLength(1);
  });

  it('works under StrictMode: one open dialog, no request to close, the focus held inside while it is open, and the opener is still the one the focus goes back to', async () => {
    const button = opener();
    const onClose = vi.fn();
    const view = render(
      <StrictMode>
        <Sheet title="Example" onClose={onClose}>
          <input aria-label="Field" />
        </Sheet>
      </StrictMode>,
    );
    expect(document.querySelectorAll('dialog')).toHaveLength(1);
    expect(document.querySelectorAll('dialog[open]')).toHaveLength(1);
    expect(dialog().contains(document.activeElement)).toBe(true);
    // The microtask the first effect's cleanup queued runs now, as it does in an engine, before anything else happens: the dialog is open and holds the focus, so it gives nothing back.
    await settle();
    expect(dialog().contains(document.activeElement)).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    view.unmount();
    await settle();
    expect(document.querySelector('dialog')).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('Sheet: unmounting is closing', () => {
  it('goes away with the component, and the focus goes back to the element that had it, once the dialog has left', async () => {
    const button = opener();
    const view = render(<Bare />);
    expect(document.activeElement).not.toBe(button);
    view.unmount();
    expect(document.querySelectorAll('dialog')).toHaveLength(0);
    // Not before: a modal that is still there would keep the rest of the window inert, and the dialog takes its own focus with it.
    await settle();
    expect(document.activeElement).toBe(button);
  });

  it('gives the focus back in a microtask, not in the commit that removed the dialog', async () => {
    const button = opener();
    const view = render(<Bare />);
    view.unmount();
    expect(document.activeElement).not.toBe(button);
    await Promise.resolve();
    expect(document.activeElement).toBe(button);
  });

  it('leaves the focus where it was sent when something holds it by then: someone moved it while the sheet closed, and the user is meant to be there', async () => {
    const button = opener();
    const sent = document.createElement('textarea');
    document.body.append(sent);
    const view = render(<Bare />);
    view.unmount();
    sent.focus();
    await settle();
    expect(document.activeElement).toBe(sent);
    expect(document.activeElement).not.toBe(button);
  });

  it('does nothing when the element that had the focus is gone: the part cannot know the page, and the caller decides', async () => {
    const button = opener();
    const view = render(<Bare />);
    button.remove();
    view.unmount();
    await settle();
    expect(document.activeElement).toBe(document.body);
  });

  it('remembers nothing when nothing had the focus, and gives nothing back', async () => {
    const other = document.createElement('button');
    document.body.append(other);
    expect(document.activeElement).toBe(document.body);
    const view = render(<Bare />);
    view.unmount();
    await settle();
    expect(document.activeElement).toBe(document.body);
  });
});

/** What a screen does with the sheet: the caller owns whether it is mounted, and the control that opens it takes the focus as it is pressed, as the palette's Search control does. */
function Consumer({ children = <input aria-label="Field" /> }: { readonly children?: ReactNode }): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          event.currentTarget.focus();
          setOpen(true);
        }}
      >
        Open sheet
      </button>
      {open ? (
        <Sheet
          title="Example"
          onClose={() => {
            setOpen(false);
          }}
        >
          {children}
        </Sheet>
      ) : null}
    </>
  );
}

describe('Sheet: closing, as a screen uses it', () => {
  for (const strict of [false, true]) {
    const wrap = (element: ReactElement) => (strict ? <StrictMode>{element}</StrictMode> : element);
    const mode = strict ? ' (StrictMode)' : '';

    // The microtasks an opening queued run before the person does anything, as they do in an engine: `settle` after the press is that moment.
    it(`closes on Escape and gives the focus back to the control that opened it, which never ends on the body${mode}`, async () => {
      render(wrap(<Consumer />));
      const opens = screen.getByRole('button', { name: 'Open sheet' });
      fireEvent.click(opens);
      await settle();
      expect(dialog().contains(document.activeElement)).toBe(true);
      cancel(dialog());
      expect(screen.queryByRole('dialog')).toBeNull();
      await settle();
      expect(document.activeElement).toBe(opens);
      expect(document.activeElement).not.toBe(document.body);
    });

    it(`closes on a press of Close and gives the focus back in the same way${mode}`, async () => {
      render(wrap(<Consumer />));
      const opens = screen.getByRole('button', { name: 'Open sheet' });
      fireEvent.click(opens);
      await settle();
      fireEvent.click(close());
      expect(screen.queryByRole('dialog')).toBeNull();
      await settle();
      expect(document.activeElement).toBe(opens);
      expect(document.activeElement).not.toBe(document.body);
    });

    it(`opens again after it closed, and gives the focus back again${mode}`, async () => {
      render(wrap(<Consumer />));
      const opens = screen.getByRole('button', { name: 'Open sheet' });
      for (let round = 0; round < 3; round += 1) {
        fireEvent.click(opens);
        await settle();
        expect(screen.getAllByRole('dialog')).toHaveLength(1);
        expect(dialog().contains(document.activeElement)).toBe(true);
        cancel(dialog());
        await settle();
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(document.activeElement).toBe(opens);
      }
    });
  }
});

describe('Sheet: Escape', () => {
  it('is the browser\'s cancel event on the dialog: the part takes it over, asks to close once, and the browser does not close the dialog itself', () => {
    const onClose = vi.fn();
    render(<Bare onClose={onClose} />);
    const event = cancel(dialog());
    expect(event.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith();
    cancel(dialog());
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('never closes itself: mounting is opening, so the dialog stays until the caller stops rendering it', () => {
    render(<Bare />);
    cancel(dialog());
    expect(dialog().hasAttribute('open')).toBe(true);
    expect(document.querySelectorAll('dialog')).toHaveLength(1);
  });

  it('asks the caller as it is now: a new onClose is the one that is called', () => {
    const first = vi.fn();
    const second = vi.fn();
    const view = render(<Bare onClose={first} />);
    view.rerender(<Bare onClose={second} />);
    cancel(dialog());
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('listens for no key of its own: a control that handled Escape never reaches it, and the cancel of one nobody handled is the browser\'s to send', () => {
    const onClose = vi.fn();
    render(
      <Sheet title="Example" onClose={onClose}>
        <input
          aria-label="Field"
          onKeyDown={(event) => {
            // What a field with a draft does: the key is its own, and the dialog never sees it.
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
            }
          }}
        />
        <button type="button">Plain</button>
      </Sheet>,
    );
    for (const target of [screen.getByRole('textbox', { name: 'Field' }), screen.getByRole('button', { name: 'Plain' }), close(), dialog()]) {
      fireEvent.keyDown(target, { key: 'Escape' });
      fireEvent.keyUp(target, { key: 'Escape' });
    }

    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('Sheet: the scrim', () => {
  it('does not close on a press: an accidental click must not discard what a form holds, so only Escape and the Close control close it', () => {
    const onClose = vi.fn();
    render(
      <Sheet title="Example" onClose={onClose}>
        <p>Body text</p>
      </Sheet>,
    );
    const root = dialog();
    const frame = root.querySelector<HTMLElement>('[data-ov-part="frame"]')!;
    for (const target of [root, frame]) {
      fireEvent.pointerDown(target);
      fireEvent.mouseDown(target);
      fireEvent.pointerUp(target);
      fireEvent.mouseUp(target);
      fireEvent.click(target);
      fireEvent.doubleClick(target);
      fireEvent.contextMenu(target);
      fireEvent(target, new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }));
    }

    expect(onClose).not.toHaveBeenCalled();
    expect(root.hasAttribute('open')).toBe(true);
  });

  it('asks to close once for each press of Close, and for nothing else', () => {
    const onClose = vi.fn();
    render(
      <Sheet title="Example" onClose={onClose}>
        <button type="button">Plain</button>
      </Sheet>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Plain' }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(close());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith();
    fireEvent.click(close());
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('Sheet: Tab stays inside', () => {
  const body = (
    <>
      <button type="button">First</button>
      <button type="button" disabled>
        Disabled
      </button>
      <button type="button" tabIndex={-1}>
        Skipped
      </button>
      <button type="button" hidden>
        Hidden
      </button>
      <button type="button" aria-disabled="true">
        Unavailable
      </button>
      <input aria-label="Last field" />
      <button type="button" disabled>
        After
      </button>
    </>
  );

  type Keys = { readonly shiftKey?: boolean; readonly ctrlKey?: boolean; readonly metaKey?: boolean; readonly altKey?: boolean };

  /** Presses Tab on `target`; true when the part took the press over (it kept the browser from moving the focus), false when it left the press to the browser. */
  const takes = (target: Element, keys: Keys = {}): boolean => !fireEvent.keyDown(target, { key: 'Tab', ...keys });

  const last = () => screen.getByRole('textbox', { name: 'Last field' });

  it('sends Tab on the last stop to the first: the last is what Tab stops on, not what comes last in the markup', () => {
    render(<Sheet title="Example" onClose={noop}>{body}</Sheet>);
    last().focus();
    expect(takes(last())).toBe(true);
    expect(document.activeElement).toBe(close());
  });

  it('sends Shift+Tab on the first stop, which is Close, to the last', () => {
    render(<Sheet title="Example" onClose={noop}>{body}</Sheet>);
    close().focus();
    expect(takes(close(), { shiftKey: true })).toBe(true);
    expect(document.activeElement).toBe(last());
  });

  it('leaves every other press to the browser: a stop that is not an end, or a press that is not Tab', () => {
    render(<Sheet title="Example" onClose={noop}>{body}</Sheet>);
    const first = screen.getByRole('button', { name: 'First' });
    const unavailable = screen.getByRole('button', { name: 'Unavailable' });
    first.focus();
    expect(takes(first)).toBe(false);
    expect(takes(first, { shiftKey: true })).toBe(false);
    unavailable.focus();
    expect(takes(unavailable)).toBe(false);
    expect(takes(unavailable, { shiftKey: true })).toBe(false);
    last().focus();
    expect(takes(last(), { shiftKey: true })).toBe(false);
    close().focus();
    expect(takes(close())).toBe(false);
    for (const key of ['Enter', ' ', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'Escape', 'a']) {
      expect(fireEvent.keyDown(last(), { key }), key).toBe(true);
    }

    expect(document.activeElement).toBe(close());
  });

  it('counts a control that is unavailable for a reason as a stop: it is the end Tab wraps at', () => {
    render(
      <Sheet title="Example" onClose={noop}>
        <button type="button">First</button>
        <button type="button" aria-disabled="true">
          Unavailable
        </button>
      </Sheet>,
    );
    const unavailable = screen.getByRole('button', { name: 'Unavailable' });
    unavailable.focus();
    expect(takes(unavailable)).toBe(true);
    expect(document.activeElement).toBe(close());
  });

  it('leaves a chord to the platform: Control+Tab and Command+Tab are not a move of the focus, and Option+Tab (the Mac\'s Tab through every control) is', () => {
    render(<Sheet title="Example" onClose={noop}>{body}</Sheet>);
    last().focus();
    expect(takes(last(), { ctrlKey: true })).toBe(false);
    expect(takes(last(), { metaKey: true })).toBe(false);
    expect(document.activeElement).toBe(last());
    expect(takes(last(), { altKey: true })).toBe(true);
    expect(document.activeElement).toBe(close());
  });

  it('leaves a Tab that a control handled to that control: an editor that uses it for indentation keeps it', () => {
    render(
      <Sheet title="Example" onClose={noop}>
        <textarea
          aria-label="Editor"
          onKeyDown={(event) => {
            if (event.key === 'Tab') {
              event.preventDefault();
            }
          }}
        />
      </Sheet>,
    );
    const editor = screen.getByRole('textbox', { name: 'Editor' });
    editor.focus();
    fireEvent.keyDown(editor, { key: 'Tab' });
    expect(document.activeElement).toBe(editor);
  });

  it('leaves a Tab that is part of a composition to the input method', () => {
    render(<Sheet title="Example" onClose={noop}>{body}</Sheet>);
    last().focus();
    expect(fireEvent.keyDown(last(), { key: 'Tab', isComposing: true })).toBe(true);
    expect(document.activeElement).toBe(last());
  });

  it('finds the stops when the key is pressed: a control that appeared after the sheet opened is an end, and the old end is not', () => {
    function Growing() {
      const [more, setMore] = useState(false);
      return (
        <Sheet title="Example" onClose={noop}>
          <button
            type="button"
            onClick={() => {
              setMore(true);
            }}
          >
            More
          </button>
          {more ? <button type="button">Added</button> : null}
        </Sheet>
      );
    }

    render(<Growing />);
    const more = screen.getByRole('button', { name: 'More' });
    more.focus();
    expect(takes(more)).toBe(true);
    expect(document.activeElement).toBe(close());
    fireEvent.click(more);
    more.focus();
    expect(takes(more)).toBe(false);
    const added = screen.getByRole('button', { name: 'Added' });
    added.focus();
    expect(takes(added)).toBe(true);
    expect(document.activeElement).toBe(close());
  });

  it('asks the layout when the key is pressed, never per render', () => {
    const view = render(<Sheet title="Example" onClose={noop}>{body}</Sheet>);
    layoutReads = 0;
    for (const title of ['One', 'Two', 'Three']) {
      view.rerender(
        <Sheet title={title} onClose={noop}>
          {body}
        </Sheet>,
      );
    }

    expect(layoutReads).toBe(0);
    last().focus();
    takes(last());
    expect(layoutReads).toBeGreaterThan(0);
  });

  it('takes no press from outside the sheet: the page behind is inert, and a Tab there is the browser\'s', () => {
    render(<Sheet title="Example" onClose={noop}>{body}</Sheet>);
    const outside = opener();
    expect(takes(outside)).toBe(false);
    expect(takes(outside, { shiftKey: true })).toBe(false);
    expect(document.activeElement).toBe(outside);
  });
});

describe('Sheet: the focus when it opens', () => {
  it('moves into the dialog when nothing in it has it: the first stop, which is Close', () => {
    const button = opener();
    render(
      <Sheet title="Example" onClose={noop}>
        <input aria-label="Field" />
      </Sheet>,
    );
    expect(document.activeElement).toBe(close());
    expect(document.activeElement).not.toBe(button);
  });

  it('moves into the dialog when the body had the focus too: the part needs no opener to take the keyboard', () => {
    expect(document.activeElement).toBe(document.body);
    render(<Bare />);
    expect(document.activeElement).toBe(close());
  });

  it('does not pick a field for the consumer: a field that takes the focus in its own effect, which runs after the part\'s, keeps it', () => {
    function Search() {
      const field = useRef<HTMLInputElement>(null);
      useEffect(() => {
        field.current?.focus();
      }, []);
      return <input ref={field} aria-label="Search" />;
    }

    opener();
    render(
      <Sheet title="Example" onClose={noop}>
        <Search />
        <input aria-label="Other" />
      </Sheet>,
    );
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Search' }));
  });

  it('leaves the focus where the browser put it when it is already inside the dialog', () => {
    // A real engine's showModal() moves the focus to the first focusable element or the one with `autofocus`; here a stand-in puts it on the control marked, and the part keeps what is there.
    vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function stub(this: HTMLDialogElement) {
      this.setAttribute('open', '');
      this.querySelector<HTMLElement>('[data-first]')?.focus();
    });
    opener();
    render(
      <Sheet title="Example" onClose={noop}>
        <button type="button">One</button>
        <button type="button" data-first="">
          Two
        </button>
      </Sheet>,
    );
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Two' }));
  });

  it('takes the focus once: a later render does not take it back from where the user put it', () => {
    const view = render(
      <Sheet title="Example" onClose={noop}>
        <input aria-label="Field" />
        <input aria-label="Other" />
      </Sheet>,
    );
    const other = screen.getByRole('textbox', { name: 'Other' });
    other.focus();
    view.rerender(
      <Sheet title="Another" onClose={noop}>
        <input aria-label="Field" />
        <input aria-label="Other" />
      </Sheet>,
    );
    expect(document.activeElement).toBe(other);
  });
});
