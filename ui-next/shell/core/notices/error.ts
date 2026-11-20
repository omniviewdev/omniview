import { isObject } from '../tabs/json';
import { line } from './text';
import { LIMITS, type ErrorContext, type HostError, type NoticeInput } from './types';

// The host's error as a notice (docs/ui-next/status/E0-1.md; decision R13: one parser and one describer, and the parser is the runtime's `parseAppError`, which this takes the answer of). The
// title is the class's, a short phrase the host owns ("Not found", "Timed out"); the detail is the sentence: the plugin's own when it wrote one (E0-1, B-02), else the host's class sentence.
// The classes whose text the host words itself (FORBIDDEN and UNAUTHORIZED, and INTERNAL and PROVIDER_ERROR, which the host's rule C02 treats the same: no arbitrary remote text in chrome,
// K14) keep it, whatever a caller or a plugin would put in its place. A cancellation is never a notice. What is not the host's complete envelope is a generic failure that shows none of what
// it said: raw text is never chrome. `recovery`, `actions` and `instance` are not read: P5 deletes them at the flip, and they name the old shell's router.

const GENERIC_TITLE = 'Operation failed';
const GENERIC_DETAIL = 'The operation could not be completed.';

/** The classes whose title and sentence are the host's own and are never replaced. */
const HOST_TEXT: readonly string[] = ['FORBIDDEN', 'UNAUTHORIZED', 'INTERNAL', 'PROVIDER_ERROR'];

/** The class a type names, for an envelope that carries no code. */
const CODE_OF_TYPE: Readonly<Record<string, string>> = Object.freeze({
  'omniview:resource/forbidden': 'FORBIDDEN',
  'omniview:resource/unauthorized': 'UNAUTHORIZED',
  'omniview:internal': 'INTERNAL',
  'omniview:resource/provider-error': 'PROVIDER_ERROR',
  'omniview:resource/partial': 'PARTIAL_RESULT',
  'omniview:cancelled': 'CANCELLED',
});

const text = (value: unknown, limit: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= limit;

/** The envelope, when it is the host's complete one: the same gate as the runtime's parser (a type, a title, a status of 100 to 599, a detail). */
function readEnvelope(value: unknown): HostError | undefined {
  if (!isObject(value) || Array.isArray(value)) {
    return undefined;
  }

  const { type, title, status, detail } = value;
  if (!text(type, 256) || !text(title, 256) || typeof status !== 'number' || !Number.isInteger(status) || status < 100 || status > 599 || typeof detail !== 'string' || detail.length > 4096) {
    return undefined;
  }

  return {
    type,
    title,
    status,
    detail,
    code: text(value.code, 64) ? value.code : undefined,
    requestId: text(value.requestId, 256) ? value.requestId : undefined,
    suggestions: Array.isArray(value.suggestions) ? value.suggestions.filter((item): item is string => text(item, 512)).slice(0, 8) : undefined,
  };
}

const caller = (context: ErrorContext): Pick<NoticeInput, 'initiator' | 'actions' | 'key' | 'group' | 'target' | 'origin'> => ({
  initiator: context.initiator ?? 'user',
  actions: context.actions,
  key: context.key,
  group: context.group,
  target: context.target,
  origin: context.origin,
});

/**
 * `parseAppError(error)` as a notice: `undefined` for a cancellation, a generic failure for what is not the host's envelope, else an error (a warning for a partial result) whose title is the
 * class's and whose detail is the sentence. What a caller writes in its own words (`title`, `detail`) replaces them, except for the classes whose text is the host's. The diagnostics (behind a
 * disclosure and an explicit Copy) carry the class code and the request id for a person who has to ask for help, the whole sentence when the line had to cut it, and the host's suggestions.
 */
export function noticeFromHostError(error: unknown, context: ErrorContext = {}): NoticeInput | undefined {
  const envelope = readEnvelope(error);
  if (envelope === undefined) {
    return { severity: 'error', title: line(context.title, LIMITS.title) || GENERIC_TITLE, detail: line(context.detail, LIMITS.detail) || GENERIC_DETAIL, ...caller(context) };
  }

  const code = envelope.code ?? CODE_OF_TYPE[envelope.type] ?? '';
  if (code === 'CANCELLED' || envelope.type === 'omniview:cancelled') {
    return undefined;
  }

  const hostWords = HOST_TEXT.includes(code) || HOST_TEXT.includes(CODE_OF_TYPE[envelope.type] ?? '');
  const classTitle = envelope.title === 'Error' ? GENERIC_TITLE : envelope.title;
  const title = line(hostWords ? classTitle : (context.title ?? classTitle), LIMITS.title) || GENERIC_TITLE;
  const sentence = line(hostWords ? envelope.detail : (context.detail ?? envelope.detail), 4096);
  const diagnostics = [
    sentence.length > LIMITS.detail ? sentence : '',
    envelope.code === undefined ? '' : `Code: ${envelope.code}`,
    envelope.requestId === undefined ? '' : `Request: ${envelope.requestId}`,
    ...(envelope.suggestions ?? []).map((suggestion) => `• ${line(suggestion, 512)}`),
  ].filter((part) => part !== '');

  return {
    severity: code === 'PARTIAL_RESULT' ? 'warning' : 'error',
    title,
    detail: line(sentence, LIMITS.detail),
    details: diagnostics.length === 0 ? undefined : diagnostics.join('\n'),
    ...caller(context),
  };
}
