import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AGAIN_LABEL,
  ASKED,
  FORWARD_HOST,
  FORWARD_LABEL,
  LAPSED_LABEL,
  LAPSE_MS,
  LAPSE_WORDS,
  LONG_ID_LABEL,
  LONG_ID_LENGTH,
  MANY_LABEL,
  NO_CONNECTION_WORDS,
  NO_FORWARD_WORDS,
  NO_PORTS_WORDS,
  PENDING_WORDS,
  PORTS_CONNECTION_KEY,
  PORTS_CONNECTION_NAME,
  PORTS_ID,
  STOP_ALL_LABEL,
  STOP_LABEL,
  TARGET_GREETING,
  TARGET_ID,
  TARGET_PORT,
  TARGET_RESOURCE_KEY,
  askedOf,
  forwardRequest,
  limitOf,
  longIdRequest,
  outcomeWords,
  refusalOf,
} from './ports';

// The ports fixture's facts, written once for the page, the build and the check that drives them (`ports.ts`), and once for the Go side that serves them (`../portforward`, `../ports-process`). Two copies cannot be one
// file, so the test reads the Go sources as text and holds the two to the same words: a change on one side that the other did not follow fails here, and not as a forward that nobody answers in a browser.

const fixtureDirectory = path.join(import.meta.dirname, '..');
const goSource = async (file: string) => readFile(path.join(fixtureDirectory, file), 'utf8');
/** The text a Go constant of this name is given in a source: `Name = "text"`, alone or in a block, and the text as it is written in the source (an escape stays an escape). */
const goString = (source: string, name: string): string | undefined => new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`).exec(source)?.[1];

describe('what the page and the Go side both say', () => {
  it('names the same plugin, connection, resource, key, port and greeting', async () => {
    const process = await goSource('ports-process/main.go');
    const forwarder = await goSource('portforward/forwarder.go');
    const server = await goSource('portforward/server.go');

    expect(goString(process, 'pluginID')).toBe(PORTS_ID);
    expect(goString(process, 'connectionID')).toBe(PORTS_CONNECTION_KEY);
    expect(goString(process, 'connectionName')).toBe(PORTS_CONNECTION_NAME);
    expect(goString(forwarder, 'ResourceKey')).toBe(TARGET_RESOURCE_KEY);
    expect(goString(forwarder, 'TargetID')).toBe(TARGET_ID);
    expect(Number(/\bTargetPort\s+int32\s*=\s*(\d+)/.exec(forwarder)?.[1])).toBe(TARGET_PORT);
    // The Go line ends in its newline, which is how a client knows it has all of the line.
    expect(goString(server, 'Greeting')).toBe(`${TARGET_GREETING}\\n`);
  });

  it('says the address its own forwarder listens on when the host states none: the Go side listens on the loopback, and says it once', async () => {
    const endpoint = await goSource('portforward/endpoint.go');
    expect(goString(endpoint, 'loopbackHost')).toBe(FORWARD_HOST);
    expect(FORWARD_HOST).toBe('127.0.0.1');
  });

  it('makes a connection key the way the host makes its own: the name and ten hexadecimal digits', () => {
    expect(PORTS_CONNECTION_KEY).toMatch(new RegExp(`^${PORTS_CONNECTION_NAME}-[0-9a-f]{10}$`));
  });
});

describe('the request the buttons make', () => {
  it('names the fixture’s one resource, its key and its port, and no local port: the host takes a free one, and 0 is not a way to say so', () => {
    expect(forwardRequest()).toEqual({ resourceId: 'fixture-target', resourceKey: 'fixture:/targets', remotePort: 8080 });
    expect(Object.keys(forwardRequest())).not.toContain('localPort');
  });

  it('names the port of a forward that was answered when that port is asked for again, and nothing else is different', () => {
    expect(forwardRequest(41_234)).toEqual({ resourceId: 'fixture-target', resourceKey: 'fixture:/targets', remotePort: 8080, localPort: 41_234 });
  });

  it('is a new object each time, so a host that keeps one cannot change the next', () => {
    expect(forwardRequest()).not.toBe(forwardRequest());
    expect(forwardRequest(41_234)).not.toBe(forwardRequest(41_234));
  });
});

describe('the names the page uses', () => {
  it('names the three buttons the way the check looks for them', () => {
    expect(FORWARD_LABEL).toBe('Forward fixture port');
    expect(STOP_LABEL).toBe('Stop fixture forward');
    expect(AGAIN_LABEL).toBe('Forward the same port again');
  });

  it('says in its own words why a page cannot forward: a host without the member, and a page open in no connection', () => {
    expect(NO_PORTS_WORDS).toBe('This version of the app cannot forward ports.');
    expect(NO_CONNECTION_WORDS).toBe('This page is open in no connection, so it cannot forward ports.');
  });

  it('says in its own words why there is nothing to stop and no port to ask for again', () => {
    expect(NO_FORWARD_WORDS).toBe('No forward was started on this page yet.');
  });

  it('says in its own words why the buttons that were not pressed wait while the host answers the one that was', () => {
    expect(PENDING_WORDS).toBe('The host has not answered the last press yet.');
  });
});

describe('what the page says', () => {
  const id = '4f9d2c1e-aaaa-bbbb-cccc-0123456789ab';

  it('says nothing before a press and while a call is under way, whichever button it is of', () => {
    expect(outcomeWords({ kind: 'idle' })).toBeUndefined();
    for (const action of ['forward', 'stop', 'again', 'many', 'stop-all', 'long-id', 'lapsed'] as const) {
      expect(outcomeWords({ kind: 'pending', action })).toBeUndefined();
    }
  });

  it('says the forward the host started and where to connect to it, from the host’s answer', () => {
    expect(outcomeWords({ kind: 'started', sessionId: id, localHost: '127.0.0.1', localPort: 41_234 })).toBe(`Forward session ${id} on 127.0.0.1:41234`);
  });

  it('says the forward that was stopped', () => {
    expect(outcomeWords({ kind: 'stopped', sessionId: id })).toBe(`Stopped forward ${id}`);
  });

  it('says a refusal of a forward by its code and in the host’s words', () => {
    expect(outcomeWords({ kind: 'refused', code: 'PROVIDER_ERROR', message: 'The forwarder could not do it.' })).toBe('Refused PROVIDER_ERROR: The forwarder could not do it.');
  });

  it('says a refusal of a stop by its code and in the host’s words', () => {
    expect(outcomeWords({ kind: 'stop-refused', code: 'NOT_FOUND', message: 'The plugin is not there.' })).toBe('Stop refused NOT_FOUND: The plugin is not there.');
  });
});

describe('a refusal, as the page says it', () => {
  /** A refusal the way the host makes one: an Error named for it that carries the class of refusal in `code`. */
  const hostRefusal = (code: string, message: string) => Object.assign(new Error(message), { name: 'PortForwardError', code });

  it('is the code and the message of the host’s error and nothing else of it: never a stack, never what it was caused by', () => {
    const error = Object.assign(hostRefusal('UNAVAILABLE', 'Port 8080 is not available on this computer.'), { stack: 'PortForwardError: x\n    at forward (host.js:1:1)', cause: { raw: '{"code":"UNAVAILABLE"}' } });

    const refusal = refusalOf(error, 'The host could not do it.');

    expect(refusal).toEqual({ code: 'UNAVAILABLE', message: 'Port 8080 is not available on this computer.' });
    expect(Object.keys(refusal).sort()).toEqual(['code', 'message']);
  });

  it('has the code UNKNOWN, the contract’s word for no class, when the rejection is not the host’s error: an error of another name, a text, an error with no code', () => {
    expect(refusalOf(new Error('Boom.'), 'x')).toEqual({ code: 'UNKNOWN', message: 'Boom.' });
    expect(refusalOf('The host refused.', 'x')).toEqual({ code: 'UNKNOWN', message: 'The host refused.' });
    expect(refusalOf(Object.assign(new Error('Named like it.'), { name: 'PortForwardError' }), 'x')).toEqual({ code: 'UNKNOWN', message: 'Named like it.' });
    expect(refusalOf(Object.assign(new Error('Another one.'), { code: 'UNAVAILABLE' }), 'x')).toEqual({ code: 'UNKNOWN', message: 'Another one.' });
  });

  it('does not take a code that is not text for one', () => {
    expect(refusalOf(hostRefusal('', 'Empty code.'), 'x')).toEqual({ code: 'UNKNOWN', message: 'Empty code.' });
    expect(refusalOf(Object.assign(new Error('Number code.'), { name: 'PortForwardError', code: 7 }), 'x')).toEqual({ code: 'UNKNOWN', message: 'Number code.' });
  });

  it('has words of the page’s own for a rejection that says none, and keeps the code it has', () => {
    expect(refusalOf(new Error('  '), 'The host could not start the forward.')).toEqual({ code: 'UNKNOWN', message: 'The host could not start the forward.' });
    expect(refusalOf(undefined, 'The host could not stop the forward.')).toEqual({ code: 'UNKNOWN', message: 'The host could not stop the forward.' });
    expect(refusalOf({ code: 7 }, 'The host could not start the forward.')).toEqual({ code: 'UNKNOWN', message: 'The host could not start the forward.' });
    expect(refusalOf(hostRefusal('CONFLICT', ' '), 'The host could not start the forward.')).toEqual({ code: 'CONFLICT', message: 'The host could not start the forward.' });
  });
});

describe('the buttons that ask for more', () => {
  it('are named the way the check looks for them', () => {
    expect(MANY_LABEL).toBe('Forward 1,000 times');
    expect(STOP_ALL_LABEL).toBe('Stop all of them');
    expect(LONG_ID_LABEL).toBe('Forward with a 1 MiB id');
    expect(LAPSED_LABEL).toBe('Forward after 6 seconds');
  });

  it('ask a thousand forwards, with an id of a mebibyte, and wait six seconds: the numbers their labels say', () => {
    expect(ASKED).toBe(1000);
    expect(LONG_ID_LENGTH).toBe(1_048_576);
    expect(LAPSE_MS).toBe(6000);
  });

  it('say what the page is waiting for while it waits, and why it waits that long', () => {
    expect(LAPSE_WORDS).toBe('Asking in 6 seconds, after the action has lapsed.');
    expect(outcomeWords({ kind: 'waiting' })).toBe(LAPSE_WORDS);
  });
});

describe('the request with an id of a mebibyte', () => {
  it('is the request of the first button with an id of 1,048,576 characters and nothing else different', () => {
    const { resourceId, ...rest } = longIdRequest();

    expect(resourceId.length).toBe(1_048_576);
    expect({ ...rest, resourceId: 'fixture-target' }).toEqual(forwardRequest());
  });

  it('is a new object each time, so a host that keeps one cannot change the next', () => {
    expect(longIdRequest()).not.toBe(longIdRequest());
  });
});

describe('what the page says of the stops of all of them', () => {
  it('says how many forwards were stopped when the host stopped each', () => {
    expect(outcomeWords({ kind: 'stopped-all', stopped: 64, of: 64 })).toBe('Stopped 64 forwards.');
  });

  it('says how many of them were stopped and how many the host refused', () => {
    expect(outcomeWords({ kind: 'stopped-all', stopped: 60, of: 64 })).toBe('Stopped 60 of 64 forwards; 4 were refused.');
    expect(outcomeWords({ kind: 'stopped-all', stopped: 0, of: 2 })).toBe('Stopped 0 of 2 forwards; 2 were refused.');
  });
});

describe('the number a refusal is about', () => {
  const hostRefusal = (limit: unknown) => Object.assign(new Error('Full.'), { name: 'PortForwardError', code: 'RESOURCE_LIMIT', limit });

  it('is the limit the host’s error carries when it is a whole number', () => {
    expect(limitOf(hostRefusal(64))).toBe(64);
    expect(limitOf(hostRefusal(0))).toBe(0);
  });

  it('is nothing for an error that has none, for one that is not the host’s and for a limit that is not a whole number', () => {
    expect(limitOf(hostRefusal(undefined))).toBeUndefined();
    expect(limitOf(hostRefusal('64'))).toBeUndefined();
    expect(limitOf(hostRefusal(6.4))).toBeUndefined();
    expect(limitOf(hostRefusal(Number.NaN))).toBeUndefined();
    expect(limitOf(Object.assign(new Error('Full.'), { limit: 64 }))).toBeUndefined();
    expect(limitOf({ name: 'PortForwardError', limit: 64 })).toBeUndefined();
    expect(limitOf('64')).toBeUndefined();
    expect(limitOf(undefined)).toBeUndefined();
  });
});

describe('what the page says of a thousand asks', () => {
  const started = (): PromiseSettledResult<unknown> => ({ status: 'fulfilled', value: undefined });
  const refused = (reason: unknown): PromiseSettledResult<unknown> => ({ status: 'rejected', reason });
  const hostRefusal = (code: string, message: string, limit?: number) => Object.assign(new Error(message), { name: 'PortForwardError', code, ...(limit === undefined ? {} : { limit }) });
  const wordsOfAsked = (results: ReadonlyArray<PromiseSettledResult<unknown>>) => outcomeWords(askedOf(results));

  it('says that all of them started when the host refused none', () => {
    expect(wordsOfAsked(Array.from({ length: 1000 }, started))).toBe('Asked 1000 forwards: 1000 started, 0 refused.');
  });

  it('says how many started and how many were refused, by their code and with the limit, and the first words the host said', () => {
    const full = hostRefusal('RESOURCE_LIMIT', 'This plugin already holds 64 forwards in this connection. Stop one first.', 64);
    const results = [...Array.from({ length: 64 }, started), ...Array.from({ length: 936 }, () => refused(full))];

    expect(wordsOfAsked(results)).toBe('Asked 1000 forwards: 64 started, 936 refused (RESOURCE_LIMIT 936, limit 64). The host said: This plugin already holds 64 forwards in this connection. Stop one first.');
  });

  it('says the codes in the order they were first seen in the calls, each with how many there were', () => {
    const results = [refused(hostRefusal('FORBIDDEN', 'A.')), started(), refused(hostRefusal('RESOURCE_LIMIT', 'B.')), refused(hostRefusal('FORBIDDEN', 'C.')), refused(new Error('D.')), refused(hostRefusal('RESOURCE_LIMIT', 'E.'))];

    expect(wordsOfAsked(results)).toBe('Asked 6 forwards: 1 started, 5 refused (FORBIDDEN 2, RESOURCE_LIMIT 2, UNKNOWN 1). The host said: A.');
  });

  it('says no limit when no refusal carries one', () => {
    expect(wordsOfAsked([refused(hostRefusal('FORBIDDEN', 'A.')), refused(hostRefusal('FORBIDDEN', 'A.'))])).toBe('Asked 2 forwards: 0 started, 2 refused (FORBIDDEN 2). The host said: A.');
  });

  it('says the limit of the first refusal that carries one, and the words of the first refusal, which may be another', () => {
    const results = [refused(hostRefusal('FORBIDDEN', 'First words.')), refused(hostRefusal('RESOURCE_LIMIT', 'Second.', 64)), refused(hostRefusal('RESOURCE_LIMIT', 'Third.', 128))];

    expect(wordsOfAsked(results)).toBe('Asked 3 forwards: 0 started, 3 refused (FORBIDDEN 1, RESOURCE_LIMIT 2, limit 64). The host said: First words.');
  });

  it('takes a limit only from the host’s error, says UNKNOWN for what is not, and gives words of its own for a refusal that says none', () => {
    expect(wordsOfAsked([refused(Object.assign(new Error('Plain.'), { limit: 64 }))])).toBe('Asked 1 forwards: 0 started, 1 refused (UNKNOWN 1). The host said: Plain.');
    expect(wordsOfAsked([refused(undefined)])).toBe('Asked 1 forwards: 0 started, 1 refused (UNKNOWN 1). The host said: The host could not start the forward.');
  });

  it('counts what it was given and nothing it was not: the tally, as data', () => {
    expect(askedOf([started(), refused(hostRefusal('FORBIDDEN', 'A.')), started()])).toEqual({ kind: 'asked', asked: 3, started: 2, refused: 1, codes: [['FORBIDDEN', 1]], limit: undefined, said: 'A.' });
    expect(askedOf([started()])).toEqual({ kind: 'asked', asked: 1, started: 1, refused: 0, codes: [], limit: undefined, said: undefined });
  });
});
