import type { TerminalFeedCause, TerminalFeedHandle, TerminalFeedSnapshot } from './feed';
import { createHeldOutput } from './heldOutput';

/** A window-authenticated read waits for bytes or a terminal state. No stdout, error or attachment is broadcast. */
export type ResourceShellFrame = { readonly data: string; readonly state: 'running' | 'ended' | 'failed' | 'detached' };
export type ResourceShellTransport = {
  readonly create: (owner: string, encoded: string) => PromiseLike<{ readonly id: string; readonly attachment: string; readonly replay: string }>;
  readonly read: (id: string, attachment: string, signal: AbortSignal) => PromiseLike<ResourceShellFrame>;
  readonly check: (id: string, attachment: string, encodedRoot: string, signal: AbortSignal) => PromiseLike<boolean>;
  readonly write: (id: string, attachment: string, data: string) => PromiseLike<void>;
  readonly resize: (id: string, attachment: string, rows: number, cols: number) => PromiseLike<void>;
  readonly close: (id: string, attachment: string) => PromiseLike<void>;
};
export type ResourceShellLaunch = {
  readonly feed: TerminalFeedHandle; readonly ready: Promise<void>; readonly verify: (signal?: AbortSignal, encodedRoot?: string) => Promise<boolean>;
};
const LIMIT = 2 * 1024 * 1024;
const HIGH_WATER = 128 * 1024;
const MAX_OUTPUT_FRAMES = 1024;
const WRITE_CHUNK = 32 * 1024;
const MAX_INPUT_FRAMES = 8192;
const EMPTY = { chunks: [], bytes: 0 } as const;
function decoded(data: string): Uint8Array {
  if (typeof data !== 'string' || data.length > Math.ceil(LIMIT / 3) * 4) {
    throw new Error('Invalid shell output');
  }

  const str = atob(data);
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = str.charCodeAt(i);
  }

  return bytes;
}

function encoded(data: Uint8Array): string {
  let text = '';
  for (let i = 0; i < data.length; i += 8192) {
    text += String.fromCharCode(...data.subarray(i, i + 8192));
  }

  return btoa(text);
}

/** The attachment never leaves this closure. A menu can ask if it is live, not use its I/O methods. */
export function openResourceShellFeed(native: ResourceShellTransport, owner: string, id: string, request: string): ResourceShellLaunch {
  const listeners = new Set<() => void>();
  const output = createHeldOutput(), input = createHeldOutput();
  const lifetime = new AbortController();
  let attachment: string | undefined, closing = false;
  let size: { cols: number; rows: number } | undefined;
  let reading = false, sending = false, resizing = false, inputFrames = 0, outputFrames = 0;
  let encoder: TextEncoder | undefined;
  let snapshot: TerminalFeedSnapshot = { state: 'starting' };
  const tell = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  function finish(next: TerminalFeedSnapshot, close: boolean) {
    if (lifetime.signal.aborted) {
      return;
    }

    closing = close; lifetime.abort();
    snapshot = next; input.clear(); size = undefined;
    const lease = attachment; attachment = undefined;
    tell(); // The reader can still drain the bounded output of a held or ended session.
    if (lease && close) {
      return native.close(id, lease);
    }
  }

  function fail(stage: TerminalFeedCause['stage'], message: string) {
    void Promise.resolve(finish({ state: 'failed', cause: { stage, message } }, true)).catch(() => undefined);
  }

  async function receive() {
    if (!attachment || reading) {
      return;
    }

    reading = true;
    try {
      while (attachment && output.bytes() < HIGH_WATER && outputFrames < MAX_OUTPUT_FRAMES) {
        const frame = await native.read(id, attachment, lifetime.signal);
        if (lifetime.signal.aborted) {
          return;
        }

        const bytes = decoded(frame.data);
        if (output.bytes() + bytes.length > LIMIT) {
          throw new Error('Shell output exceeded the buffer limit');
        }

        if (bytes.length) {
          const wake = output.bytes() === 0; output.push(bytes); outputFrames++; if (wake) {
            tell();
          }
        }

        switch (frame.state) {
          case 'ended': finish({ state: 'ended' }, false); return;
          case 'detached': finish({ state: 'ended', detached: { by: 'taken-over' } }, false); return;
          case 'failed': fail('session', 'The resource shell failed. Its output may be incomplete.'); return;
          case 'running':
            if (!bytes.length) {
              throw new Error('Empty live shell frame');
            }

            continue;
        }

        // Native frames can violate the transport type at runtime.
        throw new Error('Invalid shell frame');
      }
    } catch {
      if (!lifetime.signal.aborted) {
        fail('session', 'The connection to the resource shell was lost.');
      }
    } finally {
      reading = false;
    }
  }

  async function flush() {
    if (!attachment || sending) {
      return;
    }

    sending = true;
    try {
      while (attachment && input.bytes()) {
        const { chunks } = input.take(WRITE_CHUNK); inputFrames -= chunks.length;
        for (const bytes of chunks) {
          for (let i = 0; i < bytes.length; i += WRITE_CHUNK) {
            if (!attachment) {
              return;
            }

            await native.write(id, attachment, encoded(bytes.subarray(i, i + WRITE_CHUNK)));
          }
        }
      }
    } catch {
      fail('input', 'Input could not reach this resource shell.');
    } finally {
      sending = false;
    }
  }

  function write(bytes: Uint8Array) {
    if (lifetime.signal.aborted || !bytes.length) {
      return;
    }

    if (input.bytes() + bytes.length > LIMIT || ++inputFrames > MAX_INPUT_FRAMES) {
      fail('input', 'The resource shell could not receive this input.'); return;
    }

    input.push(bytes); void flush();
  }

  async function fit() {
    if (!attachment || resizing) {
      return;
    }

    resizing = true;
    try {
      while (attachment && size) {
        const { cols, rows } = size; size = undefined;
        await native.resize(id, attachment, rows, cols);
      }
    } catch {
      fail('session', 'The resource shell could not resize.');
    } finally {
      resizing = false;
    }
  }

  const feed: TerminalFeedHandle = {
    subscribe(listener) {
      listeners.add(listener); return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    read(max) {
      if (!output.bytes()) {
        return EMPTY;
      }

      const taken = output.take(max); outputFrames -= taken.chunks.length; void receive(); return taken;
    },
    ack() { /* Plugin exec has no byte-credit protocol; bounded reads resume when the renderer takes output. */ },
    write(text) {
      if (!lifetime.signal.aborted && text) {
        if (text.length > LIMIT) {
          fail('input', 'The resource shell could not receive this input.');
        } else {
          write((encoder ??= new TextEncoder()).encode(text));
        }
      }
    },
    writeBinary(bytes) {
      if (!lifetime.signal.aborted) {
        if (bytes.length > LIMIT) {
          fail('input', 'The resource shell could not receive this input.');
        } else {
          write(bytes.slice());
        }
      }
    },
    resize(cols, rows) {
      if (!lifetime.signal.aborted && Number.isInteger(cols) && Number.isInteger(rows) && cols > 0 && rows > 0 && cols <= 65535 && rows <= 65535) {
        size = { cols, rows }; void fit();
      }
    },
    async close() {
      await finish({ state: 'ended' }, true);
    },
  };
  const ready = (async () => {
    try {
      const reply = await native.create(owner, request);
      if (reply.id !== id || typeof reply.attachment !== 'string' || !reply.attachment || reply.attachment.length > 256) {
        throw new Error('Invalid attachment');
      }

      if (lifetime.signal.aborted) {
        if (closing) {
          await native.close(id, reply.attachment);
        }

        return;
      }

      attachment = reply.attachment;
      const replay = decoded(reply.replay);
      if (replay.length > LIMIT) {
        throw new Error('Invalid replay');
      }

      if (replay.length) {
        output.push(replay); outputFrames++;
      }

      snapshot = { state: 'running' }; tell(); void receive(); void flush(); void fit();
    } catch {
      fail('start', 'The resource shell could not start.');
    }
  })();
  const verify = async (signal = lifetime.signal, encodedRoot = '') => {
    const captured = attachment;
    if (!captured || signal.aborted) {
      return false;
    }

    try {
      return (await native.check(id, captured, encodedRoot, signal)) && !signal.aborted && attachment === captured;
    } catch {
      return false;
    }
  };

  return { feed, ready, verify };
}
