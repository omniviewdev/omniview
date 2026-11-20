import { describe, expect, it } from 'vitest';
import { mapHostError, readHostError } from './errors';
import { scrubber } from './text';

// What the host says when it refuses a submit: the apperror JSON (`backend/pkg/apperror/apperror.go`, shape in `docs/ui-next/status/E0-1.md`), which Wails hands to the page as a
// `RuntimeError` whose `message` is that JSON. It is read, cleaned, bounded and scrubbed of every secret the user typed, and put on the fields it names and on the form. The envelope has
// no member for a field today (a Backend catalog item): the reader accepts an optional `fields` member and an `instance` that names a field, for when the host sends one.

const envelope = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({ type: 'omniview:validation', title: 'Invalid request', status: 400, detail: 'The URL is not reachable.', code: 'INVALID_REQUEST', requestId: 'req-1', recovery: 'correctRequest', ...extra });

const env = (known: readonly string[] = ['url', 'name'], secrets: readonly string[] = []) => ({ has: (id: string) => known.includes(id), scrub: scrubber(() => secrets), fallback: 'The change could not be applied.' });

describe('reading what the host said', () => {
  it('reads the envelope as a string, as an object, after Go\'s operation context, and from a RuntimeError', () => {
    const wanted = { type: 'omniview:validation', title: 'Invalid request', status: 400, detail: 'The URL is not reachable.' };
    for (const raw of [JSON.stringify(envelope()), envelope(), `settings commit failed: ${JSON.stringify(envelope())}`, { name: 'RuntimeError', message: JSON.stringify(envelope()) }, { name: 'RuntimeError', message: 'x', cause: envelope() }]) {
      expect(readHostError(raw)).toMatchObject(wanted);
    }
  });

  it('keeps the members the model uses and drops the rest', () => {
    const read = readHostError(envelope({ instance: 'url', suggestions: ['Check it.', 4], actions: [{ type: 'retry', label: 'Retry' }, { type: 'launch', label: 'Nope' }], location: { start: 1, end: 2, unit: 'utf8-byte' }, extra: 'x' }));
    expect(read).toMatchObject({ code: 'INVALID_REQUEST', requestId: 'req-1', recovery: 'correctRequest', instance: 'url' });
    expect(read?.suggestions).toEqual(['Check it.']);
    expect(read?.actions).toEqual([{ type: 'retry', label: 'Retry' }]);
    expect(read).not.toHaveProperty('extra');
  });

  it('reads a cause the host wrapped: "Title: detail"', () => {
    const nested = JSON.stringify(envelope({ title: 'Inner', detail: 'The cause.' }));
    expect(readHostError(envelope({ detail: nested }))?.detail).toBe('Inner: The cause.');
  });

  it('is nothing for what is not a complete envelope: an ordinary error, a text with no JSON, a status that is not one, too long a sentence', () => {
    for (const raw of [new Error('boom'), 'boom', 'a { b', null, undefined, 4, {}, envelope({ status: 99 }), envelope({ status: 'x' }), envelope({ detail: 'x'.repeat(5000) }), envelope({ type: '' }), envelope({ title: undefined })]) {
      expect(readHostError(raw)).toBeUndefined();
    }
  });

  it('is not troubled by an error that throws when it is read', () => {
    const hostile = new Proxy({}, { get: () => {
      throw new Error('no'); 
    } });
    expect(() => readHostError(hostile)).not.toThrow();
    expect(readHostError(hostile)).toBeUndefined();
  });
});

describe('what goes on the form', () => {
  it('is the host\'s title and sentence, its suggestions, its recovery, its request id and its code, as data', () => {
    const { form, cancelled } = mapHostError(envelope({ suggestions: ['Check the address.'] }), env());
    expect(cancelled).toBe(false);
    expect(form).toEqual({ kind: 'error', title: 'Invalid request', text: 'The URL is not reachable.', suggestions: ['Check the address.'], actions: [], recovery: 'correctRequest', requestId: 'req-1', code: 'INVALID_REQUEST' });
  });

  it('is cleaned and bounded, text by text: escapes and control characters out, the sentence at 400 characters, a title at 120, at most eight suggestions of 200', () => {
    const { form } = mapHostError(envelope({
      title: `\u001b[1m${'T'.repeat(240)}`,
      detail: `Line one\nline\u0000 two ${'x'.repeat(1000)}`,
      suggestions: Array.from({ length: 12 }, (_, index) => `Suggestion ${String(index)} ${'s'.repeat(400)}`),
    }), env());
    expect([...form.title].length).toBeLessThanOrEqual(120);
    expect(form.title).not.toContain('\u001b');
    expect([...form.text].length).toBeLessThanOrEqual(400);
    expect(form.text.startsWith('Line one line two xxx')).toBe(true);
    expect(form.suggestions).toHaveLength(8);
    expect(form.suggestions.every((line) => [...line].length <= 200)).toBe(true);
  });

  it('keeps an action only of the kinds the form can take, with a label and a target that is safe: a retry, a route inside the app, an https address, a text to copy', () => {
    const { form } = mapHostError(envelope({
      actions: [
        { type: 'retry', label: 'Retry' },
        { type: 'navigate', label: 'Open settings', target: '#/settings?category=network' },
        { type: 'navigate', label: 'Away', target: 'https://evil.example' },
        { type: 'open-url', label: 'Docs', target: 'https://docs.example/x' },
        { type: 'open-url', label: 'Script', target: 'javascript:alert(1)' },
        { type: 'copy', label: 'Copy', target: 'tool status --all' },
        { type: 'launch', label: 'Nope' },
        { type: 'retry' },
        { type: 'copy', label: 'Fifth' },
      ],
    }), env());
    expect(form.actions).toEqual([
      { type: 'retry', label: 'Retry' },
      { type: 'navigate', label: 'Open settings', target: '#/settings?category=network' },
      { type: 'open-url', label: 'Docs', target: 'https://docs.example/x' },
      { type: 'copy', label: 'Copy', target: 'tool status --all' },
    ]);
  });

  it('is a recovery from the list the host uses, or none', () => {
    expect(mapHostError(envelope({ recovery: 'restartQuery' }), env()).form.recovery).toBe('restartQuery');
    expect(mapHostError(envelope({ recovery: 'launch-missiles' }), env()).form.recovery).toBeUndefined();
  });

  it('is the generic sentence, never the raw message, for an error the host did not make; and nothing of it is kept', () => {
    const { form, fields } = mapHostError(new TypeError('x.y is not a function at /Users/ana/work/file.ts:12'), env());
    expect(form).toEqual({ kind: 'error', title: 'Could not save', text: 'The change could not be applied.', suggestions: [], actions: [] });
    expect(fields.size).toBe(0);
  });

  it('is a cancellation, and not an error, for what is one: an abort, a cancel, the host\'s cancelled type, the word "cancelled"', () => {
    for (const raw of [Object.assign(new Error('x'), { name: 'AbortError' }), { name: 'CancelError' }, envelope({ type: 'omniview:cancelled', status: 499, title: 'Cancelled', detail: 'The operation was cancelled.' }), 'cancelled']) {
      expect(mapHostError(raw, env()).cancelled).toBe(true);
    }
  });
});

describe('what goes on a field', () => {
  it('is what a `fields` member says, as a list or as a map, for the fields the form has', () => {
    const list = mapHostError(envelope({ fields: [{ field: 'url', message: 'Not reachable.' }, { id: 'name', reason: 'Taken.' }, { name: 'zzz', message: 'Unknown.' }] }), env());
    expect([...list.fields]).toEqual([['url', { text: 'Not reachable.', code: 'rejected' }], ['name', { text: 'Taken.', code: 'rejected' }]]);
    const map = mapHostError(envelope({ fields: { url: 'Not reachable.' } }), env());
    expect([...map.fields]).toEqual([['url', { text: 'Not reachable.', code: 'rejected' }]]);
  });

  it('puts what names a field the form does not have among the suggestions, so no reason is lost', () => {
    const { form, fields } = mapHostError(envelope({ fields: [{ field: 'zzz', message: 'Unknown.' }], suggestions: ['First.'] }), env());
    expect(fields.size).toBe(0);
    expect(form.suggestions).toEqual(['First.', 'zzz: Unknown.']);
  });

  it('is the sentence of the error for a validation error whose instance names a field, and only for a validation error', () => {
    const named = mapHostError(envelope({ instance: 'url' }), env());
    expect([...named.fields]).toEqual([['url', { text: 'The URL is not reachable.', code: 'rejected' }]]);
    const other = mapHostError(envelope({ type: 'omniview:plugin/not-found', status: 404, instance: 'url' }), env());
    expect(other.fields.size).toBe(0);
  });

  it('is bounded: a message at 80 characters with the full sentence as detail, at most 100 fields', () => {
    const long = `Not reachable. ${'Check the address. '.repeat(20)}`;
    const { fields } = mapHostError(envelope({ fields: { url: long } }), env());
    const entry = fields.get('url');
    expect([...(entry?.text ?? '')].length).toBeLessThanOrEqual(80);
    expect(entry?.detail?.startsWith('Not reachable. Check the address.')).toBe(true);
    const many = Object.fromEntries(Array.from({ length: 300 }, (_, index) => [`f${String(index)}`, 'Bad.']));
    expect(mapHostError(envelope({ fields: many }), env(Object.keys(many))).fields.size).toBeLessThanOrEqual(100);
  });

  it('is a code the model knows, when the host gave one', () => {
    const { fields } = mapHostError(envelope({ fields: [{ field: 'url', message: 'Bad.', code: 'url' }, { field: 'name', message: 'Bad.', code: 'launch-missiles' }] }), env());
    expect(fields.get('url')?.code).toBe('url');
    expect(fields.get('name')?.code).toBe('rejected');
  });
});

describe('a secret in what the host said', () => {
  const SECRET = 'sk-live-SENTINEL-9f8e7d6c5b4a3210';

  it('is replaced everywhere it appears: the title, the sentence, the suggestions, an action, a field\'s reason', () => {
    const raw = envelope({
      title: `Rejected ${SECRET}`,
      detail: `The token ${SECRET} is not valid.`,
      suggestions: [`Use another than ${SECRET}.`],
      actions: [{ type: 'copy', label: 'Copy', target: `curl -H "Authorization: ${SECRET}"` }],
      fields: [{ field: 'name', message: `Bad ${SECRET}` }],
    });
    const { form, fields } = mapHostError(raw, env(['name'], [SECRET]));
    expect(JSON.stringify(form)).not.toContain(SECRET);
    expect(JSON.stringify([...fields])).not.toContain(SECRET);
    expect(form.text).toBe('The token ••• is not valid.');
  });

  it('is replaced when the host wrapped it in JSON, and when a zero-width character splits it', () => {
    const wrapped = JSON.stringify(envelope({ detail: `Bad ${SECRET}` }));
    expect(mapHostError(wrapped, env([], [SECRET])).form.text).toBe('Bad •••');
    const split = `${SECRET.slice(0, 10)}\u200B${SECRET.slice(10)}`;
    expect(mapHostError(envelope({ detail: `Bad ${split}` }), env([], [SECRET])).form.text).toBe('Bad •••');
  });

  it('is not shown by the generic sentence either, though that never has the raw message', () => {
    const { form } = mapHostError(new Error(`bad ${SECRET}`), env([], [SECRET]));
    expect(JSON.stringify(form)).not.toContain(SECRET);
  });
});
