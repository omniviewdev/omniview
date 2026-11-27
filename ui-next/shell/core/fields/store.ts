import { equalJson, isObject, sameItems } from '../tabs/json';
import { checkValue, type Found } from './constraints';
import { mapHostError } from './errors';
import { evaluate, whyNot, type Reader } from './expr';
import { createRunner } from './runner';
import type { CompiledField, CompiledNote, CompiledSchema } from './schema';
import { cleanText, clip, scrubber } from './text';
import {
  FORM_VERSION,
  LIMITS,
  TIMING,
  type CommitResult,
  type ErrorHook,
  type FieldMessage,
  type FieldSpecView,
  type FieldState,
  type FormClass,
  type FormIssue,
  type FormMode,
  type FormState,
  type FormStats,
  type Issue,
  type Json,
  type Lock,
  type Option,
  type OptionAnswer,
  type OptionProvider,
  type OptionsState,
  type PersistedForm,
  type RefusedReason,
  type RemoteResult,
  type RemoteValidator,
  type Scalar,
  type Scheduler,
  type SectionState,
  type SetResult,
  type SubmitFn,
  type SubmitOutcome,
  type SubmitPayload,
  type SubmitResult,
  type SubmitState,
  type Timing,
} from './types';
import { isScalar, readValue, sameValue, stringsOf, valueKey } from './values';

// The store: one immutable snapshot (a frozen, JSON-shaped `FormState`), `subscribe`, and the operations. It is the shape `useSyncExternalStore` wants and nothing in it knows React; the
// tab model's and the palette's stores are the pattern. Every field is one `FieldState` that keeps its identity while it does not change, so a row that draws it draws again only
// when it did. A change re-runs only what reads it: the field's own checks, the fields that must equal it, and the conditions that name it (`schema.readers`). Two models (A6):
// `apply-on-change` (a setting: a value applies the moment it is set, or committed on Enter or blur) and `explicit` (a record: a draft, `submit`, `revert`).

export type FormOptions = {
  readonly schema: CompiledSchema;
  /** Default `explicit`. */
  readonly mode?: FormMode | undefined;
  /** What the form sends: the fields that changed (default) or every field that is shown and can be edited. */
  readonly send?: 'changed' | 'all' | undefined;
  /** The applied values, by field id. A secret is never taken from here. */
  readonly initial?: Readonly<Record<string, Json>> | undefined;
  /** Which secrets are saved. */
  readonly presence?: Readonly<Record<string, boolean>> | undefined;
  /** A restored draft (`restoreDraft(...).values`); `null` clears a number or a choice. */
  readonly draft?: Readonly<Record<string, Json>> | undefined;
  /** The host's flags that conditions read (`developer`, `platform`). */
  readonly context?: Readonly<Record<string, Scalar>> | undefined;
  /** The ids the host says wait for a restart. */
  readonly pendingRestart?: readonly string[] | undefined;
  readonly submit: SubmitFn;
  /** Runs after an apply-on-change submission settles and the form has consumed its result. The owner may now replace the form. */
  readonly onApplySettled?: (() => void) | undefined;
  readonly validators?: Readonly<Record<string, RemoteValidator>> | undefined;
  readonly providers?: Readonly<Record<string, OptionProvider>> | undefined;
  readonly scheduler?: Scheduler | undefined;
  readonly timing?: Partial<Timing> | undefined;
  /** Where a live region is told something: a new error raised on commit, and an invalid submit (S127). */
  readonly announce?: ((text: string) => void) | undefined;
  /** Hears every failure of a listener or of the host's code: a cleaned copy, never the raw error. Default: the console. */
  readonly onError?: ErrorHook | undefined;
};

/** What a tab guards (S27): `dirty`, `save` (`saved`, or why not) and `discard`. */
export type DraftGuard = {
  readonly dirty: () => boolean;
  readonly save: () => Promise<'saved' | { readonly result: 'invalid' | 'failed'; readonly reason: string }>;
  readonly discard: () => void;
};

export type FormStore = {
  readonly getSnapshot: () => FormState;
  /** Called after every change of the snapshot, and never for an operation that changed nothing. Returns the function that stops it. */
  readonly subscribe: (listener: () => void) => () => void;
  readonly subscribeTo: <T>(select: (state: FormState) => T, listener: (value: T, previous: T) => void, equals?: (a: T, b: T) => boolean) => () => void;
  readonly field: (id: string) => FieldState | undefined;
  /** Sets a draft. In a form that applies on change a switch, a choice, a list (and a slider) apply at once: `commit` of the result says how it went. */
  readonly setValue: (id: string, value: unknown, options?: { readonly commit?: boolean | undefined }) => SetResult;
  /** The user left the field: it is touched, and committed. */
  readonly blur: (id: string) => Promise<CommitResult>;
  /** Enter or blur: tells the checks; in a form that applies on change, applies the value. */
  readonly commit: (id: string) => Promise<CommitResult>;
  /** Asks again what could not be done: a check that could not be made, a value the host could not apply. */
  readonly retry: (id: string) => Promise<CommitResult>;
  /** Puts a field (or all) back to the applied values (Escape). True when something was changed. */
  readonly revert: (id?: string) => boolean;
  /** The default (a secret: nothing). Applies at once in a form that applies on change. */
  readonly reset: (id: string) => SetResult;
  readonly submit: () => Promise<SubmitResult>;
  readonly draft: () => DraftGuard;
  readonly setContext: (patch: Readonly<Record<string, Scalar>>) => boolean;
  readonly setFieldLock: (id: string, lock: Lock | undefined) => boolean;
  readonly setFormLock: (lock: Lock | undefined) => boolean;
  /** Asks the field's provider for options: debounced, aborted when the query moves on. False when the field has no provider. */
  readonly queryOptions: (id: string, query: string, options?: { readonly immediate?: boolean | undefined }) => boolean;
  /** The host's applied values changed: a field the user did not touch follows, one with a draft keeps it. */
  readonly rebase: (values: Readonly<Record<string, Json>>, options?: { readonly presence?: Readonly<Record<string, boolean>> | undefined; readonly restarted?: boolean | undefined; readonly pendingRestart?: readonly string[] | undefined }) => boolean;
  /** What a page keeps of the draft: never a secret. */
  readonly serialise: () => PersistedForm;
  readonly stats: () => FormStats;
  /** Stops everything, aborts what runs, drops every secret and the listeners. */
  readonly dispose: () => void;
};

type CheckStatus = 'valid' | 'invalid' | 'unchecked' | 'stale';
type Remote = { status: 'idle' | 'checking' | 'valid' | 'invalid' | 'unreachable'; key: string; issue: Issue | undefined; note: string; detail: string; slow: boolean; text: string };
type Reason = { readonly text: string; readonly detail?: string | undefined };
type OptionsRec = { status: OptionsState['status']; query: string; rows: readonly Option[]; total: number | undefined; message: string | undefined; labels: Map<string, Option> };
type Gate = { readonly promise: Promise<CommitResult>; readonly resolve: (result: CommitResult) => void };

type Rec = {
  readonly spec: CompiledField;
  readonly view: FieldSpecView;
  value: Json | undefined;
  applied: Json | undefined;
  startup: Json | undefined;
  presence: boolean;
  changed: boolean;
  touched: boolean;
  edited: boolean;
  told: boolean;
  visible: boolean;
  sectionVisible: boolean;
  unmet: boolean;
  unmetReason: string;
  notes: readonly CompiledNote[];
  fieldLock: Lock | undefined;
  issues: readonly Found[];
  remote: Remote;
  waiters: Array<(status: CheckStatus) => void>;
  slowTimer: unknown;
  savedTimer: unknown;
  phase: 'idle' | 'applying' | 'saved' | 'failed';
  savedNote: string;
  failure: Reason | undefined;
  hostIssue: Issue | undefined;
  hostPending: boolean;
  inflight: boolean;
  next: Gate | undefined;
  options: OptionsRec | undefined;
  announced: string;
  state: FieldState;
};

type SectionRec = { readonly id: string; readonly spec: CompiledSchema['sections'][number]; visible: boolean; state: SectionState | undefined };

const RANK: Readonly<Record<FieldMessage['kind'], number>> = { error: 0, warning: 1, checking: 2, retry: 3, saved: 4, info: 5, restart: 5, hint: 6 };
const INPUTS: ReadonlySet<string> = new Set(['text', 'number', 'path', 'url', 'color', 'secret', 'select']);
const NO_ISSUES: readonly Issue[] = Object.freeze([]);
const GENERIC = 'The change could not be applied.';

const platformScheduler: Scheduler = {
  now: () => globalThis.performance.now(),
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => {
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
  },
};

const logError: ErrorHook = (error, where) => {
  console.error(`[fields] ${where}`, error);
};

const compact = <T extends Record<string, unknown>>(object: T): T => Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined)) as T;

const refused = (reason: RefusedReason): { readonly status: 'refused'; readonly reason: RefusedReason } => ({ status: 'refused', reason });

function viewOf(spec: CompiledField): FieldSpecView {
  const c = spec.constraints;
  return Object.freeze(compact({
    unit: spec.unit,
    min: c.min,
    max: c.max,
    step: c.step,
    integer: c.integer,
    maxLength: c.maxLength,
    pathKind: spec.kind === 'path' ? c.pathKind : undefined,
    extensions: c.extensions,
    item: spec.kind === 'list' ? c.item : undefined,
    display: spec.display,
    mono: spec.mono,
    remote: spec.validate !== undefined,
  }));
}

export function createFormStore(options: FormOptions): FormStore {
  const { schema } = options;
  const mode: FormMode = options.mode ?? 'explicit';
  const send = options.send ?? 'changed';
  const scheduler = options.scheduler ?? platformScheduler;
  const timing: Timing = { ...TIMING, ...options.timing };
  const hook = options.onError ?? logError;
  const vault = new Map<string, Json>();
  const inflightSecrets = new Map<number, readonly string[]>();
  const context = new Map<string, Json>(Object.entries(options.context ?? {}));
  const listeners = new Set<() => void>();
  const marked = new Set<Rec>();
  const counters = { conditions: 0, validations: 0, remote: 0, built: 0, notified: 0 };
  let isDisposed = false;
  let formLock: Lock | undefined;
  let submitState: SubmitState = Object.freeze({ status: 'idle', attempted: false, attempts: 0 });
  let formIssues: readonly FormIssue[] = Object.freeze([]);
  let isFormChanged = false;
  let token = 0;
  let inflightSubmit: Promise<SubmitResult> | undefined;
  let controller: AbortController | undefined;

  const scrub = scrubber(function* secrets() {
    yield* [...vault.values()].flatMap((value) => stringsOf(value));
    for (const list of inflightSecrets.values()) {
      yield* list;
    }
  });

  const report = (error: unknown, where: string): void => {
    const name = isObject(error) && typeof error.name === 'string' ? cleanText(error.name, 64) : 'Error';
    const message = isObject(error) && typeof error.message === 'string' ? clip(scrub(cleanText(scrub(error.message), 4096)), 400) : '';
    try {
      hook({ name: name === '' ? 'Error' : name, message }, where);
    } catch {
      // A hook that throws cannot be reported to itself.
    }
  };

  const runner = createRunner({ scheduler, onError: (error) => {
    report(error, 'runner'); 
  } });
  const clean = (text: unknown, max: number): string => (typeof text === 'string' ? clip(scrub(cleanText(scrub(text), 4096)), max) : '');

  // ------------------------------------------------------------------------------------------------------------------------------- records

  const recs = new Map<string, Rec>();
  const list: Rec[] = [];
  const sections = new Map<string, SectionRec>();
  const hostPending = new Set(options.pendingRestart ?? []);
  const secretHas = (rec: Rec): boolean => (vault.has(rec.spec.id) ? !(vault.get(rec.spec.id) === '' || vault.get(rec.spec.id) === undefined) : rec.presence);

  const makeRec = (spec: CompiledField): Rec => {
    const given = options.initial !== undefined && Object.hasOwn(options.initial, spec.id) && !spec.sensitive && spec.kind !== 'unsupported' ? readValue(spec.kind, options.initial[spec.id], false) : undefined;
    const applied = spec.sensitive || spec.kind === 'unsupported' ? undefined : given?.ok === true ? given.value : spec.default;
    const rec: Rec = {
      spec,
      view: viewOf(spec),
      value: applied,
      applied,
      startup: applied,
      presence: spec.sensitive && options.presence?.[spec.id] === true,
      changed: false,
      touched: false,
      edited: false,
      told: false,
      visible: true,
      sectionVisible: true,
      unmet: false,
      unmetReason: '',
      notes: [],
      fieldLock: undefined,
      issues: [],
      remote: { status: 'idle', key: '', issue: undefined, note: '', detail: '', slow: false, text: '' },
      waiters: [],
      slowTimer: undefined,
      savedTimer: undefined,
      phase: 'idle',
      savedNote: '',
      failure: undefined,
      hostIssue: undefined,
      hostPending: hostPending.has(spec.id),
      inflight: false,
      next: undefined,
      options: spec.provider === undefined ? undefined : { status: 'idle', query: '', rows: [], total: undefined, message: undefined, labels: new Map() },
      announced: '',
      state: undefined as unknown as FieldState,
    };
    return rec;
  };

  for (const spec of schema.fields) {
    const rec = makeRec(spec);
    recs.set(spec.id, rec);
    list.push(rec);
  }

  for (const section of schema.sections) {
    sections.set(section.id, { id: section.id, spec: section, visible: true, state: undefined });
  }

  // ------------------------------------------------------------------------------------------------------------------------------- reading

  /** What conditions read: the applied value in a form that applies on change (the applied value stays in effect), the draft otherwise. A secret is only ever empty or not. */
  const reader: Reader = {
    value: (id) => {
      const rec = recs.get(id);
      return rec === undefined || rec.spec.sensitive ? undefined : mode === 'apply-on-change' ? rec.applied : rec.value;
    },
    empty: (id) => {
      const rec = recs.get(id);
      if (rec === undefined) {
        return true;
      }

      if (rec.spec.sensitive) {
        return !secretHas(rec);
      }

      const value = mode === 'apply-on-change' ? rec.applied : rec.value;
      return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
    },
    ctx: (key) => context.get(key),
  };

  const otherOf = (rec: Rec): Json | undefined => {
    const other = rec.spec.constraints.sameAs === undefined ? undefined : recs.get(rec.spec.constraints.sameAs);
    return other === undefined ? undefined : other.spec.sensitive ? vault.get(other.spec.id) : other.value;
  };

  const recheck = (rec: Rec): void => {
    counters.validations += 1;
    const value = rec.spec.sensitive ? (rec.changed || vault.has(rec.spec.id) ? vault.get(rec.spec.id) : undefined) : rec.value;
    rec.issues = rec.spec.sensitive && !rec.changed && rec.presence ? [] : checkValue(rec.spec, value, otherOf(rec));
  };

  const isEditable = (rec: Rec): boolean => rec.spec.kind !== 'unsupported' && rec.visible && rec.sectionVisible && lockOf(rec) === undefined && !rec.spec.readonly;

  function lockOf(rec: Rec): Lock | undefined {
    if (formLock !== undefined) {
      return formLock;
    }

    if (rec.fieldLock !== undefined) {
      return rec.fieldLock;
    }

    return rec.unmet ? Object.freeze({ reason: rec.unmetReason === '' ? 'Not available right now.' : rec.unmetReason, source: 'condition' as const, readonly: false }) : undefined;
  }

  const isDirty = (rec: Rec): boolean => (rec.spec.sensitive ? rec.changed : !sameValue(rec.value, rec.applied));
  const isPendingRestart = (rec: Rec): boolean => rec.hostPending || (rec.spec.restart !== 'none' && !sameValue(rec.applied, rec.startup));

  const toldIssues = (rec: Rec): readonly Issue[] => {
    if (rec.spec.kind === 'unsupported' || !rec.visible || !rec.sectionVisible || lockOf(rec) !== undefined || rec.spec.readonly) {
      return NO_ISSUES;
    }

    const attempted = submitState.attempted;
    const told: Issue[] = rec.issues
      .filter((issue) => issue.when === 'now' || (issue.when === 'complete' && (rec.told || attempted)) || (issue.when === 'required' && (attempted || (rec.edited && rec.told))))
      .map(({ when: _when, ...issue }) => Object.freeze(issue));
    if (rec.remote.status === 'invalid' && rec.remote.issue !== undefined) {
      told.push(rec.remote.issue);
    }

    if (rec.hostIssue !== undefined) {
      told.push(rec.hostIssue);
    }

    return told.length === 0 ? NO_ISSUES : Object.freeze(told);
  };

  function messageOf(rec: Rec, lock: Lock | undefined, told: readonly Issue[]): FieldMessage | undefined {
    const disabled = lock !== undefined && !lock.readonly;
    let primary: FieldMessage | undefined;
    if (!disabled) {
      const first = told[0];
      if (rec.phase === 'failed' && rec.failure !== undefined) {
        primary = compact({ kind: 'error' as const, text: clip(rec.failure.text, LIMITS.message), detail: rec.failure.detail, retry: true });
      } else if (first !== undefined) {
        primary = compact({ kind: 'error' as const, text: first.text, code: first.code, detail: first.detail });
      } else if (rec.remote.status === 'unreachable') {
        primary = compact({ kind: 'retry' as const, text: 'Couldn’t check. Try again.', detail: rec.remote.detail === '' ? undefined : rec.remote.detail, retry: true });
      } else if (rec.remote.status === 'checking') {
        primary = { kind: 'checking', text: rec.remote.text, slow: rec.remote.slow };
      } else if (rec.phase === 'saved') {
        primary = { kind: 'saved', text: rec.savedNote === '' ? 'Saved.' : `Saved. ${rec.savedNote}` };
      } else {
        const warning = rec.notes.find((note) => note.kind === 'warning');
        const info = rec.notes.find((note) => note.kind === 'info');
        if (warning !== undefined) {
          primary = { kind: 'warning', text: clip(warning.text, LIMITS.message) };
        } else if (info !== undefined) {
          primary = { kind: 'info', text: clip(info.text, LIMITS.message) };
        } else if (rec.remote.status === 'valid' && rec.remote.note !== '') {
          primary = { kind: 'info', text: rec.remote.note };
        } else if (rec.spec.hint !== '') {
          primary = { kind: 'hint', text: rec.spec.hint };
        }
      }
    }

    const candidates: Array<FieldMessage | undefined> = [
      primary,
      lock === undefined ? undefined : { kind: 'info', text: clip(lock.reason, LIMITS.message) },
      isPendingRestart(rec) ? { kind: 'restart', text: 'Restart required to apply.' } : undefined,
    ];
    let best: FieldMessage | undefined;
    for (const candidate of candidates) {
      if (candidate !== undefined && (best === undefined || RANK[candidate.kind] < RANK[best.kind])) {
        best = candidate;
      }
    }

    return best;
  }

  function selectedOf(rec: Rec): readonly Option[] | undefined {
    if (rec.options === undefined || rec.value === undefined || rec.value === null) {
      return undefined;
    }

    const values = Array.isArray(rec.value) ? rec.value : [rec.value];
    return Object.freeze(values.filter(isScalar).map((value) => rec.options?.labels.get(valueKey(value)) ?? Object.freeze({ value, label: String(value) })));
  }

  function build(rec: Rec): FieldState {
    counters.built += 1;
    const { spec } = rec;
    const sensitive = spec.sensitive;
    const unsupported = spec.kind === 'unsupported';
    const lock = unsupported ? undefined : lockOf(rec);
    const told = toldIssues(rec);
    const isVisible = rec.visible && rec.sectionVisible;
    const common = {
      id: spec.id,
      kind: spec.kind,
      label: spec.label,
      help: spec.help,
      placeholder: spec.placeholder,
      section: spec.section,
      spec: rec.view,
      visible: isVisible,
      enabled: unsupported || lock === undefined || lock.readonly,
      readonly: unsupported || spec.readonly || lock?.readonly === true,
      lock,
      required: spec.required,
      sensitive,
      dirty: unsupported ? false : isDirty(rec),
      touched: rec.touched,
      edited: rec.edited,
      busy: rec.inflight || rec.remote.status === 'checking' || rec.phase === 'applying',
      restart: spec.restart,
      pendingRestart: !unsupported && isPendingRestart(rec),
    };
    if (unsupported) {
      return Object.freeze(compact({
        ...common,
        modified: false,
        message: Object.freeze({ kind: 'info' as const, text: 'Not supported in this version.' }),
        issues: NO_ISSUES,
        validation: 'idle' as const,
        unsupported: Object.freeze({ kind: spec.rawKind, text: 'Not supported in this version.' }),
      }));
    }

    const choosing = spec.kind === 'select' || spec.kind === 'multiselect';
    const optionsState = rec.options === undefined ? undefined : Object.freeze(compact({ status: rec.options.status, query: rec.options.query, total: rec.options.total, message: rec.options.message }));
    const message = messageOf(rec, lock, told);
    return Object.freeze(compact({
      ...common,
      value: sensitive ? undefined : rec.value,
      default: sensitive ? undefined : spec.default,
      secret: sensitive ? Object.freeze({ presence: rec.presence ? ('set' as const) : ('unset' as const), changed: rec.changed }) : undefined,
      modified: sensitive ? secretHas(rec) : lock?.source !== 'environment' && lock?.source !== 'managed' && !sameValue(rec.value, spec.default),
      options: choosing ? (rec.options === undefined ? spec.options : Object.freeze([...rec.options.rows])) : undefined,
      optionsState,
      selected: selectedOf(rec),
      message: message === undefined ? undefined : Object.freeze(message),
      issues: told,
      validation: sensitive ? ('idle' as const) : rec.remote.status,
    }));
  }

  // ------------------------------------------------------------------------------------------------------------------------------- the snapshot

  let snapshot: FormState;
  let fieldsOf: readonly FieldState[] = Object.freeze([]);

  const mark = (rec: Rec): void => {
    marked.add(rec);
  };

  function classOf(): FormClass {
    let inputs = 0;
    for (const rec of list) {
      if (rec.spec.kind === 'unsupported' || !rec.visible || !rec.sectionVisible) {
        continue;
      }

      if (!INPUTS.has(rec.spec.kind)) {
        return 'complex';
      }

      inputs += 1;
    }

    return inputs > 3 ? 'complex' : 'simple';
  }

  function sectionsOf(): readonly SectionState[] {
    const out: SectionState[] = [];
    for (const section of sections.values()) {
      const members = section.spec.fields.map((field) => recs.get(field.id)).filter((rec): rec is Rec => rec !== undefined);
      const ids = Object.freeze(section.spec.fields.map((field) => field.id));
      const next: SectionState = Object.freeze({
        id: section.id,
        label: section.spec.label,
        help: section.spec.help,
        collapsed: section.spec.collapsed,
        visible: section.visible,
        fields: sameItems(section.state?.fields, ids),
        invalid: members.filter((rec) => rec.state.visible && rec.state.issues.length > 0).length,
        dirty: members.filter((rec) => rec.state.dirty).length,
      });
      section.state = section.state !== undefined && equalJson(section.state, next) ? section.state : next;
      out.push(section.state);
    }

    return Object.freeze(out);
  }

  function compose(previous: FormState | undefined): FormState {
    const states = list.map((rec) => rec.state);
    const nextFields = previous !== undefined && states.every((state, at) => state === previous.fields[at]) ? previous.fields : Object.freeze(states);
    const ids = (pick: (rec: Rec) => boolean): readonly string[] => Object.freeze(list.filter(pick).map((rec) => rec.spec.id));
    const dirtyIds = sameItems(previous?.dirtyIds, ids((rec) => rec.state.dirty));
    const invalidIds = sameItems(previous?.invalidIds, ids((rec) => rec.state.visible && rec.state.issues.length > 0));
    const pendingIds = sameItems(previous?.pendingIds, ids((rec) => rec.state.validation === 'checking'));
    const pendingRestart = sameItems(previous?.pendingRestart, ids((rec) => rec.state.pendingRestart));
    const formClass = classOf();
    const missing = list.find((rec) => rec.spec.required && rec.state.visible && rec.state.enabled && !rec.state.readonly && rec.state.issues.length === 0 && rec.issues.some((issue) => issue.code === 'required'));
    let canSubmit = false;
    let blocked = '';
    if (mode === 'explicit') {
      if (submitState.status === 'submitting') {
        blocked = 'Working…';
      } else if (formLock !== undefined && !formLock.readonly) {
        blocked = formLock.reason;
      } else if (send === 'changed' && dirtyIds.length === 0) {
        blocked = 'No changes to apply.';
      } else if (formClass === 'simple' && missing !== undefined) {
        blocked = `${missing.spec.label} is required.`;
      } else {
        canSubmit = true;
      }
    }

    const wantsFocus = submitState.attempted || submitState.status === 'failed';
    const next: FormState = Object.freeze({
      version: FORM_VERSION,
      mode,
      schema: Object.freeze({ id: schema.id, version: schema.version }),
      fields: nextFields,
      sections: sectionsOf(),
      dirty: dirtyIds.length > 0,
      dirtyIds,
      invalidIds,
      pendingIds,
      pendingRestart,
      class: formClass,
      canSubmit,
      submitBlocked: blocked,
      firstInvalid: wantsFocus ? (invalidIds[0] ?? '') : '',
      submit: submitState,
      issues: formIssues,
      lock: formLock,
    });
    if (previous === undefined) {
      return next;
    }

    const sameSections = previous.sections.length === next.sections.length && previous.sections.every((section, at) => section === next.sections[at]);
    const unchanged = previous.fields === next.fields && sameSections && previous.dirtyIds === next.dirtyIds && previous.invalidIds === next.invalidIds && previous.pendingIds === next.pendingIds
      && previous.pendingRestart === next.pendingRestart && previous.class === next.class && previous.canSubmit === next.canSubmit && previous.submitBlocked === next.submitBlocked
      && previous.firstInvalid === next.firstInvalid && previous.submit === next.submit && previous.issues === next.issues && previous.lock === next.lock;
    return unchanged ? previous : Object.freeze({ ...next, sections: sameSections ? previous.sections : next.sections });
  }

  function notify(): void {
    for (const listener of [...listeners]) {
      counters.notified += 1;
      try {
        listener();
      } catch (error) {
        report(error, 'listener');
      }
    }
  }

  /** Builds what changed and tells the listeners once: never for an operation that changed nothing. */
  function flush(): void {
    if (marked.size === 0 && !isFormChanged) {
      return;
    }

    for (const rec of marked) {
      const next = build(rec);
      if (rec.state === undefined || !equalJson(rec.state as unknown as Json, next as unknown as Json)) {
        rec.state = next;
      }
    }

    marked.clear();
    isFormChanged = false;
    const next = compose(snapshot);
    if (next !== snapshot) {
      snapshot = next;
      fieldsOf = next.fields;
      notify();
    }
  }

  // ------------------------------------------------------------------------------------------------------------------------------- conditions

  const clearSecret = (rec: Rec): boolean => {
    const had = vault.delete(rec.spec.id) || rec.changed;
    rec.changed = false;
    return had;
  };

  function evaluateNotes(rec: Rec): readonly CompiledNote[] {
    return rec.spec.notes.filter((note) => {
      counters.conditions += 1;
      return evaluate(note.when, reader);
    });
  }

  /** Re-runs the conditions that read what changed, and only those; a secret that is hidden is dropped, which may change what reads it, a few rounds at most. */
  function propagate(fieldIds: readonly string[], ctxKeys: readonly string[]): void {
    let ids = fieldIds;
    let keys = ctxKeys;
    for (let round = 0; round < LIMITS.rounds && (ids.length > 0 || keys.length > 0); round += 1) {
      const targets = new Map<string, { readonly target: string; readonly slot: string }>();
      for (const id of ids) {
        for (const read of schema.readers.get(id) ?? []) {
          targets.set(`${read.slot}|${read.target}`, read);
        }
      }

      for (const key of keys) {
        for (const read of schema.ctxReaders.get(key) ?? []) {
          targets.set(`${read.slot}|${read.target}`, read);
        }
      }

      ids = [];
      keys = [];
      for (const { target, slot } of targets.values()) {
        const cleared = slot === 'section' ? updateSection(target) : updateField(target, slot);
        ids = [...ids, ...cleared];
      }
    }
  }

  function updateSection(id: string): readonly string[] {
    const section = sections.get(id);
    if (section?.spec.visible === undefined) {
      return [];
    }

    counters.conditions += 1;
    const visible = evaluate(section.spec.visible, reader);
    if (visible === section.visible) {
      return [];
    }

    section.visible = visible;
    const cleared: string[] = [];
    for (const field of section.spec.fields) {
      const rec = recs.get(field.id);
      if (rec !== undefined) {
        rec.sectionVisible = visible;
        mark(rec);
        if (!visible && rec.spec.sensitive && clearSecret(rec)) {
          cleared.push(rec.spec.id);
        }
      }
    }

    isFormChanged = true;
    return cleared;
  }

  function updateField(id: string, slot: string): readonly string[] {
    const rec = recs.get(id);
    if (rec === undefined) {
      return [];
    }

    if (slot === 'visible' && rec.spec.visible !== undefined) {
      counters.conditions += 1;
      const visible = evaluate(rec.spec.visible, reader);
      if (visible !== rec.visible) {
        rec.visible = visible;
        mark(rec);
        if (!visible && rec.spec.sensitive && clearSecret(rec)) {
          recheck(rec);
          return [id];
        }
      }
    } else if (slot === 'enabled' && rec.spec.enabled !== undefined) {
      counters.conditions += 1;
      const ok = evaluate(rec.spec.enabled, reader);
      const reason = ok ? '' : whyNot(rec.spec.enabled, reader);
      if (ok === rec.unmet || reason !== rec.unmetReason) {
        rec.unmet = !ok;
        rec.unmetReason = reason;
        mark(rec);
      }
    } else if (slot === 'notes') {
      const active = evaluateNotes(rec);
      if (active.length !== rec.notes.length || active.some((note, at) => note !== rec.notes[at])) {
        rec.notes = active;
        mark(rec);
      }
    }

    return [];
  }

  const startConditions = (): void => {
    for (const section of sections.values()) {
      if (section.spec.visible !== undefined) {
        counters.conditions += 1;
        section.visible = evaluate(section.spec.visible, reader);
      }
    }

    for (const rec of list) {
      rec.sectionVisible = sections.get(rec.spec.section)?.visible ?? true;
      if (rec.spec.visible !== undefined) {
        counters.conditions += 1;
        rec.visible = evaluate(rec.spec.visible, reader);
      }

      if (rec.spec.enabled !== undefined) {
        counters.conditions += 1;
        rec.unmet = !evaluate(rec.spec.enabled, reader);
        rec.unmetReason = rec.unmet ? whyNot(rec.spec.enabled, reader) : '';
      }

      rec.notes = evaluateNotes(rec);
    }
  };

  // ------------------------------------------------------------------------------------------------------------------------------- remote checks

  const visibleValues = (): Readonly<Record<string, Json>> => Object.freeze(Object.fromEntries(list.filter((rec) => rec.visible && rec.sectionVisible && !rec.spec.sensitive && rec.spec.kind !== 'unsupported' && rec.value !== undefined).map((rec) => [rec.spec.id, rec.value as Json])));

  const settle = (rec: Rec, status: CheckStatus): void => {
    const waiting = rec.waiters;
    rec.waiters = [];
    for (const waiter of waiting) {
      waiter(status);
    }
  };

  function cancelCheck(rec: Rec): void {
    runner.cancel(`check:${rec.spec.id}`);
    scheduler.clearTimeout(rec.slowTimer);
    rec.slowTimer = undefined;
    if (rec.remote.status !== 'idle') {
      rec.remote = { status: 'idle', key: '', issue: undefined, note: '', detail: '', slow: false, text: '' };
      mark(rec);
    }

    settle(rec, 'stale');
  }

  const resultOf = (value: unknown): RemoteResult | undefined => (isObject(value) && typeof value.valid === 'boolean' ? (value as RemoteResult) : undefined);

  async function check(rec: Rec, immediate: boolean, force: boolean): Promise<CheckStatus> {
    const remote = rec.spec.validate;
    if (remote === undefined || rec.spec.sensitive) {
      return Promise.resolve('valid');
    }

    const key = valueKey(rec.value);
    if (!force && rec.remote.key === key && (rec.remote.status === 'valid' || rec.remote.status === 'invalid')) {
      return Promise.resolve(rec.remote.status);
    }

    const pending = new Promise<CheckStatus>((resolve) => {
      rec.waiters.push(resolve);
    });
    if (!force && rec.remote.key === key && rec.remote.status === 'checking') {
      return pending;
    }

    const validator = options.validators !== undefined && Object.hasOwn(options.validators, remote.remote) ? options.validators[remote.remote] : undefined;
    const run = rec.value;
    const unreachable = (detail: string): void => {
      scheduler.clearTimeout(rec.slowTimer);
      rec.remote = { status: 'unreachable', key, issue: undefined, note: '', detail, slow: false, text: '' };
      mark(rec);
      settle(rec, 'unchecked');
    };

    if (validator === undefined) {
      unreachable('');
      flush();
      return pending;
    }

    runner.run(`check:${rec.spec.id}`, {
      delay: immediate ? 0 : remote.debounce,
      timeout: remote.timeout,
      started: () => {
        counters.remote += 1;
        rec.remote = { status: 'checking', key, issue: undefined, note: '', detail: '', slow: false, text: remote.checking === '' ? 'Checking…' : remote.checking };
        scheduler.clearTimeout(rec.slowTimer);
        rec.slowTimer = scheduler.setTimeout(() => {
          if (rec.remote.status === 'checking' && rec.remote.key === key) {
            rec.remote = { ...rec.remote, slow: true };
            mark(rec);
            flush();
          }
        }, timing.loader);
        mark(rec);
        flush();
      },
      work: async (signal) => validator({ id: rec.spec.id, value: (run ?? null), values: visibleValues(), signal }),
      done: (outcome) => {
        scheduler.clearTimeout(rec.slowTimer);
        const result = outcome.status === 'done' ? resultOf(outcome.value) : undefined;
        if (outcome.status === 'failed') {
          report(outcome.error, `check of ${rec.spec.id}`);
        }

        if (result === undefined || (!result.valid && result.retry === true)) {
          unreachable(result === undefined ? '' : clean(result.message, 400));
        } else if (result.valid) {
          rec.remote = { status: 'valid', key, issue: undefined, note: clip(clean(result.message, 400), LIMITS.message), detail: '', slow: false, text: '' };
          mark(rec);
          settle(rec, 'valid');
        } else {
          const full = clean(result.message, 400);
          const text = clip(full === '' ? 'The value was not accepted. Check it.' : full, LIMITS.message);
          rec.remote = { status: 'invalid', key, issue: Object.freeze(compact({ code: 'remote' as const, text, detail: text === full ? undefined : full, severity: 'error' as const, source: 'remote' as const })), note: '', detail: '', slow: false, text: '' };
          mark(rec);
          settle(rec, 'invalid');
        }

        flush();
      },
    });
    return pending;
  }

  // ------------------------------------------------------------------------------------------------------------------------------- changes

  const announceNew = (rec: Rec): void => {
    const message = rec.state.message;
    const key = message !== undefined && (message.kind === 'error' || message.kind === 'retry') ? `${message.kind}|${message.text}` : '';
    if (key !== '' && key !== rec.announced) {
      options.announce?.(`${rec.spec.label}: ${(message!).text}`);
    }

    rec.announced = key;
  };

  /** What follows any change of a field's draft: the old verdicts are stale, the checks run again, what reads it is re-run. */
  function afterChange(rec: Rec): void {
    rec.edited = true;
    rec.announced = '';
    if (submitState.status === 'succeeded' || submitState.status === 'failed') {
      submitState = Object.freeze({ ...submitState, status: 'idle' });
      isFormChanged = true;
    }

    if (formIssues.length > 0) {
      formIssues = Object.freeze([]);
      isFormChanged = true;
    }

    rec.hostIssue = undefined;
    rec.failure = undefined;
    if (rec.phase !== 'applying') {
      rec.phase = 'idle';
      scheduler.clearTimeout(rec.savedTimer);
    }

    cancelCheck(rec);
    recheck(rec);
    mark(rec);
    for (const id of schema.dependents.get(rec.spec.id) ?? []) {
      const other = recs.get(id);
      if (other !== undefined) {
        recheck(other);
        if (other.spec.validate?.dependsOn.includes(rec.spec.id) === true) {
          cancelCheck(other);
          scheduleCheck(other);
        }

        mark(other);
      }
    }

    propagate([rec.spec.id], []);
    scheduleCheck(rec);
  }

  /** A check declared `on: 'change'` is asked after the user stops typing, and only for a value the local checks accept. */
  function scheduleCheck(rec: Rec): void {
    if (rec.spec.validate?.on === 'change' && !rec.spec.sensitive && rec.issues.length === 0 && isEditable(rec) && rec.value !== undefined && rec.value !== '') {
      void check(rec, false, false);
    }
  }

  const gate = (id: string, edit: boolean): RefusedReason | Rec => {
    if (isDisposed) {
      return 'disposed';
    }

    const rec = recs.get(id);
    if (rec === undefined) {
      return 'unknown-field';
    }

    if (rec.spec.kind === 'unsupported') {
      return 'unsupported';
    }

    if (submitState.status === 'submitting') {
      return 'busy';
    }

    if (!rec.visible || !rec.sectionVisible) {
      return 'hidden';
    }

    return lockOf(rec) !== undefined || (edit && rec.spec.readonly) ? 'locked' : rec;
  };

  const appliesAtOnce = (rec: Rec): boolean => ['boolean', 'select', 'multiselect', 'list'].includes(rec.spec.kind) || (rec.spec.kind === 'number' && rec.spec.display === 'slider');

  function draftValue(rec: Rec, value: Json | undefined): void {
    if (!rec.spec.sensitive) {
      rec.value = value;
      return;
    }

    if (value === undefined || (value === '' && !rec.presence)) {
      clearSecret(rec);
      return;
    }

    vault.set(rec.spec.id, value);
    rec.changed = true;
  }

  function setValue(id: string, raw: unknown, opts: { readonly commit?: boolean | undefined } = {}): SetResult {
    const found = gate(id, true);
    if (typeof found === 'string') {
      return refused(found);
    }

    const read = readValue(found.spec.kind as Exclude<CompiledField['kind'], 'unsupported'>, raw, true);
    if (!read.ok) {
      return refused('type');
    }

    const sensitive = found.spec.sensitive;
    if (sensitive && (read.value === undefined || (read.value === '' && !found.presence && !found.changed && !vault.has(id)))) {
      return { status: 'noop' };
    }

    if (!sensitive && sameValue(found.value, read.value)) {
      return { status: 'noop' };
    }

    draftValue(found, read.value);
    afterChange(found);
    flush();
    if (mode === 'apply-on-change' && (opts.commit === true || appliesAtOnce(found))) {
      return { status: 'set', commit: commit(id) };
    }

    return { status: 'set' };
  }

  // ------------------------------------------------------------------------------------------------------------------------------- applying (a form that applies on change)

  const reasonOfText = (text: string): Reason => {
    const full = clean(text, 400);
    const shown = clip(full, LIMITS.message);
    return shown === full ? { text: shown } : { text: shown, detail: full };
  };

  const hostIssueOf = (text: string): Issue => {
    const reason = reasonOfText(text);
    return Object.freeze(compact({ code: 'rejected' as const, text: reason.text, detail: reason.detail, severity: 'error' as const, source: 'host' as const }));
  };

  function accept(rec: Rec, sent: Json | undefined, canonical: Readonly<Record<string, Json>> | null | undefined): void {
    if (rec.spec.sensitive) {
      if (canonical !== null) {
        rec.presence = !(sent === '' || sent === undefined);
      }

      // Drop the accepted secret, but not a newer one typed while the write was in flight.
      if (sameValue(vault.get(rec.spec.id), sent)) {
        clearSecret(rec);
      }

      return;
    }

    const read = canonical && Object.hasOwn(canonical, rec.spec.id) ? readValue(rec.spec.kind as Exclude<CompiledField['kind'], 'unsupported'>, canonical[rec.spec.id], false) : undefined;
    const applied = canonical === null ? rec.applied : read?.ok === true ? read.value : sent;
    if (sameValue(rec.value, sent)) {
      rec.value = applied;
    }

    rec.applied = applied;
  }

  function applyOutcome(rec: Rec, outcome: SubmitOutcome, value: Json | undefined): boolean {
    if (outcome === undefined || outcome.ok) {
      accept(rec, value, outcome?.values);

      return true;
    }

    const own = outcome.errors?.[rec.spec.id] ?? (outcome.errors === undefined ? outcome.message : undefined);
    rec.hostIssue = hostIssueOf(own ?? outcome.message ?? GENERIC);
    for (const [id, text] of Object.entries(outcome.errors ?? {})) {
      const other = id === rec.spec.id ? undefined : recs.get(id);
      if (other !== undefined) {
        other.hostIssue = hostIssueOf(text);
        mark(other);
      }
    }

    return false;
  }

  async function doApply(rec: Rec): Promise<CommitResult> {
    const id = rec.spec.id;
    const value = rec.spec.sensitive ? vault.get(id) : rec.value;
    const secrets = rec.spec.sensitive ? stringsOf(value) : [];
    token += 1;
    const mine = token;
    if (secrets.length > 0) {
      inflightSecrets.set(mine, secrets);
    }

    rec.phase = 'applying';
    rec.inflight = true;
    rec.failure = undefined;
    const call = new AbortController();
    controller = call;
    const payload: SubmitPayload = Object.freeze({ mode, values: Object.freeze({ [id]: (value ?? null) }), changed: Object.freeze([id]), signal: call.signal });

    mark(rec);
    flush();
    let status: CommitResult['status'] = 'applied';
    try {
      const outcome = await options.submit(payload);
      if (isDisposed) {
        return refused('disposed');
      }

      if (applyOutcome(rec, outcome, value)) {
        const confirmed = outcome?.ok !== true || outcome.values !== null;
        rec.phase = confirmed && (rec.spec.validate !== undefined || (rec.spec.kind !== 'boolean' && rec.spec.kind !== 'select')) ? 'saved' : 'idle';
        rec.savedNote = rec.remote.status === 'valid' ? rec.remote.note : '';
        if (rec.phase === 'saved') {
          scheduler.clearTimeout(rec.savedTimer);
          rec.savedTimer = scheduler.setTimeout(() => {
            if (rec.phase === 'saved') {
              rec.phase = 'idle';
              rec.savedNote = '';
              mark(rec);
              flush();
            }
          }, timing.saved);
        }

        propagate([id], []);
      } else {
        rec.phase = 'idle';
        status = 'invalid';
      }
    } catch (error) {
      if (isDisposed) {
        return refused('disposed');
      }

      const mapped = mapHostError(error, { has: (other) => recs.has(other), scrub, fallback: GENERIC });
      if (mapped.cancelled) {
        rec.phase = 'idle';
        status = 'stale';
      } else {
        rec.phase = 'failed';
        rec.failure = mapped.form.title === 'Could not save' && mapped.form.text === GENERIC ? { text: 'Couldn’t save this change. It isn’t applied.' } : reasonOfText(mapped.form.text);
        status = 'failed';
      }
    } finally {
      inflightSecrets.delete(mine);
      rec.inflight = false;
      if (!isDisposed) {
        mark(rec);
        flush();
      }

      try {
        options.onApplySettled?.();
      } catch (error) {
        report(error, 'after apply');
      }
    }

    return { status };
  }

  /** One change in flight per field: later ones wait, and only the latest value is applied after the one that runs (nothing is applied out of order). */
  async function enqueue(rec: Rec): Promise<CommitResult> {
    if (rec.inflight) {
      if (rec.next === undefined) {
        let resolve: (result: CommitResult) => void = () => undefined;
        const promise = new Promise<CommitResult>((done) => {
          resolve = done;
        });
        rec.next = { promise, resolve };
      }

      return rec.next.promise;
    }

    return doApply(rec).then(async (result) => {
      const waiting = rec.next;
      rec.next = undefined;
      if (waiting !== undefined) {
        // A queued draft was never sent if the accepted write retired this form.
        waiting.resolve(isDisposed ? refused('disposed') : await commit(rec.spec.id));
      }

      return result;
    });
  }

  async function commit(id: string, opts: { readonly force?: boolean; readonly skipCheck?: boolean } = {}): Promise<CommitResult> {
    const found = gate(id, false);
    if (typeof found === 'string') {
      return refused(found);
    }

    found.touched = true;
    found.told = true;
    recheck(found);
    mark(found);
    const blocked = found.issues.length > 0;
    if (blocked) {
      flush();
      announceNew(found);
      return { status: 'invalid' };
    }

    const sensitive = found.spec.sensitive;
    if (mode === 'apply-on-change' && opts.force !== true && (sensitive ? !found.changed : sameValue(found.value, found.applied))) {
      found.phase = found.phase === 'applying' ? found.phase : 'idle';
      flush();
      return { status: 'same' };
    }

    if (found.spec.validate !== undefined && !sensitive && opts.skipCheck !== true) {
      const checked = await check(found, true, opts.force === true);
      if (checked !== 'valid') {
        flush();
        announceNew(found);
        return { status: checked === 'invalid' ? 'invalid' : checked === 'unchecked' ? 'unchecked' : 'stale' };
      }
    }

    if (isDisposed) {
      return refused('disposed');
    }

    if (mode !== 'apply-on-change') {
      flush();
      return { status: 'checked' };
    }

    const result = await enqueue(found);
    announceNew(found);
    return result;
  }

  // ------------------------------------------------------------------------------------------------------------------------------- revert and reset

  function revertRec(rec: Rec): boolean {
    const hadSecret = rec.spec.sensitive && clearSecret(rec);
    const hadState = rec.touched || rec.edited || rec.told || rec.remote.status !== 'idle' || rec.hostIssue !== undefined || rec.phase === 'failed' || rec.phase === 'saved' || !sameValue(rec.value, rec.applied) || rec.waiters.length > 0;
    cancelCheck(rec);
    scheduler.clearTimeout(rec.savedTimer);
    const valueChanged = !rec.spec.sensitive && !sameValue(rec.value, rec.applied);
    rec.value = rec.spec.sensitive ? undefined : rec.applied;
    rec.touched = false;
    rec.edited = false;
    rec.told = false;
    rec.hostIssue = undefined;
    rec.failure = undefined;
    rec.phase = 'idle';
    rec.savedNote = '';
    rec.announced = '';
    recheck(rec);
    mark(rec);
    if (valueChanged) {
      propagate([rec.spec.id], []);
    }

    return hadSecret || hadState;
  }

  function revert(id?: string): boolean {
    if (isDisposed || submitState.status === 'submitting') {
      return false;
    }

    if (id !== undefined) {
      const rec = recs.get(id);
      if (rec === undefined || rec.phase === 'applying' || rec.spec.kind === 'unsupported') {
        return false;
      }

      const changed = revertRec(rec);
      flush();
      return changed;
    }

    let changed = false;
    for (const rec of list) {
      if (rec.spec.kind !== 'unsupported' && rec.phase !== 'applying') {
        changed = revertRec(rec) || changed;
      }
    }

    if (submitState.attempted || submitState.status !== 'idle' || formIssues.length > 0) {
      submitState = Object.freeze({ status: 'idle', attempted: false, attempts: submitState.attempts });
      formIssues = Object.freeze([]);
      isFormChanged = true;
      changed = true;
    }

    flush();
    return changed;
  }

  function reset(id: string): SetResult {
    const found = gate(id, true);
    if (typeof found === 'string') {
      return refused(found);
    }

    const value = found.spec.sensitive ? '' : found.spec.default;
    if (found.spec.sensitive) {
      if (!found.presence && !found.changed) {
        return { status: 'noop' };
      }

      vault.set(id, '');
      found.changed = true;
    } else if (sameValue(found.value, value) && !(mode === 'apply-on-change' && !sameValue(found.applied, value))) {
      return { status: 'noop' };
    } else {
      found.value = value;
    }

    afterChange(found);
    flush();
    return mode === 'apply-on-change' ? { status: 'set', commit: commit(id, { force: true, skipCheck: true }) } : { status: 'set' };
  }

  // ------------------------------------------------------------------------------------------------------------------------------- submit (a form committed as a whole)

  const outcomeIssues = (outcome: Extract<NonNullable<SubmitOutcome>, { readonly ok: false }>): FormIssue => {
    const suggestions: string[] = [];
    for (const [id, text] of Object.entries(outcome.errors ?? {})) {
      const rec = recs.get(id);
      if (rec !== undefined) {
        rec.hostIssue = hostIssueOf(text);
        mark(rec);
      } else if (suggestions.length < 8) {
        suggestions.push(`${clean(id, 64)}: ${clean(text, 200)}`);
      }
    }

    const sentence = clean(outcome.message, 400);
    return Object.freeze({ kind: 'error' as const, title: 'Could not save', text: sentence === '' ? GENERIC : sentence, suggestions: Object.freeze(suggestions), actions: Object.freeze([]) });
  };

  /** What the host says about a success, cleaned and scrubbed like every other text of the host's. */
  const noticeOf = (outcome: SubmitOutcome): SubmitState['notice'] => {
    const notice = outcome?.ok === true ? outcome.notice : undefined;
    const text = clean(notice?.text, LIMITS.text);
    return notice === undefined || text === '' ? undefined : Object.freeze({ kind: notice.kind === 'warning' ? ('warning' as const) : ('info' as const), text });
  };

  async function runSubmit(): Promise<SubmitResult> {
    const included = list.filter((rec) => rec.spec.kind !== 'unsupported' && rec.visible && rec.sectionVisible && !rec.spec.readonly && lockOf(rec)?.readonly !== true && (send === 'all' ? (rec.spec.sensitive ? rec.changed : true) : isDirty(rec)));
    if (send === 'changed' && included.length === 0) {
      return { status: 'noop' };
    }

    submitState = Object.freeze({ status: 'idle', attempted: true, attempts: submitState.attempts + 1 });
    formIssues = Object.freeze([]);
    for (const rec of list) {
      rec.hostIssue = undefined;
      rec.told = rec.told || isEditable(rec);
      mark(rec);
    }

    isFormChanged = true;
    const checkable = list.filter(isEditable);
    const invalid = (): readonly Rec[] => checkable.filter((rec) => rec.issues.length > 0 || rec.remote.status === 'invalid');
    const refuse = (bad: readonly Rec[]): SubmitResult => {
      flush();
      const ids = bad.map((rec) => rec.spec.id);
      const first = bad[0];
      if (first !== undefined) {
        const message = first.state.message?.text ?? 'Some values need attention.';
        options.announce?.(`${bad.length > 1 ? `${String(bad.length)} fields need attention. ` : ''}${first.spec.label}: ${message}`);
        for (const rec of bad) {
          rec.announced = rec.state.message === undefined ? '' : `${rec.state.message.kind}|${rec.state.message.text}`;
        }
      }

      return { status: 'invalid', firstInvalid: ids[0] ?? '', invalid: ids };
    };

    if (invalid().length > 0) {
      return refuse(invalid());
    }

    const asking = checkable.filter((rec) => rec.spec.validate !== undefined && !rec.spec.sensitive);
    if (asking.length > 0) {
      submitState = Object.freeze({ ...submitState, status: 'submitting' });
      flush();
      const results = await Promise.all(asking.map(async (rec) => check(rec, true, false)));
      if (isDisposed) {
        return refused('disposed');
      }

      if (results.some((status) => status !== 'valid')) {
        submitState = Object.freeze({ ...submitState, status: 'idle' });
        isFormChanged = true;
        return refuse(asking.filter((_, at) => results[at] !== 'valid'));
      }
    }

    const values: Record<string, Json> = {};
    const changed: string[] = [];
    const secrets: string[] = [];
    for (const rec of included) {
      const value = rec.spec.sensitive ? vault.get(rec.spec.id) : rec.value;
      values[rec.spec.id] = (value ?? null);
      if (isDirty(rec)) {
        changed.push(rec.spec.id);
      }

      if (rec.spec.sensitive) {
        secrets.push(...stringsOf(value));
      }
    }

    token += 1;
    const mine = token;
    if (secrets.length > 0) {
      inflightSecrets.set(mine, secrets);
    }

    const call = new AbortController();
    controller = call;
    const payload: SubmitPayload = Object.freeze({ mode, values: Object.freeze(values), changed: Object.freeze(changed), signal: call.signal });

    submitState = Object.freeze({ ...submitState, status: 'submitting' });
    flush();
    let outcome: SubmitOutcome = undefined;
    let failure: unknown;
    let hasFailed = false;
    try {
      try {
        outcome = await options.submit(payload);
      } catch (error) {
        hasFailed = true;
        failure = error;
      }

      if (isDisposed || call.signal.aborted) {
        return refused('disposed');
      }

      if (!hasFailed && (outcome === undefined || outcome.ok)) {
        const canonical = outcome?.ok === true ? outcome.values : undefined;
        for (const rec of included) {
          accept(rec, values[rec.spec.id] ?? undefined, canonical);

          rec.told = false;
          recheck(rec);
          mark(rec);
        }

        submitState = Object.freeze(compact({ status: 'succeeded' as const, attempted: false, attempts: submitState.attempts, notice: noticeOf(outcome) }));
        propagate(included.map((rec) => rec.spec.id), []);
        isFormChanged = true;
        flush();
        return { status: 'succeeded' };
      }

      const rejected = hasFailed ? mapHostError(failure, { has: (id) => recs.has(id), scrub, fallback: GENERIC }) : undefined;
      if (rejected?.cancelled === true) {
        submitState = Object.freeze({ ...submitState, status: 'idle' });
        isFormChanged = true;
        flush();
        return { status: 'failed' };
      }

      formIssues = Object.freeze([rejected !== undefined ? rejected.form : outcomeIssues(outcome as Extract<NonNullable<SubmitOutcome>, { readonly ok: false }>)]);
      for (const [id, reason] of rejected?.fields ?? []) {
        const rec = recs.get(id);
        if (rec !== undefined) {
          rec.hostIssue = Object.freeze(compact({ code: reason.code, text: reason.text, detail: reason.detail, severity: 'error' as const, source: 'host' as const }));
          mark(rec);
        }
      }

      submitState = Object.freeze({ ...submitState, status: 'failed' });
      isFormChanged = true;
      flush();
      return { status: 'failed' };
    } finally {
      inflightSecrets.delete(mine);
    }
  }

  async function submit(): Promise<SubmitResult> {
    if (isDisposed) {
      return Promise.resolve(refused('disposed'));
    }

    if (mode !== 'explicit') {
      return Promise.resolve(refused('mode'));
    }

    if (inflightSubmit !== undefined) {
      return inflightSubmit;
    }

    if (formLock !== undefined && !formLock.readonly) {
      return Promise.resolve(refused('locked'));
    }

    const running = runSubmit().finally(() => {
      inflightSubmit = undefined;
    });
    inflightSubmit = running;
    return running;
  }

  // ------------------------------------------------------------------------------------------------------------------------------- options

  const optionOf = (entry: unknown): Option | undefined => {
    if (!isObject(entry) || Array.isArray(entry) || !isScalar(entry.value)) {
      return undefined;
    }

    const label = clean(entry.label, LIMITS.label);
    const description = clean(entry.description, LIMITS.text);
    return Object.freeze({ value: entry.value, label: label === '' ? String(entry.value) : label, ...(description === '' ? {} : { description }) });
  };

  function queryOptions(id: string, query: string, opts: { readonly immediate?: boolean | undefined } = {}): boolean {
    const rec = recs.get(id);
    const provider = rec?.spec.provider;
    if (isDisposed || rec === undefined || provider === undefined || rec.options === undefined) {
      return false;
    }

    const state = rec.options;
    const found = options.providers !== undefined && Object.hasOwn(options.providers, provider.name) ? options.providers[provider.name] : undefined;
    const text = clip(query, LIMITS.value);
    state.query = text;
    if (found === undefined) {
      state.status = 'error';
      state.message = 'Couldn’t load the options. Try again.';
      mark(rec);
      flush();
      return true;
    }

    state.status = 'loading';
    state.message = undefined;
    mark(rec);
    flush();
    runner.run(`options:${id}`, {
      delay: opts.immediate === true ? 0 : timing.options,
      timeout: timing.optionsTimeout,
      work: async (signal) => found({ id, query: text, params: provider.params, limit: provider.limit, values: visibleValues(), signal }),
      done: (outcome) => {
        if (outcome.status === 'done') {
          const answer: OptionAnswer = outcome.value;
          const rows = Array.isArray(answer) ? (answer as readonly unknown[]) : isObject(answer) && Array.isArray(answer.options) ? (answer.options as readonly unknown[]) : [];
          const seen = new Set<Scalar>();
          const kept: Option[] = [];
          for (const entry of rows.slice(0, LIMITS.providerRows)) {
            const option = optionOf(entry);
            if (option !== undefined && !seen.has(option.value) && kept.length < provider.limit) {
              seen.add(option.value);
              kept.push(option);
              state.labels.set(valueKey(option.value), option);
            }
          }

          state.rows = kept;
          state.total = isObject(answer) && !Array.isArray(answer) && typeof answer.total === 'number' && answer.total > kept.length ? answer.total : undefined;
          state.status = 'ready';
        } else {
          if (outcome.status === 'failed') {
            report(outcome.error, `options of ${id}`);
          }

          state.status = 'error';
          state.message = 'Couldn’t load the options. Try again.';
        }

        mark(rec);
        flush();
      },
    });
    return true;
  }

  // ------------------------------------------------------------------------------------------------------------------------------- the rest

  const guard: DraftGuard = {
    dirty: () => snapshot.dirty,
    save: async () => {
      const result = await submit();
      switch (result.status) {
        case 'succeeded':
        case 'noop':
          return 'saved';
        case 'invalid':
          return { result: 'invalid', reason: snapshot.fields.find((entry) => entry.id === result.firstInvalid)?.message?.text ?? 'Some values need attention.' };
        case 'failed':
          return { result: 'failed', reason: snapshot.issues[0]?.text ?? GENERIC };
        case 'refused':
          return result.reason === 'mode' ? 'saved' : { result: 'failed', reason: GENERIC };
      }
    },
    discard: () => {
      revert();
    },
  };

  function setFieldLock(id: string, lock: Lock | undefined): boolean {
    const rec = recs.get(id);
    if (isDisposed || rec === undefined || equalJson(rec.fieldLock ?? null, lock ?? null)) {
      return false;
    }

    rec.fieldLock = lock === undefined ? undefined : Object.freeze({ ...lock });
    mark(rec);
    flush();
    return true;
  }

  function setFormLock(lock: Lock | undefined): boolean {
    if (isDisposed || equalJson(formLock ?? null, lock ?? null)) {
      return false;
    }

    formLock = lock === undefined ? undefined : Object.freeze({ ...lock });
    for (const rec of list) {
      mark(rec);
    }

    isFormChanged = true;
    flush();
    return true;
  }

  function setContext(patch: Readonly<Record<string, Scalar>>): boolean {
    if (isDisposed) {
      return false;
    }

    const changed = Object.entries(patch).filter(([key, value]) => context.get(key) !== value);
    if (changed.length === 0) {
      return false;
    }

    for (const [key, value] of changed) {
      context.set(key, value);
    }

    propagate([], changed.map(([key]) => key));
    flush();
    return true;
  }

  function rebase(values: Readonly<Record<string, Json>>, opts: { readonly presence?: Readonly<Record<string, boolean>> | undefined; readonly restarted?: boolean | undefined; readonly pendingRestart?: readonly string[] | undefined } = {}): boolean {
    if (isDisposed || submitState.status === 'submitting') {
      return false;
    }

    const changedIds: string[] = [];
    for (const [id, raw] of Object.entries(values)) {
      const rec = recs.get(id);
      if (rec === undefined || rec.spec.sensitive || rec.spec.kind === 'unsupported') {
        continue;
      }

      const read = readValue(rec.spec.kind, raw, false);
      if (!read.ok || sameValue(read.value, rec.applied)) {
        continue;
      }

      const follows = sameValue(rec.value, rec.applied);
      rec.applied = read.value;
      if (follows) {
        rec.value = read.value;
      }

      recheck(rec);
      mark(rec);
      changedIds.push(id);
    }

    for (const [id, saved] of Object.entries(opts.presence ?? {})) {
      const rec = recs.get(id);
      if (rec !== undefined && rec.spec.sensitive && rec.presence !== saved) {
        rec.presence = saved;
        recheck(rec);
        mark(rec);
        changedIds.push(id);
      }
    }

    for (const rec of list) {
      const wasPending = isPendingRestart(rec);
      if (opts.restarted === true) {
        rec.startup = rec.applied;
        rec.hostPending = false;
      }

      if (opts.pendingRestart !== undefined) {
        rec.hostPending = opts.pendingRestart.includes(rec.spec.id);
      }

      if (wasPending !== isPendingRestart(rec)) {
        mark(rec);
        changedIds.push(rec.spec.id);
      }
    }

    propagate(changedIds, []);
    const had = marked.size > 0;
    flush();
    return had;
  }

  function serialise(): PersistedForm {
    const out: Array<readonly [string, Json]> = [];
    for (const rec of list) {
      if (rec.spec.kind !== 'unsupported' && !rec.spec.sensitive && !sameValue(rec.value, rec.applied)) {
        out.push([rec.spec.id, rec.value === undefined ? null : rec.value]);
      }
    }

    return Object.freeze({ version: FORM_VERSION, schema: schema.id, values: Object.freeze(Object.fromEntries(out)) });
  }

  function dispose(): void {
    if (isDisposed) {
      return;
    }

    isDisposed = true;
    runner.cancelAll();
    controller?.abort();
    for (const rec of list) {
      scheduler.clearTimeout(rec.slowTimer);
      scheduler.clearTimeout(rec.savedTimer);
      settle(rec, 'stale');
    }

    vault.clear();
    inflightSecrets.clear();
    listeners.clear();
  }

  // ------------------------------------------------------------------------------------------------------------------------------- start

  startConditions();
  for (const rec of list) {
    recheck(rec);
  }

  if (options.draft !== undefined) {
    for (const [id, raw] of Object.entries(options.draft)) {
      const rec = recs.get(id);
      if (rec === undefined || rec.spec.sensitive || rec.spec.kind === 'unsupported') {
        continue;
      }

      const read = raw === null && (rec.spec.kind === 'number' || rec.spec.kind === 'select') ? { ok: true as const, value: undefined } : readValue(rec.spec.kind, raw, true);
      if (read.ok && !sameValue(read.value, rec.value)) {
        rec.value = read.value;
        rec.edited = true;
        recheck(rec);
      }
    }
  }

  for (const rec of list) {
    rec.state = build(rec);
  }

  snapshot = compose(undefined);
  fieldsOf = snapshot.fields;

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    subscribeTo: (select, listener, equals = Object.is) => {
      let current = select(snapshot);
      const wrapped = (): void => {
        const next = select(snapshot);
        if (!equals(current, next)) {
          const previous = current;
          current = next;
          listener(next, previous);
        }
      };

      listeners.add(wrapped);
      return () => {
        listeners.delete(wrapped);
      };
    },
    field: (id) => {
      const rec = recs.get(id);
      return rec === undefined ? undefined : fieldsOf[rec.spec.index];
    },
    setValue,
    blur: async (id) => {
      const rec = recs.get(id);
      if (rec !== undefined && !isDisposed) {
        rec.touched = true;
        mark(rec);
      }

      return commit(id);
    },
    commit: async (id) => commit(id),
    retry: async (id) => {
      const rec = recs.get(id);
      return rec?.phase === 'failed' && mode === 'apply-on-change' ? enqueue(rec) : commit(id, { force: true });
    },
    revert,
    reset,
    submit,
    draft: () => guard,
    setContext,
    setFieldLock,
    setFormLock,
    queryOptions,
    rebase,
    serialise,
    stats: () => Object.freeze({ ...counters, secrets: vault.size }),
    dispose,
  };
}
