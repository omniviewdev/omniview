import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { copyToClipboard } from './clipboard';

// Putting text on the clipboard from a button (the Logs toolbar's Copy). The browser's asynchronous clipboard first; where it is missing or refuses (no permission, an insecure context, an engine that wants the
// call to be the user's gesture in the same turn) the route the mock takes too (shell-panel.js 1430-1443): a readonly textarea that is selected and copied with the document's command, which is removed again.
// A failure is `false`, never a throw: the caller tells the person.

type Command = (name: string) => boolean;
const original = Object.getOwnPropertyDescriptor(Document.prototype, 'execCommand');

function clipboard(writeText: ((text: string) => Promise<unknown>) | undefined): void {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: writeText === undefined ? undefined : { writeText } });
}

function command(run: Command): Mock<Command> {
  const spy = vi.fn<Command>(run);
  Object.defineProperty(document, 'execCommand', { configurable: true, value: spy });
  return spy;
}

beforeEach(() => {
  document.body.replaceChildren();
});

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard');
  Reflect.deleteProperty(document, 'execCommand');
  if (original !== undefined) {
    Object.defineProperty(Document.prototype, 'execCommand', original);
  }
});

describe('copyToClipboard', () => {
  it('writes the text with the asynchronous clipboard and says it did', async () => {
    const writeText = vi.fn(async () => undefined);
    clipboard(writeText);
    const exec = command(() => true);
    await expect(copyToClipboard('a\nb')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('a\nb');
    expect(exec).not.toHaveBeenCalled();
  });

  it('copies the text in the selected textarea when the asynchronous clipboard refuses, and takes the textarea away', async () => {
    clipboard(async () => {
      throw new Error('NotAllowedError');
    });
    let seen = '';
    const exec = command((name) => {
      const area = document.querySelector('textarea');
      seen = `${name}|${area?.value ?? ''}|${String(area?.readOnly)}|${area?.selectionStart ?? -1}-${area?.selectionEnd ?? -1}`;
      return true;
    });
    await expect(copyToClipboard('  a\n\tb')).resolves.toBe(true);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(seen).toBe('copy|  a\n\tb|true|0-6');
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('takes the same route where there is no asynchronous clipboard at all', async () => {
    clipboard(undefined);
    const exec = command(() => true);
    await expect(copyToClipboard('x')).resolves.toBe(true);
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('gives the focus back to what had it: the control that asked, not the page', async () => {
    clipboard(undefined);
    command(() => true);
    const button = document.createElement('button');
    document.body.append(button);
    button.focus();
    await copyToClipboard('x');
    expect(document.activeElement).toBe(button);
  });

  it('says it did not when the command says no, and when it throws, and leaves no textarea', async () => {
    clipboard(async () => {
      throw new Error('no');
    });
    command(() => false);
    await expect(copyToClipboard('x')).resolves.toBe(false);
    command(() => {
      throw new Error('no');
    });
    await expect(copyToClipboard('x')).resolves.toBe(false);
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('says it did not when there is no way at all: a document without the command', async () => {
    clipboard(undefined);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: undefined });
    await expect(copyToClipboard('x')).resolves.toBe(false);
  });

  it('is a promise that never rejects, whatever the clipboard does', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: () => {
          throw new TypeError('synchronous');
        },
      },
    });
    command(() => false);
    await expect(copyToClipboard('x')).resolves.toBe(false);
  });
});
