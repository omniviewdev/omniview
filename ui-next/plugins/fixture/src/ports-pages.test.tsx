import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { admit } from '../../contract/admit';
import type { PanelHostV1, PortForwardErrorCodeV1, PortForwardErrorV1, PortForwardRequestV1, PortForwardSessionV1 } from '../../contract/v1';
import { contributionV1 } from './entry-ports';
import { ForwardControl, accessOf, frameConnectionOf, portsPage, targetsFrame, targetsOf, type ForwardAccess } from './ports-pages';

// The page of the ports fixture: one row, the fixture's target, and in it the three buttons that ask the host to forward its port, to stop what was forwarded and to forward the same port again. The handle the host gives a
// page (`ctx.panel.ports`) is a stand-in whose answers the test holds back and lets go in the order it chooses, so what the page says while a call is under way and after it is read on the screen and not guessed.

type Ports = NonNullable<PanelHostV1['ports']>;

/** A promise the test settles when it chooses. */
type Held<T> = PromiseWithResolvers<T>;

/**
 * What the host answers for a forward it started: the contract's whole answer. `stop` is the one the test can see called, and answers at once unless the test gives it a promise to hold.
 */
function answerOf(sessionId: string, over: { readonly localPort?: number; readonly stop?: () => Promise<void> } = {}) {
  const stop = vi.fn<() => Promise<void>>(over.stop ?? (async () => undefined));
  const answer: PortForwardSessionV1 = { sessionId, localPort: over.localPort ?? 41_234, localHost: '127.0.0.1', stop };
  return { answer, stop };
}

/** A refusal the way the host makes one: an Error named `PortForwardError` that carries the class of refusal in `code`. */
const hostRefusal = (code: PortForwardErrorCodeV1, message: string): PortForwardErrorV1 => Object.assign(new Error(message), { name: 'PortForwardError' as const, code });

/** A handle that answers each call of `forward` with the next promise given, and with one that is never settled when there are none left. */
function handleOf(...answers: Array<Promise<PortForwardSessionV1>>) {
  const queue = [...answers];
  const forward = vi.fn<(request: PortForwardRequestV1) => Promise<PortForwardSessionV1>>(async () => queue.shift() ?? Promise.withResolvers<PortForwardSessionV1>().promise);
  const ports: Ports = { forward };
  return { ports, forward };
}

const ready = (ports: Ports): ForwardAccess => ({ kind: 'ready', ports });

/** Lets a held answer go, inside act, and waits for what the page does with it, so that it is on screen when this returns. */
async function release<T>(held: Held<T>, outcome: { readonly answer: T } | { readonly refusal: unknown }) {
  await act(async () => {
    if ('refusal' in outcome) {
      held.reject(outcome.refusal);
    } else {
      held.resolve(outcome.answer);
    }

    await held.promise.then(
      () => undefined,
      () => undefined,
    );
  });
}

const forwardButton = () => screen.getByRole('button', { name: 'Forward fixture port' });
const stopButton = () => screen.getByRole('button', { name: 'Stop fixture forward' });
const againButton = () => screen.getByRole('button', { name: 'Forward the same port again' });
const status = () => screen.getByRole('status');

/** The text the page draws for a reason, once: the button's own copy of it is hidden, a description. */
const printed = (words: string) => screen.getByText(words, { selector: 'span:not([hidden])' });

afterEach(cleanup);

describe('the button that forwards', () => {
  it('is named Forward fixture port and asks the host to forward the fixture’s one resource and port, once', async () => {
    const { ports, forward } = handleOf();
    render(<ForwardControl access={ready(ports)} />);

    await userEvent.setup().click(forwardButton());

    expect(forward).toHaveBeenCalledTimes(1);
    expect(forward).toHaveBeenCalledWith({ resourceId: 'fixture-target', resourceKey: 'fixture:/targets', remotePort: 8080 });
  });

  it('says nothing before it is pressed, in a status the page has from the start', () => {
    render(<ForwardControl access={ready(handleOf().ports)} />);

    expect(status()).toHaveTextContent('');
    expect(forwardButton()).not.toHaveAttribute('aria-busy');
  });

  it('is busy while the host starts the forward, and a second press in that time asks for nothing', async () => {
    const started = Promise.withResolvers<PortForwardSessionV1>();
    const { ports, forward } = handleOf(started.promise);
    const user = userEvent.setup();
    render(<ForwardControl access={ready(ports)} />);

    await user.click(forwardButton());
    expect(forwardButton()).toHaveAttribute('aria-busy', 'true');
    await user.click(forwardButton());

    expect(forward).toHaveBeenCalledTimes(1);
    await release(started, { answer: answerOf('a1').answer });
    expect(forwardButton()).not.toHaveAttribute('aria-busy');
  });

  it('says the forward the host started and where to connect to it, from the host’s answer', async () => {
    const started = Promise.withResolvers<PortForwardSessionV1>();
    render(<ForwardControl access={ready(handleOf(started.promise).ports)} />);
    await userEvent.setup().click(forwardButton());

    await release(started, { answer: answerOf('4f9d2c1e-aaaa-bbbb-cccc-0123456789ab', { localPort: 53_001 }).answer });

    expect(status()).toHaveTextContent('Forward session 4f9d2c1e-aaaa-bbbb-cccc-0123456789ab on 127.0.0.1:53001');
  });

  it('says a refusal by its code and in the words the host gave, and a press after it asks again and shows the new answer in its place', async () => {
    const refused = Promise.withResolvers<PortForwardSessionV1>();
    const second = Promise.withResolvers<PortForwardSessionV1>();
    const { ports, forward } = handleOf(refused.promise, second.promise);
    const user = userEvent.setup();
    render(<ForwardControl access={ready(ports)} />);

    await user.click(forwardButton());
    await release(refused, { refusal: hostRefusal('CONNECTION_ERROR', 'Start the connection first.') });
    expect(status()).toHaveTextContent('Refused CONNECTION_ERROR: Start the connection first.');

    await user.click(forwardButton());
    expect(status()).toHaveTextContent('');
    await release(second, { answer: answerOf('b2').answer });

    expect(forward).toHaveBeenCalledTimes(2);
    expect(status()).toHaveTextContent('Forward session b2 on 127.0.0.1:41234');
  });

  it('says the code UNKNOWN, and words of its own, for a rejection that said none', async () => {
    const refused = Promise.withResolvers<PortForwardSessionV1>();
    render(<ForwardControl access={ready(handleOf(refused.promise).ports)} />);
    await userEvent.setup().click(forwardButton());

    await release(refused, { refusal: undefined });

    expect(status()).toHaveTextContent('Refused UNKNOWN: The host could not start the forward.');
  });
});

describe('the button that stops', () => {
  it('is unavailable until the host has answered a forward: it says why on the page and on the button, and presses nothing', async () => {
    render(<ForwardControl access={ready(handleOf().ports)} />);

    expect(stopButton()).toHaveAttribute('aria-disabled', 'true');
    expect(stopButton()).toHaveAccessibleDescription('No forward was started on this page yet.');
    expect(printed('No forward was started on this page yet.')).toBeVisible();
    await userEvent.setup().click(stopButton());
    expect(status()).toHaveTextContent('');
  });

  it('is available once the host has answered a forward, and the reason is gone', async () => {
    const started = Promise.withResolvers<PortForwardSessionV1>();
    render(<ForwardControl access={ready(handleOf(started.promise).ports)} />);
    await userEvent.setup().click(forwardButton());

    await release(started, { answer: answerOf('a1').answer });

    expect(stopButton()).not.toHaveAttribute('aria-disabled');
    expect(screen.queryByText('No forward was started on this page yet.')).not.toBeInTheDocument();
  });

  it('stops the forward that was answered last, once, and says it', async () => {
    const started = Promise.withResolvers<PortForwardSessionV1>();
    const { answer, stop } = answerOf('a1');
    const user = userEvent.setup();
    render(<ForwardControl access={ready(handleOf(started.promise).ports)} />);
    await user.click(forwardButton());
    await release(started, { answer });

    await user.click(stopButton());

    expect(stop).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledWith();
    expect(status()).toHaveTextContent('Stopped forward a1');
  });

  it('stops the last answer and not an earlier one: the forward the host started after it is the one it stops', async () => {
    const first = Promise.withResolvers<PortForwardSessionV1>();
    const second = Promise.withResolvers<PortForwardSessionV1>();
    const one = answerOf('a1', { localPort: 41_001 });
    const two = answerOf('b2', { localPort: 41_002 });
    const user = userEvent.setup();
    render(<ForwardControl access={ready(handleOf(first.promise, second.promise).ports)} />);
    await user.click(forwardButton());
    await release(first, { answer: one.answer });
    await user.click(forwardButton());
    await release(second, { answer: two.answer });

    await user.click(stopButton());

    expect(one.stop).not.toHaveBeenCalled();
    expect(two.stop).toHaveBeenCalledTimes(1);
    expect(status()).toHaveTextContent('Stopped forward b2');
  });

  it('keeps the forward as the last one after it stopped it: a press after it is the contract’s second call, and the port the forward had can be asked for again', async () => {
    const first = Promise.withResolvers<PortForwardSessionV1>();
    const second = Promise.withResolvers<PortForwardSessionV1>();
    const stopped = Promise.withResolvers<void>();
    const one = answerOf('a1', { localPort: 53_001, stop: async () => stopped.promise });
    const { ports, forward } = handleOf(first.promise, second.promise);
    const user = userEvent.setup();
    render(<ForwardControl access={ready(ports)} />);
    await user.click(forwardButton());
    await release(first, { answer: one.answer });
    await user.click(stopButton());
    await release(stopped, { answer: undefined });
    expect(status()).toHaveTextContent('Stopped forward a1');

    await user.click(stopButton());
    await act(async () => {
      await stopped.promise;
    });
    expect(one.stop).toHaveBeenCalledTimes(2);
    expect(status()).toHaveTextContent('Stopped forward a1');

    await user.click(againButton());
    await release(second, { answer: answerOf('b2', { localPort: 53_001 }).answer });

    expect(forward).toHaveBeenLastCalledWith({ resourceId: 'fixture-target', resourceKey: 'fixture:/targets', remotePort: 8080, localPort: 53_001 });
    expect(status()).toHaveTextContent('Forward session b2 on 127.0.0.1:53001');
  });

  it('says a refusal by its code and in the host’s words, keeps the forward as the last one, and a press after it asks the host again and says the refusal the host repeats: the contract’s second call is the first’s outcome', async () => {
    const started = Promise.withResolvers<PortForwardSessionV1>();
    const refusal = hostRefusal('NOT_FOUND', 'The plugin of the forward is not there.');
    const refused = Promise.withResolvers<void>();
    const repeated = Promise.withResolvers<void>();
    const { answer, stop } = answerOf('a1', { stop: async () => refused.promise });
    const user = userEvent.setup();
    render(<ForwardControl access={ready(handleOf(started.promise).ports)} />);
    await user.click(forwardButton());
    await release(started, { answer });

    await user.click(stopButton());
    await release(refused, { refusal });

    expect(status()).toHaveTextContent('Stop refused NOT_FOUND: The plugin of the forward is not there.');
    expect(stopButton()).not.toHaveAttribute('aria-disabled');
    stop.mockImplementationOnce(async () => repeated.promise);
    await user.click(stopButton());
    expect(stopButton()).toHaveAttribute('aria-busy', 'true');
    expect(status()).toHaveTextContent('');
    await release(repeated, { refusal });

    expect(stop).toHaveBeenCalledTimes(2);
    expect(status()).toHaveTextContent('Stop refused NOT_FOUND: The plugin of the forward is not there.');
  });

  it('says the code UNKNOWN, and words of its own, for a stop that was refused with none', async () => {
    const started = Promise.withResolvers<PortForwardSessionV1>();
    const refused = Promise.withResolvers<void>();
    const { answer } = answerOf('a1', { stop: async () => refused.promise });
    const user = userEvent.setup();
    render(<ForwardControl access={ready(handleOf(started.promise).ports)} />);
    await user.click(forwardButton());
    await release(started, { answer });

    await user.click(stopButton());
    await release(refused, { refusal: undefined });

    expect(status()).toHaveTextContent('Stop refused UNKNOWN: The host could not stop the forward.');
  });

  it('is busy while the host stops the forward, and a press in that time, on any button, asks for nothing', async () => {
    const started = Promise.withResolvers<PortForwardSessionV1>();
    const stopped = Promise.withResolvers<void>();
    const { answer, stop } = answerOf('a1', { stop: async () => stopped.promise });
    const { ports, forward } = handleOf(started.promise);
    const user = userEvent.setup();
    render(<ForwardControl access={ready(ports)} />);
    await user.click(forwardButton());
    await release(started, { answer });

    await user.click(stopButton());
    expect(stopButton()).toHaveAttribute('aria-busy', 'true');
    expect(forwardButton()).not.toHaveAttribute('aria-busy');
    await user.click(stopButton());
    await user.click(forwardButton());
    await user.click(againButton());

    expect(stop).toHaveBeenCalledTimes(1);
    expect(forward).toHaveBeenCalledTimes(1);
    await release(stopped, { answer: undefined });
    expect(stopButton()).not.toHaveAttribute('aria-busy');
    expect(status()).toHaveTextContent('Stopped forward a1');
  });
});

describe('the button that forwards the same port again', () => {
  it('is unavailable until the host has answered a forward: it says why on the page and on the button, and presses nothing', async () => {
    const { ports, forward } = handleOf();
    render(<ForwardControl access={ready(ports)} />);

    expect(againButton()).toHaveAttribute('aria-disabled', 'true');
    expect(againButton()).toHaveAccessibleDescription('No forward was started on this page yet.');
    await userEvent.setup().click(againButton());
    expect(forward).not.toHaveBeenCalled();
    expect(status()).toHaveTextContent('');
  });

  it('asks for the port the last answer says, for the same resource and protocol as the first, and says the forward it is answered', async () => {
    const first = Promise.withResolvers<PortForwardSessionV1>();
    const second = Promise.withResolvers<PortForwardSessionV1>();
    const { ports, forward } = handleOf(first.promise, second.promise);
    const user = userEvent.setup();
    render(<ForwardControl access={ready(ports)} />);
    await user.click(forwardButton());
    await release(first, { answer: answerOf('a1', { localPort: 53_001 }).answer });

    await user.click(againButton());
    expect(againButton()).toHaveAttribute('aria-busy', 'true');
    await release(second, { answer: answerOf('b2', { localPort: 53_001 }).answer });

    expect(forward).toHaveBeenCalledTimes(2);
    expect(forward).toHaveBeenLastCalledWith({ resourceId: 'fixture-target', resourceKey: 'fixture:/targets', remotePort: 8080, localPort: 53_001 });
    expect(status()).toHaveTextContent('Forward session b2 on 127.0.0.1:53001');
    expect(againButton()).not.toHaveAttribute('aria-busy');
  });

  it('says a refusal by its code and in the words the host gave, and the forward that was answered last stays the last one', async () => {
    const first = Promise.withResolvers<PortForwardSessionV1>();
    const refused = Promise.withResolvers<PortForwardSessionV1>();
    const one = answerOf('a1');
    const user = userEvent.setup();
    render(<ForwardControl access={ready(handleOf(first.promise, refused.promise).ports)} />);
    await user.click(forwardButton());
    await release(first, { answer: one.answer });

    await user.click(againButton());
    await release(refused, { refusal: hostRefusal('PROVIDER_ERROR', 'The forwarder could not open the port.') });

    expect(status()).toHaveTextContent('Refused PROVIDER_ERROR: The forwarder could not open the port.');
    await user.click(stopButton());
    expect(one.stop).toHaveBeenCalledTimes(1);
    expect(status()).toHaveTextContent('Stopped forward a1');
  });

  it('asks for the port of the forward that was answered last, which is the newest one when the host started a second: its free port, not the first one’s', async () => {
    const first = Promise.withResolvers<PortForwardSessionV1>();
    const second = Promise.withResolvers<PortForwardSessionV1>();
    const third = Promise.withResolvers<PortForwardSessionV1>();
    const { ports, forward } = handleOf(first.promise, second.promise, third.promise);
    const user = userEvent.setup();
    render(<ForwardControl access={ready(ports)} />);
    await user.click(forwardButton());
    await release(first, { answer: answerOf('a1', { localPort: 41_001 }).answer });
    await user.click(forwardButton());
    await release(second, { answer: answerOf('b2', { localPort: 41_002 }).answer });

    await user.click(againButton());
    await release(third, { answer: answerOf('c3', { localPort: 41_002 }).answer });

    expect(forward.mock.calls.map(([request]) => request.localPort)).toEqual([undefined, undefined, 41_002]);
  });
});

describe('while a call is under way', () => {
  const underWay = 'The host has not answered the last press yet.';

  /** Gets the page to where it has a forward the host answered, so that all three buttons can be pressed. */
  async function withForward(user: UserEvent, ports: Ports, first: Held<PortForwardSessionV1>, answer: PortForwardSessionV1) {
    render(<ForwardControl access={ready(ports)} />);
    await user.click(forwardButton());
    await release(first, { answer });
  }

  it('keeps the button that forwards busy and says on the other two, once on the page, that the host has not answered yet, and takes it back when the host has', async () => {
    const first = Promise.withResolvers<PortForwardSessionV1>();
    const second = Promise.withResolvers<PortForwardSessionV1>();
    const user = userEvent.setup();
    await withForward(user, handleOf(first.promise, second.promise).ports, first, answerOf('a1').answer);

    await user.click(forwardButton());

    expect(forwardButton()).toHaveAttribute('aria-busy', 'true');
    expect(forwardButton()).not.toHaveAttribute('aria-disabled');
    for (const button of [stopButton(), againButton()]) {
      expect(button).toHaveAttribute('aria-disabled', 'true');
      expect(button).toHaveAccessibleDescription(underWay);
    }

    expect(printed(underWay)).toBeVisible();
    await release(second, { answer: answerOf('b2').answer });
    for (const button of [forwardButton(), stopButton(), againButton()]) {
      expect(button).not.toHaveAttribute('aria-disabled');
    }

    expect(screen.queryByText(underWay)).not.toBeInTheDocument();
  });

  it('keeps the button that stops busy and says on the other two that the host has not answered yet, and presses on them ask for nothing', async () => {
    const first = Promise.withResolvers<PortForwardSessionV1>();
    const stopped = Promise.withResolvers<void>();
    const { answer, stop } = answerOf('a1', { stop: async () => stopped.promise });
    const { ports, forward } = handleOf(first.promise);
    const user = userEvent.setup();
    await withForward(user, ports, first, answer);

    await user.click(stopButton());

    expect(stopButton()).toHaveAttribute('aria-busy', 'true');
    expect(stopButton()).not.toHaveAttribute('aria-disabled');
    for (const button of [forwardButton(), againButton()]) {
      expect(button).toHaveAttribute('aria-disabled', 'true');
      expect(button).toHaveAccessibleDescription(underWay);
    }

    expect(printed(underWay)).toBeVisible();
    await user.click(forwardButton());
    await user.click(againButton());
    expect(forward).toHaveBeenCalledTimes(1);
    await release(stopped, { answer: undefined });
    for (const button of [forwardButton(), stopButton(), againButton()]) {
      expect(button).not.toHaveAttribute('aria-disabled');
    }

    expect(stop).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(underWay)).not.toBeInTheDocument();
  });

  it('keeps the button that forwards the same port busy and says on the other two that the host has not answered yet, and the buttons are as they were when the host refuses', async () => {
    const first = Promise.withResolvers<PortForwardSessionV1>();
    const again = Promise.withResolvers<PortForwardSessionV1>();
    const user = userEvent.setup();
    await withForward(user, handleOf(first.promise, again.promise).ports, first, answerOf('a1').answer);

    await user.click(againButton());

    expect(againButton()).toHaveAttribute('aria-busy', 'true');
    expect(againButton()).not.toHaveAttribute('aria-disabled');
    for (const button of [forwardButton(), stopButton()]) {
      expect(button).toHaveAttribute('aria-disabled', 'true');
      expect(button).toHaveAccessibleDescription(underWay);
    }

    expect(printed(underWay)).toBeVisible();
    await release(again, { refusal: hostRefusal('PROVIDER_ERROR', 'The forwarder could not open the port.') });
    for (const button of [forwardButton(), stopButton(), againButton()]) {
      expect(button).not.toHaveAttribute('aria-disabled');
    }

    expect(screen.queryByText(underWay)).not.toBeInTheDocument();
    expect(status()).toHaveTextContent('Refused PROVIDER_ERROR: The forwarder could not open the port.');
  });

  it('says one reason on the buttons that have two while the first forward is under way: there is nothing to stop yet, and that is what the page says', async () => {
    const first = Promise.withResolvers<PortForwardSessionV1>();
    render(<ForwardControl access={ready(handleOf(first.promise).ports)} />);

    await userEvent.setup().click(forwardButton());

    expect(forwardButton()).toHaveAttribute('aria-busy', 'true');
    expect(forwardButton()).not.toHaveAttribute('aria-disabled');
    for (const button of [stopButton(), againButton()]) {
      expect(button).toHaveAccessibleDescription('No forward was started on this page yet.');
    }

    expect(printed('No forward was started on this page yet.')).toBeVisible();
    expect(screen.queryByText(underWay)).not.toBeInTheDocument();
  });
});

describe('where the page cannot forward', () => {
  it('says that the page is open in no connection, once on the page and on each of the three buttons, and presses nothing', async () => {
    render(<ForwardControl access={{ kind: 'no-connection' }} />);

    for (const button of [forwardButton(), stopButton(), againButton()]) {
      expect(button).toHaveAttribute('aria-disabled', 'true');
      expect(button).toHaveAccessibleDescription('This page is open in no connection, so it cannot forward ports.');
    }

    expect(printed('This page is open in no connection, so it cannot forward ports.')).toBeVisible();
    expect(screen.queryByText('This version of the app cannot forward ports.')).not.toBeInTheDocument();
    await userEvent.setup().click(forwardButton());
    expect(status()).toHaveTextContent('');
  });

  it('says that this version of the app cannot forward ports where the host has no handle for it, on the page and on each of the three buttons, and presses nothing', async () => {
    render(<ForwardControl access={{ kind: 'no-member' }} />);

    for (const button of [forwardButton(), stopButton(), againButton()]) {
      expect(button).toHaveAttribute('aria-disabled', 'true');
      expect(button).toHaveAccessibleDescription('This version of the app cannot forward ports.');
    }

    expect(printed('This version of the app cannot forward ports.')).toBeVisible();
    expect(screen.queryByText('This page is open in no connection, so it cannot forward ports.')).not.toBeInTheDocument();
    await userEvent.setup().click(forwardButton());
    expect(status()).toHaveTextContent('');
  });
});

describe('the page', () => {
  it('reads what it can forward with from the handle the host gave it, and says why there is none: no connection, or no member', () => {
    const { ports } = handleOf();

    expect(accessOf(ports, true)).toEqual({ kind: 'ready', ports });
    expect(accessOf(undefined, true)).toEqual({ kind: 'no-member' });
    expect(accessOf(undefined, false)).toEqual({ kind: 'no-connection' });
  });

  it('takes the member the host gave for what it is, whatever the page thinks of its connection: the host binds the handle, and the page does not second-guess it', () => {
    const { ports } = handleOf();

    expect(accessOf(ports, false)).toEqual({ kind: 'ready', ports });
  });

  it('lists the fixture’s one target, with what the page can forward with', () => {
    const access = ready(handleOf().ports);

    expect(targetsOf(access)).toEqual([{ id: 'fixture-target', name: 'fixture-target', port: 8080, access }]);
    expect(targetsOf({ kind: 'no-connection' })).toEqual([{ id: 'fixture-target', name: 'fixture-target', port: 8080, access: { kind: 'no-connection' } }]);
  });

  it('draws the Name, the Port and the Forward of the target, and the three buttons in the last', () => {
    const [row] = targetsOf(ready(handleOf().ports));
    const columns = portsPage.definition.columns;
    expect(columns.map((column) => column.header)).toEqual(['Name', 'Port', 'Forward']);

    render(<>{columns[2]?.cell(row)}</>);

    expect(forwardButton()).toBeInTheDocument();
    expect(stopButton()).toBeInTheDocument();
    expect(againButton()).toBeInTheDocument();
  });

  it('titles the tab Targets and puts the connection, by its name, in the path', () => {
    expect(targetsFrame({ named: 'harbor', pending: false })).toMatchObject({ tab: { title: 'Targets' }, path: ['Seam Ports', 'harbor', 'Targets'] });
    expect(targetsFrame({ named: undefined, pending: true }).path).toEqual(['Seam Ports', 'Targets']);
  });

  it('says the connection in the marked face of the lane', () => {
    expect(targetsFrame({ named: 'harbor', pending: false }).scope).toEqual([{ label: 'Connection', icon: 'server', text: 'harbor', role: 'connection' }]);
  });

  it('says no connection when the route names none, and not the one the plugin would have chosen: a page open in none is not open in the first', () => {
    const chosen = { named: 'harbor', pending: false };

    expect(frameConnectionOf('harbor-9c41e07ab2', chosen)).toBe(chosen);
    expect(frameConnectionOf(undefined, chosen)).toEqual({ named: undefined, pending: false });
    expect(targetsFrame(frameConnectionOf(undefined, chosen))).toMatchObject({ path: ['Seam Ports', 'Targets'], scope: [{ label: 'Connection', icon: 'server', text: 'None', role: 'connection' }] });
  });
});

describe('the bundle of the ports fixture', () => {
  it('is a contribution the host admits, whose home is the page with the buttons', () => {
    const admission = admit({ contributionV1 });

    expect(admission).toMatchObject({ ok: true });
    expect(Object.keys(contributionV1.pages)).toEqual(['targets']);
    expect(contributionV1.home).toBe('targets');
    expect(contributionV1.plugin.name).toBe('Seam Ports');
  });
});
