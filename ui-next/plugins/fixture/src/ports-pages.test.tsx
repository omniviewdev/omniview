import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { admit } from '../../contract/admit';
import type { PanelHostV1, PortForwardErrorCodeV1, PortForwardErrorV1, PortForwardRequestV1, PortForwardSessionV1 } from '../../contract/v1';
import { contributionV1 } from './entry-ports';
import { ForwardControl, accessOf, frameConnectionOf, portsPage, targetsFrame, targetsOf, type ForwardAccess } from './ports-pages';

// The page of the ports fixture: one row, the fixture's target, and in it the seven buttons: the three that ask the host to forward its port, to stop what was forwarded and to forward the same port again, and the four that drive the host's rules (a thousand
// forwards asked at once, the stop of every forward the page holds, an id of a mebibyte, and a forward asked after the action that made the press has lapsed). The handle the host gives a page (`ctx.panel.ports`) is a stand-in whose answers the test holds back and lets
// go in the order it chooses, so what the page says while a call is under way and after it is read on the screen and not guessed.

type Ports = NonNullable<PanelHostV1['ports']>;

/** A promise the test settles when it chooses. */
type Held<T> = PromiseWithResolvers<T>;

/**
 * What the host answers for a forward it started: the contract's whole answer. The host states no address (`localHost` is there only when a producer states one, and the fixture's does not), so the answer has none unless the test gives
 * one. `stop` is the one the test can see called, and answers at once unless the test gives it a promise to hold.
 */
function answerOf(sessionId: string, over: { readonly localPort?: number; readonly localHost?: string; readonly stop?: () => Promise<void> } = {}) {
  const stop = vi.fn<() => Promise<void>>(over.stop ?? (async () => undefined));
  const answer: PortForwardSessionV1 = { sessionId, localPort: over.localPort ?? 41_234, ...(over.localHost === undefined ? {} : { localHost: over.localHost }), stop };
  return { answer, stop };
}

/** A refusal the way the host makes one: an Error named `PortForwardError` that carries the class of refusal in `code`. */
const hostRefusal = (code: PortForwardErrorCodeV1, message: string, limit?: number): PortForwardErrorV1 =>
  Object.assign(new Error(message), { name: 'PortForwardError' as const, code, ...(limit === undefined ? {} : { limit }) });

/** A handle that answers each call of `forward` with the next promise given, and with one that is never settled when there are none left. */
function handleOf(...answers: Array<Promise<PortForwardSessionV1>>) {
  const queue = [...answers];
  const forward = vi.fn<(request: PortForwardRequestV1) => Promise<PortForwardSessionV1>>(async () => queue.shift() ?? Promise.withResolvers<PortForwardSessionV1>().promise);
  const ports: Ports = { forward };
  return { ports, forward };
}

/** What a host that is starting forwards holds for each one: the promise the page waits on, the answer that settles it and the stop of that answer. */
type Starting = { readonly held: Held<PortForwardSessionV1>; readonly answer: PortForwardSessionV1; readonly stop: Mock<() => Promise<void>> };

/**
 * A host that is asked for forwards in a crowd. `refuse` says, of the call that has this number (the first is 0), the refusal it is answered with at once; every other call is a forward that is started when the test lets it (`letGo`), whose stop waits until the test
 * lets it (`letStop`) and is refused for the ones, counted among those that started, that `refusingStop` names. What the page does with a thousand calls, and with as many stops, is read in the order the test chooses.
 */
function hostOf(refuse: (call: number) => PortForwardErrorV1 | undefined, refusingStop: (ordinal: number) => boolean = () => false) {
  const starts: Starting[] = [];
  const gate = Promise.withResolvers<void>();
  let calls = 0;
  const forward = vi.fn<(request: PortForwardRequestV1) => Promise<PortForwardSessionV1>>(async () => {
    const call = calls;
    calls += 1;
    const refusal = refuse(call);
    if (refusal !== undefined) {
      throw refusal;
    }

    const ordinal = starts.length;
    const held = Promise.withResolvers<PortForwardSessionV1>();
    const stopping = async () => {
      await gate.promise;
      if (refusingStop(ordinal)) {
        throw hostRefusal('NOT_FOUND', 'The plugin of the forward is not there.');
      }
    };

    const { answer, stop } = answerOf(`s${String(ordinal)}`, { localPort: 40_000 + ordinal, stop: stopping });
    starts.push({ held, answer, stop });
    return held.promise;
  });
  const ports: Ports = { forward };
  /** Lets every forward that is being started be answered, inside act, and waits for what the page does with the answers. */
  const letGo = async () => {
    await act(async () => {
      for (const { held, answer } of starts) {
        held.resolve(answer);
      }

      await Promise.all(starts.map(async ({ held }) => held.promise));
    });
  };

  /** Lets every stop be answered, inside act, and waits for what the page does with the answers. */
  const letStop = async () => {
    await act(async () => {
      gate.resolve();
      await gate.promise;
    });
  };

  return { ports, forward, starts, letGo, letStop };
}

/** A host with room for `room` forwards, as the window's count gives a plugin: it refuses every other call `RESOURCE_LIMIT`, with the cap as its limit and in words. */
const crowdOf = (room: number, refusingStop?: (ordinal: number) => boolean) =>
  hostOf((call) => (call < room ? undefined : hostRefusal('RESOURCE_LIMIT', `This plugin already holds ${String(room)} forwards in this connection. Stop one first.`, room)), refusingStop);

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
const manyButton = () => screen.getByRole('button', { name: 'Forward 1,000 times' });
const stopAllButton = () => screen.getByRole('button', { name: 'Stop all of them' });
const longIdButton = () => screen.getByRole('button', { name: 'Forward with a 1 MiB id' });
const lapsedButton = () => screen.getByRole('button', { name: 'Forward after 6 seconds' });
/** The seven buttons, in the order they are drawn. */
const allButtons = () => [forwardButton(), stopButton(), againButton(), manyButton(), stopAllButton(), longIdButton(), lapsedButton()];
/** What the page says of the last call, exactly: the one status of the page holds the words and nothing else. */
const said = () => status().textContent;
/** Lets what the page does after a call that was answered at once be done, inside act. */
const settled = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

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

  it('says the address the host’s answer states when it states one, and not the one its own forwarder listens on', async () => {
    const started = Promise.withResolvers<PortForwardSessionV1>();
    render(<ForwardControl access={ready(handleOf(started.promise).ports)} />);
    await userEvent.setup().click(forwardButton());

    await release(started, { answer: answerOf('c3', { localPort: 53_002, localHost: '10.0.0.5' }).answer });

    expect(status()).toHaveTextContent('Forward session c3 on 10.0.0.5:53002');
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

  it('says on each button why it waits while the first forward is under way: Stop, Forward the same port again and Stop all have nothing to act on yet, and the others wait for the host', async () => {
    const first = Promise.withResolvers<PortForwardSessionV1>();
    render(<ForwardControl access={ready(handleOf(first.promise).ports)} />);

    await userEvent.setup().click(forwardButton());

    expect(forwardButton()).toHaveAttribute('aria-busy', 'true');
    expect(forwardButton()).not.toHaveAttribute('aria-disabled');
    for (const button of [stopButton(), againButton(), stopAllButton()]) {
      expect(button).toHaveAccessibleDescription('No forward was started on this page yet.');
    }

    for (const button of [manyButton(), longIdButton(), lapsedButton()]) {
      expect(button).toHaveAccessibleDescription(underWay);
    }

    expect(printed('No forward was started on this page yet.')).toBeVisible();
    expect(printed(underWay)).toBeVisible();
  });
});

describe('the button that forwards a thousand times', () => {
  const underWay = 'The host has not answered the last press yet.';

  it('asks the host a thousand times in the press itself, each call made before the press has returned, for the one resource and port and for no local port', async () => {
    const crowd = crowdOf(64);
    render(<ForwardControl access={ready(crowd.ports)} />);

    fireEvent.click(manyButton());

    // Nothing was waited for: the calls are made in the user action that made the press, which is where the host asks for one.
    expect(crowd.forward).toHaveBeenCalledTimes(1000);
    expect(crowd.starts).toHaveLength(64);
    expect([...new Set(crowd.forward.mock.calls.map(([request]) => JSON.stringify(request)))]).toEqual([JSON.stringify({ resourceId: 'fixture-target', resourceKey: 'fixture:/targets', remotePort: 8080 })]);
    expect(manyButton()).toHaveAttribute('aria-busy', 'true');
    expect(status()).toHaveTextContent('');
    await crowd.letGo();
  });

  it('says how many started and how many the host refused, by their code with the limit, and the first words the host said', async () => {
    const crowd = crowdOf(64);
    render(<ForwardControl access={ready(crowd.ports)} />);
    await userEvent.setup().click(manyButton());

    await crowd.letGo();

    expect(said()).toBe('Asked 1000 forwards: 64 started, 936 refused (RESOURCE_LIMIT 936, limit 64). The host said: This plugin already holds 64 forwards in this connection. Stop one first.');
    expect(manyButton()).not.toHaveAttribute('aria-busy');
  });

  it('says that all of them started when the host refused none', async () => {
    const crowd = crowdOf(1000);
    render(<ForwardControl access={ready(crowd.ports)} />);
    await userEvent.setup().click(manyButton());

    await crowd.letGo();

    expect(said()).toBe('Asked 1000 forwards: 1000 started, 0 refused.');
  });

  it('says the codes in the order they were first seen in the calls, each with how many there were, and the limit of the refusal that carries one', async () => {
    const refusals = new Map<number, PortForwardErrorV1>([
      [0, hostRefusal('FORBIDDEN', 'Not from a user action.')],
      [1, hostRefusal('RESOURCE_LIMIT', 'Full.', 64)],
      [2, hostRefusal('UNAVAILABLE', 'Not now.')],
      [3, hostRefusal('FORBIDDEN', 'Not from a user action.')],
    ]);
    const host = hostOf((call) => refusals.get(call));
    render(<ForwardControl access={ready(host.ports)} />);
    await userEvent.setup().click(manyButton());

    await host.letGo();

    expect(said()).toBe('Asked 1000 forwards: 996 started, 4 refused (FORBIDDEN 2, RESOURCE_LIMIT 1, UNAVAILABLE 1, limit 64). The host said: Not from a user action.');
  });

  it('says that none started when the host refused every call, and the page still has nothing to stop', async () => {
    const words = 'A forward can only be started from a user action: a click or a key press.';
    const host = hostOf(() => hostRefusal('FORBIDDEN', words));
    render(<ForwardControl access={ready(host.ports)} />);
    await userEvent.setup().click(manyButton());

    await settled();

    expect(said()).toBe(`Asked 1000 forwards: 0 started, 1000 refused (FORBIDDEN 1000). The host said: ${words}`);
    for (const button of [stopButton(), againButton(), stopAllButton()]) {
      expect(button).toHaveAttribute('aria-disabled', 'true');
      expect(button).toHaveAccessibleDescription('No forward was started on this page yet.');
    }
  });

  it('keeps the answers that started: the last of them in the order of the calls is the one Stop stops and the one whose port Forward the same port again asks for', async () => {
    const crowd = crowdOf(64);
    const user = userEvent.setup();
    render(<ForwardControl access={ready(crowd.ports)} />);
    await user.click(manyButton());
    await crowd.letGo();
    expect(stopButton()).not.toHaveAttribute('aria-disabled');
    expect(againButton()).not.toHaveAttribute('aria-disabled');

    await user.click(againButton());
    await settled();
    expect(crowd.forward).toHaveBeenLastCalledWith({ resourceId: 'fixture-target', resourceKey: 'fixture:/targets', remotePort: 8080, localPort: 40_063 });

    await user.click(stopButton());
    await crowd.letStop();

    expect(crowd.starts.map(({ stop }) => stop.mock.calls.length)).toEqual([...Array.from({ length: 63 }, () => 0), 1]);
    expect(said()).toBe('Stopped forward s63');
  });

  it('is busy while the host answers, says on every other button that the host has not answered, and a press on any button in that time asks for nothing', async () => {
    const crowd = crowdOf(64);
    const user = userEvent.setup();
    render(<ForwardControl access={ready(crowd.ports)} />);
    await user.click(forwardButton());
    await crowd.letGo();

    await user.click(manyButton());

    expect(manyButton()).toHaveAttribute('aria-busy', 'true');
    expect(manyButton()).not.toHaveAttribute('aria-disabled');
    for (const button of [forwardButton(), stopButton(), againButton(), stopAllButton(), longIdButton(), lapsedButton()]) {
      expect(button).toHaveAttribute('aria-disabled', 'true');
      expect(button).toHaveAccessibleDescription(underWay);
    }

    expect(printed(underWay)).toBeVisible();
    await user.click(manyButton());
    await user.click(forwardButton());
    await user.click(stopAllButton());
    expect(crowd.forward).toHaveBeenCalledTimes(1001);
    await crowd.letGo();
    for (const button of allButtons()) {
      expect(button).not.toHaveAttribute('aria-disabled');
    }

    expect(screen.queryByText(underWay)).not.toBeInTheDocument();
  });
});

describe('the button that stops all of them', () => {
  const underWay = 'The host has not answered the last press yet.';

  it('is unavailable until the page holds a forward: it says why on the page and on the button, and presses nothing', async () => {
    render(<ForwardControl access={ready(handleOf().ports)} />);

    expect(stopAllButton()).toHaveAttribute('aria-disabled', 'true');
    expect(stopAllButton()).toHaveAccessibleDescription('No forward was started on this page yet.');
    expect(printed('No forward was started on this page yet.')).toBeVisible();
    await userEvent.setup().click(stopAllButton());
    expect(status()).toHaveTextContent('');
  });

  it('is available once the host has answered a forward, and the reason is gone', async () => {
    const started = Promise.withResolvers<PortForwardSessionV1>();
    render(<ForwardControl access={ready(handleOf(started.promise).ports)} />);
    await userEvent.setup().click(forwardButton());

    await release(started, { answer: answerOf('a1').answer });

    expect(stopAllButton()).not.toHaveAttribute('aria-disabled');
    expect(screen.queryByText('No forward was started on this page yet.')).not.toBeInTheDocument();
  });

  it('stops every forward the page holds, each once, with every stop asked in the press itself, and says how many were stopped', async () => {
    const crowd = crowdOf(64);
    const user = userEvent.setup();
    render(<ForwardControl access={ready(crowd.ports)} />);
    await user.click(manyButton());
    await crowd.letGo();

    fireEvent.click(stopAllButton());

    expect(crowd.starts.map(({ stop }) => stop.mock.calls.length)).toEqual(Array.from({ length: 64 }, () => 1));
    expect(stopAllButton()).toHaveAttribute('aria-busy', 'true');
    expect(status()).toHaveTextContent('');
    await crowd.letStop();

    expect(said()).toBe('Stopped 64 forwards.');
    expect(stopAllButton()).not.toHaveAttribute('aria-busy');
    expect(crowd.starts.map(({ stop }) => stop.mock.calls.length)).toEqual(Array.from({ length: 64 }, () => 1));
  });

  it('stops the forwards that the first button and the button that forwards the same port again started', async () => {
    const first = Promise.withResolvers<PortForwardSessionV1>();
    const second = Promise.withResolvers<PortForwardSessionV1>();
    const one = answerOf('a1', { localPort: 41_001 });
    const two = answerOf('b2', { localPort: 41_001 });
    const user = userEvent.setup();
    render(<ForwardControl access={ready(handleOf(first.promise, second.promise).ports)} />);
    await user.click(forwardButton());
    await release(first, { answer: one.answer });
    await user.click(againButton());
    await release(second, { answer: two.answer });

    await user.click(stopAllButton());

    expect(one.stop).toHaveBeenCalledTimes(1);
    expect(two.stop).toHaveBeenCalledTimes(1);
    expect(said()).toBe('Stopped 2 forwards.');
  });

  it('says how many of them the host refused to stop, keeps those, and a press after it asks only for those', async () => {
    const crowd = crowdOf(64, (ordinal) => ordinal === 5 || ordinal === 7);
    const user = userEvent.setup();
    render(<ForwardControl access={ready(crowd.ports)} />);
    await user.click(manyButton());
    await crowd.letGo();
    await user.click(stopAllButton());
    await crowd.letStop();

    expect(said()).toBe('Stopped 62 of 64 forwards; 2 were refused.');
    expect(stopAllButton()).not.toHaveAttribute('aria-disabled');
    await user.click(stopAllButton());
    await settled();

    expect(said()).toBe('Stopped 0 of 2 forwards; 2 were refused.');
    expect(crowd.starts.map(({ stop }) => stop.mock.calls.length)).toEqual(Array.from({ length: 64 }, (_, ordinal) => (ordinal === 5 || ordinal === 7 ? 2 : 1)));
  });

  it('does not ask again for a forward that Stop stopped', async () => {
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

    await user.click(stopAllButton());

    expect(two.stop).toHaveBeenCalledTimes(1);
    expect(one.stop).toHaveBeenCalledTimes(1);
    expect(said()).toBe('Stopped 1 forwards.');
  });

  it('holds each answer once, however many times a thousand is asked', async () => {
    const crowd = crowdOf(64);
    const user = userEvent.setup();
    render(<ForwardControl access={ready(crowd.ports)} />);
    await user.click(manyButton());
    await crowd.letGo();
    await user.click(manyButton());
    await settled();
    expect(said()).toBe('Asked 1000 forwards: 0 started, 1000 refused (RESOURCE_LIMIT 1000, limit 64). The host said: This plugin already holds 64 forwards in this connection. Stop one first.');

    await user.click(stopAllButton());
    await crowd.letStop();

    expect(said()).toBe('Stopped 64 forwards.');
  });

  it('leaves Stop and Forward the same port again as they were: the forward that was answered last is still the last one, and it is the host that says it is stopped', async () => {
    const started = Promise.withResolvers<PortForwardSessionV1>();
    const { answer, stop } = answerOf('a1', { localPort: 41_001 });
    const user = userEvent.setup();
    render(<ForwardControl access={ready(handleOf(started.promise).ports)} />);
    await user.click(forwardButton());
    await release(started, { answer });
    await user.click(stopAllButton());
    expect(said()).toBe('Stopped 1 forwards.');
    expect(stopAllButton()).toHaveAttribute('aria-disabled', 'true');
    expect(stopAllButton()).toHaveAccessibleDescription('No forward was started on this page yet.');

    expect(stopButton()).not.toHaveAttribute('aria-disabled');
    expect(againButton()).not.toHaveAttribute('aria-disabled');
    await user.click(stopButton());

    expect(stop).toHaveBeenCalledTimes(2);
    expect(said()).toBe('Stopped forward a1');
  });

  it('is busy while the host stops them, says on every other button that the host has not answered, and presses on them ask for nothing', async () => {
    const crowd = crowdOf(64);
    const user = userEvent.setup();
    render(<ForwardControl access={ready(crowd.ports)} />);
    await user.click(manyButton());
    await crowd.letGo();

    await user.click(stopAllButton());

    expect(stopAllButton()).toHaveAttribute('aria-busy', 'true');
    expect(stopAllButton()).not.toHaveAttribute('aria-disabled');
    for (const button of [forwardButton(), stopButton(), againButton(), manyButton(), longIdButton(), lapsedButton()]) {
      expect(button).toHaveAttribute('aria-disabled', 'true');
      expect(button).toHaveAccessibleDescription(underWay);
    }

    await user.click(stopButton());
    await user.click(stopAllButton());
    expect(crowd.starts.map(({ stop }) => stop.mock.calls.length)).toEqual(Array.from({ length: 64 }, () => 1));
    await crowd.letStop();
    expect(stopAllButton()).toHaveAttribute('aria-disabled', 'true');
    expect(stopButton()).not.toHaveAttribute('aria-disabled');
  });

  it('says each reason once when two are in force: nothing is held to stop all of, and the host has not answered the last press', async () => {
    const first = Promise.withResolvers<PortForwardSessionV1>();
    const second = Promise.withResolvers<PortForwardSessionV1>();
    const user = userEvent.setup();
    render(<ForwardControl access={ready(handleOf(first.promise, second.promise).ports)} />);
    await user.click(forwardButton());
    await release(first, { answer: answerOf('a1', { localPort: 41_001 }).answer });
    await user.click(stopAllButton());
    await user.click(forwardButton());

    expect(stopAllButton()).toHaveAccessibleDescription('No forward was started on this page yet.');
    expect(stopButton()).toHaveAccessibleDescription(underWay);
    expect(printed('No forward was started on this page yet.')).toBeVisible();
    expect(printed(underWay)).toBeVisible();
  });
});

describe('the button that forwards with an id of a mebibyte', () => {
  const underWay = 'The host has not answered the last press yet.';

  it('asks one forward whose id is 1,048,576 characters long and, for the rest, what the first button asks', async () => {
    const { ports, forward } = handleOf();
    render(<ForwardControl access={ready(ports)} />);

    await userEvent.setup().click(longIdButton());

    expect(forward).toHaveBeenCalledTimes(1);
    const request = forward.mock.calls.at(0)?.at(0);
    expect(request?.resourceId.length).toBe(1_048_576);
    expect(request).toMatchObject({ resourceKey: 'fixture:/targets', remotePort: 8080 });
    expect(Object.keys(request ?? {})).toEqual(['resourceId', 'resourceKey', 'remotePort']);
  });

  it('says the refusal in the words of a refusal: by its code and in the host’s own', async () => {
    const refused = Promise.withResolvers<PortForwardSessionV1>();
    render(<ForwardControl access={ready(handleOf(refused.promise).ports)} />);
    await userEvent.setup().click(longIdButton());
    expect(longIdButton()).toHaveAttribute('aria-busy', 'true');

    await release(refused, { refusal: hostRefusal('INVALID_REQUEST', 'The resourceId is longer than 1024 characters.') });

    expect(said()).toBe('Refused INVALID_REQUEST: The resourceId is longer than 1024 characters.');
    expect(longIdButton()).not.toHaveAttribute('aria-busy');
  });

  it('says the forward, and holds it, when the host starts it: Stop all stops it, and Stop and Forward the same port again have it as the last one answered', async () => {
    const started = Promise.withResolvers<PortForwardSessionV1>();
    const { answer, stop } = answerOf('l1', { localPort: 41_500 });
    const user = userEvent.setup();
    render(<ForwardControl access={ready(handleOf(started.promise).ports)} />);
    await user.click(longIdButton());

    await release(started, { answer });

    expect(said()).toBe('Forward session l1 on 127.0.0.1:41500');
    expect(stopButton()).not.toHaveAttribute('aria-disabled');
    expect(againButton()).not.toHaveAttribute('aria-disabled');
    await user.click(stopAllButton());
    expect(stop).toHaveBeenCalledTimes(1);
    expect(said()).toBe('Stopped 1 forwards.');
  });

  it('is busy while the host answers, says on the other buttons why they wait, and a press on any button in that time asks for nothing', async () => {
    const started = Promise.withResolvers<PortForwardSessionV1>();
    const { ports, forward } = handleOf(started.promise);
    const user = userEvent.setup();
    render(<ForwardControl access={ready(ports)} />);
    await user.click(longIdButton());

    expect(longIdButton()).toHaveAttribute('aria-busy', 'true');
    expect(longIdButton()).not.toHaveAttribute('aria-disabled');
    for (const button of [forwardButton(), manyButton(), lapsedButton()]) {
      expect(button).toHaveAccessibleDescription(underWay);
    }

    await user.click(longIdButton());
    await user.click(forwardButton());
    expect(forward).toHaveBeenCalledTimes(1);
    await release(started, { refusal: hostRefusal('INVALID_REQUEST', 'The resourceId is longer than 1024 characters.') });
    expect(longIdButton()).not.toHaveAttribute('aria-busy');
  });
});

describe('the button that forwards after six seconds', () => {
  const underWay = 'The host has not answered the last press yet.';
  const lapsed = 'A forward can only be started from a user action: a click or a key press.';

  // Only the timers are the test's: the page's wait is read on the clock the test moves, and nothing else is faked.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const press = async (button: HTMLElement) => {
    await act(async () => {
      fireEvent.click(button);
    });
  };

  const wait = async (ms: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };

  it('says that it will ask in six seconds, after the action has lapsed, and asks nothing yet: it is busy, and the others say why they wait', async () => {
    const { ports, forward } = handleOf();
    render(<ForwardControl access={ready(ports)} />);

    await press(lapsedButton());

    expect(said()).toBe('Asking in 6 seconds, after the action has lapsed.');
    expect(lapsedButton()).toHaveAttribute('aria-busy', 'true');
    expect(lapsedButton()).not.toHaveAttribute('aria-disabled');
    for (const button of [forwardButton(), manyButton(), longIdButton()]) {
      expect(button).toHaveAttribute('aria-disabled', 'true');
      expect(button).toHaveAccessibleDescription(underWay);
    }

    for (const button of [stopButton(), againButton(), stopAllButton()]) {
      expect(button).toHaveAccessibleDescription('No forward was started on this page yet.');
    }

    expect(forward).not.toHaveBeenCalled();
  });

  it('asks one forward the normal way when the six seconds are over, from the timer and not before, and says the refusal in the words of a refusal', async () => {
    const refused = Promise.withResolvers<PortForwardSessionV1>();
    const { ports, forward } = handleOf(refused.promise);
    render(<ForwardControl access={ready(ports)} />);
    await press(lapsedButton());

    await wait(5_999);
    expect(forward).not.toHaveBeenCalled();
    expect(said()).toBe('Asking in 6 seconds, after the action has lapsed.');
    await wait(1);

    expect(forward).toHaveBeenCalledTimes(1);
    expect(forward).toHaveBeenCalledWith({ resourceId: 'fixture-target', resourceKey: 'fixture:/targets', remotePort: 8080 });
    expect(lapsedButton()).toHaveAttribute('aria-busy', 'true');
    expect(status()).toHaveTextContent('');
    await release(refused, { refusal: hostRefusal('FORBIDDEN', lapsed) });
    expect(said()).toBe(`Refused FORBIDDEN: ${lapsed}`);
    expect(lapsedButton()).not.toHaveAttribute('aria-busy');
    for (const button of [forwardButton(), manyButton(), longIdButton(), lapsedButton()]) {
      expect(button).not.toHaveAttribute('aria-disabled');
    }

    for (const button of [stopButton(), againButton(), stopAllButton()]) {
      expect(button).toHaveAccessibleDescription('No forward was started on this page yet.');
    }
  });

  it('says the forward, and holds it, when the host starts it: the action had not lapsed after all', async () => {
    const started = Promise.withResolvers<PortForwardSessionV1>();
    const { answer, stop } = answerOf('t1', { localPort: 41_600 });
    render(<ForwardControl access={ready(handleOf(started.promise).ports)} />);
    await press(lapsedButton());
    await wait(6_000);

    await release(started, { answer });

    expect(said()).toBe('Forward session t1 on 127.0.0.1:41600');
    await press(stopAllButton());
    expect(stop).toHaveBeenCalledTimes(1);
    expect(said()).toBe('Stopped 1 forwards.');
  });

  it('asks nothing when another button is pressed while it waits', async () => {
    const { ports, forward } = handleOf();
    render(<ForwardControl access={ready(ports)} />);
    await press(lapsedButton());

    await press(forwardButton());
    await press(manyButton());
    await press(longIdButton());
    await press(lapsedButton());

    expect(forward).not.toHaveBeenCalled();
    expect(said()).toBe('Asking in 6 seconds, after the action has lapsed.');
  });

  it('asks nothing and leaves no timer behind when the page goes while it waits', async () => {
    const { ports, forward } = handleOf();
    const { unmount } = render(<ForwardControl access={ready(ports)} />);
    const before = vi.getTimerCount();
    await press(lapsedButton());
    expect(vi.getTimerCount()).toBeGreaterThan(before);

    unmount();

    expect(vi.getTimerCount()).toBe(before);
    await wait(10_000);
    expect(forward).not.toHaveBeenCalled();
  });

  it('has no timer of its own before a press, and none once the host has answered', async () => {
    const refused = Promise.withResolvers<PortForwardSessionV1>();
    render(<ForwardControl access={ready(handleOf(refused.promise).ports)} />);
    expect(vi.getTimerCount()).toBe(0);
    await press(lapsedButton());
    await wait(6_000);

    await release(refused, { refusal: hostRefusal('FORBIDDEN', lapsed) });

    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('where the page cannot forward', () => {
  it('says that the page is open in no connection, once on the page and on each of the seven buttons, and presses nothing', async () => {
    render(<ForwardControl access={{ kind: 'no-connection' }} />);

    for (const button of allButtons()) {
      expect(button).toHaveAttribute('aria-disabled', 'true');
      expect(button).toHaveAccessibleDescription('This page is open in no connection, so it cannot forward ports.');
    }

    expect(printed('This page is open in no connection, so it cannot forward ports.')).toBeVisible();
    expect(screen.queryByText('This version of the app cannot forward ports.')).not.toBeInTheDocument();
    await userEvent.setup().click(forwardButton());
    expect(status()).toHaveTextContent('');
  });

  it('says that this version of the app cannot forward ports where the host has no handle for it, on the page and on each of the seven buttons, and presses nothing', async () => {
    render(<ForwardControl access={{ kind: 'no-member' }} />);

    for (const button of allButtons()) {
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

  it('draws the Name, the Port and the Forward of the target, and the seven buttons in the last', () => {
    const [row] = targetsOf(ready(handleOf().ports));
    const columns = portsPage.definition.columns;
    expect(columns.map((column) => column.header)).toEqual(['Name', 'Port', 'Forward']);

    render(<>{columns[2]?.cell(row)}</>);

    // Drawn in this order, and no other button is: the label of a button that is unavailable holds its reason too, so the buttons are named by what finds them.
    const drawn = screen.getAllByRole('button');
    expect(drawn).toHaveLength(7);
    expect(drawn.every((button, index) => button === allButtons()[index])).toBe(true);
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
