import { isObject, strictJson } from '../tabs/json';
import { compileCondition, type CompiledCondition } from './expr';
import { cleanText } from './text';
import {
  ISSUE_CODES,
  LIMITS,
  SCHEMA_VERSION,
  isFieldKind,
  type FieldKind,
  type IssueCode,
  type Json,
  type Option,
  type Problem,
  type ProblemCode,
} from './types';
import { emptyValue, isScalar, readValue } from './values';

// The compiler: a schema as a plugin or the host wrote it (plain data, possibly from a NEWER build) becomes the compiled form the store runs on, read defensively and frozen. It never
// throws. What it cannot read it leaves out and says so in `problems` (a diagnostic for the host and the developer tools, never shown to a user): a field with a kind this build
// does not know becomes an `unsupported` entry (read-only, "not supported in this version"); a condition it cannot read holds; a constraint it cannot read is dropped. A schema whose
// VERSION this build cannot bring up or read is `ok: false`: it is never half used (the palette's and the tab model's saved forms follow the same rule).

type Raw = Readonly<Record<string, unknown>>;
type Slot = 'visible' | 'enabled' | 'notes' | 'section';

export type CompiledConstraints = {
  readonly required: boolean;
  readonly minLength?: number | undefined;
  readonly maxLength?: number | undefined;
  /** The whole value must match (anchored, flag `u`). */
  readonly pattern?: RegExp | undefined;
  /** One character must match; a typed character that does not is an error at once. */
  readonly allowed?: RegExp | undefined;
  readonly format?: 'datetime' | undefined;
  readonly min?: number | undefined;
  readonly max?: number | undefined;
  readonly step?: number | undefined;
  readonly integer: boolean;
  readonly minItems?: number | undefined;
  readonly maxItems?: number | undefined;
  readonly unique: boolean;
  readonly item: 'text' | 'path' | 'url';
  readonly pathKind: 'file' | 'directory';
  readonly absolute: boolean;
  readonly extensions: readonly string[];
  readonly schemes: readonly string[];
  readonly sameAs?: string | undefined;
  readonly messages: Readonly<Partial<Record<IssueCode, string>>>;
};

export type CompiledRemote = {
  readonly remote: string;
  readonly on: 'commit' | 'change';
  readonly debounce: number;
  readonly timeout: number;
  readonly dependsOn: readonly string[];
  readonly checking: string;
};

export type CompiledProvider = { readonly name: string; readonly params: Json | undefined; readonly limit: number };

export type CompiledNote = { readonly when: CompiledCondition; readonly kind: 'warning' | 'info'; readonly text: string };

export type CompiledField = {
  readonly id: string;
  /** Its place among all the fields, from 0. */
  readonly index: number;
  readonly section: string;
  readonly kind: FieldKind | 'unsupported';
  /** The kind as the schema wrote it (cleaned): what an `unsupported` entry quotes. */
  readonly rawKind: string;
  readonly label: string;
  readonly help: string;
  readonly hint: string;
  readonly placeholder: string;
  readonly unit: string;
  readonly default: Json | undefined;
  readonly required: boolean;
  readonly constraints: CompiledConstraints;
  readonly options: readonly Option[] | undefined;
  readonly provider: CompiledProvider | undefined;
  readonly validate: CompiledRemote | undefined;
  readonly visible: CompiledCondition | undefined;
  readonly enabled: CompiledCondition | undefined;
  readonly notes: readonly CompiledNote[];
  readonly sensitive: boolean;
  readonly readonly: boolean;
  readonly restart: 'none' | 'app' | 'plugin';
  readonly keywords: readonly string[];
  readonly display: string;
  readonly mono: boolean;
};

export type CompiledSection = {
  readonly id: string;
  readonly label: string;
  readonly help: string;
  readonly collapsed: boolean;
  readonly visible: CompiledCondition | undefined;
  readonly fields: readonly CompiledField[];
};

/** A condition that reads something: which field or section it belongs to, and which of its conditions. */
export type Reads = { readonly target: string; readonly slot: Slot };

export type CompiledSchema = {
  readonly id: string;
  readonly version: number;
  readonly sections: readonly CompiledSection[];
  /** Every field in order. */
  readonly fields: readonly CompiledField[];
  readonly index: ReadonlyMap<string, CompiledField>;
  /** For each field id, the conditions that read its value: a change of the value re-runs these and no others. */
  readonly readers: ReadonlyMap<string, readonly Reads[]>;
  /** The same for the host's flags. */
  readonly ctxReaders: ReadonlyMap<string, readonly Reads[]>;
  /** For each field id, the fields whose own check reads it (`sameAs`, `dependsOn`), in order. */
  readonly dependents: ReadonlyMap<string, readonly string[]>;
};

export type Migration = (raw: Readonly<Record<string, unknown>>) => unknown;

/** The steps from every older schema version, keyed by the version they start from. Empty at version 1: the first release has nothing to migrate from. */
export const MIGRATIONS: Readonly<Record<number, Migration>> = Object.freeze({});

export type CompileOptions = {
  /** Steps that bring an older schema up, by the version they start from; a host that adapts a hand-written shape gives its own. Default: `MIGRATIONS`. A step must not change what it is given. */
  readonly migrations?: Readonly<Record<number, Migration>> | undefined;
};

export type CompileResult =
  | { readonly ok: true; readonly schema: CompiledSchema; readonly problems: readonly Problem[] }
  | { readonly ok: false; readonly reason: 'unreadable' | 'foreign-version'; readonly detail: string };

const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);
const NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const CONTROL = /\p{Cc}/u;
const STRING_KINDS: ReadonlySet<string> = new Set(['text', 'path', 'url', 'color', 'secret']);

/** The characters a typed value may have, named as the lab's settings page names them (`ALLOW`, shell-page-settings.js:1283). */
const CLASSES: Readonly<Record<string, string>> = Object.freeze({ digits: '[0-9]', hex: '[0-9a-fA-F]', color: '[#0-9a-fA-F]', header: '[A-Za-z0-9-]', hostport: '[A-Za-z0-9.:-]', dns: '[a-z0-9-]' });
const BRACKET = /^\[(?:\\.|[^\]\\])+\]$/;

const asRaw = (value: unknown): Raw | undefined => (isObject(value) && !Array.isArray(value) ? (value) : undefined);

/** A member of a plain object, never one from its prototype; JSON `null` is "nothing" (that is how a Go struct with no value says it). */
function member(value: Raw, key: string): unknown {
  if (!Object.hasOwn(value, key)) {
    return undefined;
  }

  const found = value[key];
  return found === null ? undefined : found;
}

type Sink = { readonly problems: Problem[]; readonly add: (code: ProblemCode, path: string, message: string) => void };

function makeSink(): Sink {
  const problems: Problem[] = [];
  return {
    problems,
    add: (code, path, message) => {
      if (problems.length < LIMITS.problems) {
        problems.push({ code, path, message });
      }
    },
  };
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const whole = (value: unknown, min: number, max: number): value is number => finite(value) && Number.isInteger(value) && value >= min && value <= max;

type Ids = ReadonlyMap<string, { readonly sensitive: boolean }>;

function compileMessages(raw: unknown): Readonly<Partial<Record<IssueCode, string>>> {
  const found = asRaw(raw);
  const out: Partial<Record<IssueCode, string>> = {};
  if (found === undefined) {
    return Object.freeze(out);
  }

  for (const code of ISSUE_CODES) {
    const text = cleanText(member(found, code), LIMITS.message);
    if (text !== '') {
      out[code] = text;
    }
  }

  return Object.freeze(out);
}

type Bounds = { readonly min?: number | undefined; readonly max?: number | undefined };

/** A pair of bounds that is read as numbers and that cannot contradict itself: when the minimum is above the maximum both are dropped. */
function bounds(raw: Raw, names: readonly [string, string], valid: (value: unknown) => value is number, note: (name: string, message: string) => void): Bounds {
  let [low, high] = names.map((name) => {
    const value = member(raw, name);
    if (value === undefined) {
      return undefined;
    }

    if (!valid(value)) {
      note(name, `${name} is a number in range.`);
      return undefined;
    }

    return value;
  });

  if (low !== undefined && high !== undefined && low > high) {
    note(names[0], `${names[0]} is above ${names[1]}.`);
    low = undefined;
    high = undefined;
  }

  return { min: low, max: high };
}

function compileConstraints(kind: FieldKind | 'unsupported', raw: unknown, selfId: string, selfSensitive: boolean, ids: Ids, note: (message: string, sub: string, code?: ProblemCode) => void): CompiledConstraints {
  const found = asRaw(raw) ?? {};
  const bad = (sub: string, message: string): void => {
    note(message, sub);
  };

  const stringy = STRING_KINDS.has(kind);
  const length = stringy ? bounds(found, ['minLength', 'maxLength'], (value): value is number => whole(value, 0, LIMITS.value), (name, message) => {
    bad(name, message); 
  }) : {};
  const range = kind === 'number' ? bounds(found, ['min', 'max'], finite, (name, message) => {
    bad(name, message); 
  }) : {};
  const items = kind === 'multiselect' || kind === 'list' ? bounds(found, ['minItems', 'maxItems'], (value): value is number => whole(value, 0, LIMITS.items), (name, message) => {
    bad(name, message); 
  }) : {};

  let step: number | undefined;
  let integer = false;
  if (kind === 'number') {
    const rawStep = member(found, 'step');
    if (rawStep !== undefined) {
      if (finite(rawStep) && rawStep > 0) {
        step = rawStep;
      } else {
        bad('step', 'step is a number above zero.');
      }
    }

    const rawInteger = member(found, 'integer');
    if (rawInteger !== undefined) {
      if (typeof rawInteger === 'boolean') {
        integer = rawInteger;
      } else {
        bad('integer', 'integer is true or false.');
      }
    }
  }

  let pattern: RegExp | undefined;
  let allowed: RegExp | undefined;
  let format: 'datetime' | undefined;
  if (stringy) {
    const rawPattern = member(found, 'pattern');
    if (rawPattern !== undefined) {
      try {
        if (typeof rawPattern !== 'string' || rawPattern === '' || rawPattern.length > LIMITS.pattern) {
          throw new TypeError('pattern');
        }

        pattern = new RegExp(`^(?:${rawPattern})$`, 'u');
      } catch {
        bad('pattern', `pattern is a regular expression of at most ${String(LIMITS.pattern)} characters.`);
      }
    }

    const rawAllowed = member(found, 'allowedChars');
    if (rawAllowed !== undefined) {
      try {
        const source = typeof rawAllowed === 'string' ? (CLASSES[rawAllowed] ?? (BRACKET.test(rawAllowed) && rawAllowed.length <= 64 ? rawAllowed : undefined)) : undefined;
        if (source === undefined) {
          throw new TypeError('allowedChars');
        }

        allowed = new RegExp(`^${source}$`, 'u');
      } catch {
        bad('allowedChars', 'allowedChars is a named class or one bracket class such as [a-z0-9-].');
      }
    }

    const rawFormat = member(found, 'format');
    if (rawFormat !== undefined) {
      if (rawFormat === 'datetime' && kind === 'text') {
        format = 'datetime';
      } else {
        bad('format', 'format is datetime, on a text.');
      }
    }
  }

  let sameAs: string | undefined;
  const rawSame = member(found, 'sameAs');
  if (rawSame !== undefined) {
    const other = typeof rawSame === 'string' ? ids.get(rawSame) : undefined;
    if (other === undefined || rawSame === selfId) {
      bad('sameAs', 'sameAs names another field of this form.');
    } else if (other.sensitive !== selfSensitive) {
      note('A secret is compared only with a secret.', 'sameAs', 'secret-rule');
    } else {
      sameAs = rawSame as string;
    }
  }

  const rawItem = member(found, 'item');
  const rawKindOfPath = member(found, 'pathKind');
  const extensions = Array.isArray(member(found, 'extensions')) ? (member(found, 'extensions') as readonly unknown[]).map((entry) => cleanText(entry, 16)).filter((entry) => entry !== '').slice(0, 16) : [];
  const rawSchemes = member(found, 'schemes');
  const schemes = Array.isArray(rawSchemes) ? rawSchemes.map((entry) => cleanText(entry, 16).toLowerCase()).filter((entry) => /^[a-z][a-z0-9+.-]*$/.test(entry)).slice(0, 8) : [];

  return Object.freeze({
    required: member(found, 'required') === true,
    minLength: length.min,
    maxLength: length.max,
    pattern,
    allowed,
    format,
    min: range.min,
    max: range.max,
    step,
    integer,
    minItems: items.min,
    maxItems: items.max,
    unique: kind === 'multiselect' || member(found, 'unique') === true,
    item: rawItem === 'path' || rawItem === 'url' ? rawItem : 'text',
    pathKind: rawKindOfPath === 'directory' ? 'directory' : 'file',
    absolute: member(found, 'absolute') === true,
    extensions: Object.freeze(extensions),
    schemes: Object.freeze(schemes.length > 0 ? schemes : ['http', 'https']),
    sameAs,
    messages: compileMessages(member(found, 'messages')),
  });
}

function compileOption(entry: unknown): Option | undefined {
  const found = asRaw(entry);
  const value = found === undefined ? undefined : member(found, 'value');
  if (found === undefined || !isScalar(value)) {
    return undefined;
  }

  const label = cleanText(member(found, 'label'), LIMITS.label);
  const description = cleanText(member(found, 'description'), LIMITS.text);
  const disabled = member(found, 'disabled');
  const reason = typeof disabled === 'string' ? cleanText(disabled, LIMITS.message) : undefined;
  return Object.freeze({
    value,
    label: label === '' ? String(value) : label,
    ...(description === '' ? {} : { description }),
    ...(reason !== undefined && reason !== '' ? { disabled: reason } : disabled === true ? { disabled: true } : {}),
  });
}

function compileDefault(kind: FieldKind, raw: unknown, options: readonly Option[] | undefined): { readonly ok: boolean; readonly value: Json | undefined } {
  const read = readValue(kind, raw, false);
  if (!read.ok) {
    return { ok: false, value: emptyValue(kind) };
  }

  const value = read.value === undefined ? undefined : strictJson(read.value);
  if (options !== undefined) {
    const offered = (candidate: unknown): boolean => options.some((option) => option.value === candidate);
    if ((kind === 'select' && !offered(value)) || (kind === 'multiselect' && !(Array.isArray(value) && value.every(offered)))) {
      return { ok: false, value: emptyValue(kind) };
    }
  }

  return value === undefined && raw !== undefined ? { ok: false, value: emptyValue(kind) } : { ok: true, value };
}

type Plan = { readonly raw: Raw; readonly path: string; readonly id: string; readonly sensitive: boolean };
type SectionPlan = { readonly raw: Raw; readonly path: string; readonly id: string; readonly fields: Plan[] };

function planSections(sections: readonly unknown[], sink: Sink): { readonly plans: SectionPlan[]; readonly ids: Map<string, { readonly sensitive: boolean }> } {
  const ids = new Map<string, { readonly sensitive: boolean }>();
  const plans: SectionPlan[] = [];
  const seen = new Set<string>();
  let full = false;

  sections.slice(0, LIMITS.sections).forEach((entry, sectionIndex) => {
    const path = `sections[${String(sectionIndex)}]`;
    const raw = asRaw(entry);
    if (raw === undefined) {
      sink.add('bad-section', path, 'A section is an object with a list of fields.');
      return;
    }

    const given = cleanText(member(raw, 'id'), 64);
    let id = given === '' ? `section-${String(sectionIndex + 1)}` : given;
    if (seen.has(id)) {
      sink.add('bad-section', path, `Another section is called ${id}; this one is renamed.`);
      let suffix = 2;
      while (seen.has(`${id}-${String(suffix)}`)) {
        suffix += 1;
      }

      id = `${id}-${String(suffix)}`;
    }

    seen.add(id);
    const list = member(raw, 'fields');
    if (!Array.isArray(list)) {
      sink.add('bad-section', path, 'A section has a list of fields.');
    }

    const fields: Plan[] = [];
    (Array.isArray(list) ? list : []).forEach((candidate: unknown, fieldIndex: number) => {
      const fieldPath = `${path}.fields[${String(fieldIndex)}]`;
      try {
        const field = asRaw(candidate);
        const fieldId = field === undefined ? undefined : member(field, 'id');
        if (field === undefined || typeof fieldId !== 'string' || fieldId === '' || fieldId.length > LIMITS.id || CONTROL.test(fieldId)) {
          sink.add('bad-field', fieldPath, 'A field is an object with an id of printable characters.');
          return;
        }

        if (FORBIDDEN.has(fieldId)) {
          sink.add('forbidden-id', fieldPath, 'That id is the name of a member every object has.');
          return;
        }

        if (ids.has(fieldId)) {
          sink.add('duplicate-id', fieldPath, `Another field is called ${fieldId}; the first is kept.`);
          return;
        }

        if (ids.size >= LIMITS.fields) {
          if (!full) {
            full = true;
            sink.add('too-many-fields', fieldPath, `A form has at most ${String(LIMITS.fields)} fields; the rest are left out.`);
          }

          return;
        }

        const sensitive = member(field, 'kind') === 'secret' || member(field, 'sensitive') === true;
        ids.set(fieldId, { sensitive });
        fields.push({ raw: field, path: fieldPath, id: fieldId, sensitive });
      } catch {
        sink.add('bad-field', fieldPath, 'A field could not be read.');
      }
    });

    plans.push({ raw, path, id, fields });
  });

  return { plans, ids };
}

type Parts = { readonly ids: Ids; readonly sink: Sink; readonly sectionId: string; readonly index: number };

function compileField(plan: Plan, parts: Parts): CompiledField {
  const { raw, path, id, sensitive } = plan;
  const { ids, sink } = parts;
  const add = (code: ProblemCode, sub: string, message: string): void => {
    sink.add(code, sub === '' ? path : `${path}.${sub}`, message);
  };

  const env = (sub: string) => ({ path: `${path}.${sub}`, has: (other: string) => ids.has(other), isSecret: (other: string) => ids.get(other)?.sensitive === true, problems: sink.problems });
  const rawKind = member(raw, 'kind');
  const known = isFieldKind(rawKind);
  const kind: FieldKind | 'unsupported' = known ? rawKind : 'unsupported';
  if (!known) {
    add('unsupported-kind', 'kind', 'This version does not know this kind of field.');
  }

  const secretKind = kind === 'secret';
  const wantsSensitive = sensitive;
  const label = cleanText(member(raw, 'label'), LIMITS.label);
  const condition = (name: 'visibleWhen' | 'enabledWhen'): CompiledCondition | undefined => compileCondition(member(raw, name), env(name));

  const base = {
    id,
    index: parts.index,
    section: parts.sectionId,
    kind,
    rawKind: known ? rawKind : cleanText(rawKind, 64),
    label: label === '' ? id : label,
    help: cleanText(member(raw, 'help'), LIMITS.help),
    hint: cleanText(member(raw, 'hint'), LIMITS.hint),
    placeholder: cleanText(member(raw, 'placeholder'), LIMITS.hint),
    unit: cleanText(member(raw, 'unit'), 16),
    sensitive: wantsSensitive,
    keywords: Object.freeze((Array.isArray(member(raw, 'keywords')) ? (member(raw, 'keywords') as readonly unknown[]) : []).map((word) => cleanText(word, 40)).filter((word) => word !== '').slice(0, LIMITS.keywords)),
    display: cleanText(member(raw, 'display'), 24),
    mono: member(raw, 'mono') === true,
    visible: condition('visibleWhen'),
  };

  if (kind === 'unsupported') {
    return Object.freeze({
      ...base,
      default: undefined,
      required: false,
      constraints: compileConstraints('unsupported', undefined, id, wantsSensitive, ids, () => undefined),
      options: undefined,
      provider: undefined,
      validate: undefined,
      enabled: undefined,
      notes: Object.freeze([]),
      readonly: true,
      restart: 'none' as const,
    });
  }

  const constraints = compileConstraints(kind, member(raw, 'constraints'), id, wantsSensitive, ids, (message, sub, code = 'bad-constraint') => {
    add(code, `constraints.${sub}`, message);
  });

  let options: readonly Option[] | undefined;
  let provider: CompiledProvider | undefined;
  const rawOptions = member(raw, 'options');
  if ((kind === 'select' || kind === 'multiselect') && rawOptions !== undefined) {
    if (Array.isArray(rawOptions)) {
      const compiled: Option[] = [];
      const values = new Set<Json>();
      for (const entry of rawOptions.slice(0, LIMITS.options)) {
        const option = compileOption(entry);
        if (option === undefined) {
          add('bad-options', 'options', 'An option is an object with a value and a label.');
        } else if (values.has(option.value)) {
          add('bad-options', 'options', 'Two options have the same value; the first is kept.');
        } else {
          values.add(option.value);
          compiled.push(option);
        }
      }

      if (rawOptions.length > LIMITS.options) {
        add('bad-options', 'options', `A field has at most ${String(LIMITS.options)} options; the rest are left out.`);
      }

      options = Object.freeze(compiled);
    } else {
      const found = asRaw(rawOptions);
      const name = found === undefined ? undefined : member(found, 'provider');
      if (found === undefined || typeof name !== 'string' || !NAME.test(name)) {
        add('bad-options', 'options', 'Options are a list, or { provider } naming a provider the host registers.');
      } else {
        const limit = member(found, 'limit');
        const params = member(found, 'params');
        provider = Object.freeze({ name, params: params === undefined ? undefined : strictJson(params), limit: whole(limit, 1, Number.MAX_SAFE_INTEGER) ? Math.min(limit, LIMITS.providerRows) : 50 });
      }
    }
  }

  let defaultValue: Json | undefined;
  const rawDefault = member(raw, 'default');
  if (secretKind || wantsSensitive) {
    if (rawDefault !== undefined) {
      add('secret-rule', 'default', 'A secret has no default: nothing that is secret is kept in a schema.');
    }

    defaultValue = undefined;
  } else if (rawDefault === undefined) {
    defaultValue = emptyValue(kind);
  } else {
    const result = compileDefault(kind, rawDefault, options);
    if (!result.ok) {
      add('bad-default', 'default', 'The default does not fit the kind of this field.');
    }

    defaultValue = result.value;
  }

  let validate: CompiledRemote | undefined;
  const rawValidate = member(raw, 'validate');
  if (rawValidate !== undefined) {
    const found = asRaw(rawValidate);
    const name = found === undefined ? undefined : member(found, 'remote');
    if (found === undefined || typeof name !== 'string' || !NAME.test(name)) {
      add('bad-validate', 'validate', 'A remote check names a validator the host registers.');
    } else if (wantsSensitive) {
      add('secret-rule', 'validate', 'A secret is handed to nothing but the submit callback: no remote check.');
    } else {
      const on = member(found, 'on');
      if (on !== undefined && on !== 'commit' && on !== 'change') {
        add('bad-validate', 'validate.on', 'on is commit or change.');
      }

      const debounce = member(found, 'debounce');
      const timeout = member(found, 'timeout');
      const depends = member(found, 'dependsOn');
      validate = Object.freeze({
        remote: name,
        on: on === 'change' ? 'change' : 'commit',
        debounce: finite(debounce) ? Math.min(10_000, Math.max(0, Math.round(debounce))) : 400,
        timeout: finite(timeout) ? Math.min(60_000, Math.max(100, Math.round(timeout))) : 10_000,
        dependsOn: Object.freeze((Array.isArray(depends) ? depends : []).filter((other): other is string => typeof other === 'string' && other !== id && ids.has(other) && ids.get(other)?.sensitive !== true).slice(0, 8)),
        checking: cleanText(member(found, 'checking'), LIMITS.message),
      });
    }
  }

  const notes: CompiledNote[] = [];
  const rawNotes = member(raw, 'notes');
  for (const [at, entry] of (Array.isArray(rawNotes) ? rawNotes : []).entries()) {
    const found = asRaw(entry);
    const text = found === undefined ? '' : cleanText(member(found, 'text'), LIMITS.text);
    if (found === undefined || text === '' || notes.length >= LIMITS.notes) {
      continue;
    }

    const before = sink.problems.length;
    const when = compileCondition(member(found, 'when') ?? true, env(`notes[${String(at)}].when`));
    // A note that cannot be read is left out, not shown: a warning that is wrong is worse than none.
    if (when === undefined || sink.problems.length > before) {
      continue;
    }

    notes.push(Object.freeze({ when, kind: member(found, 'kind') === 'warning' ? ('warning' as const) : ('info' as const), text }));
  }

  const rawRestart = member(raw, 'restart');
  return Object.freeze({
    ...base,
    default: defaultValue,
    required: constraints.required,
    constraints,
    options,
    provider,
    validate,
    enabled: condition('enabledWhen'),
    notes: Object.freeze(notes),
    readonly: member(raw, 'readonly') === true,
    restart: rawRestart === 'plugin' ? ('plugin' as const) : rawRestart === true || rawRestart === 'app' ? ('app' as const) : ('none' as const),
  });
}

function addReads(map: Map<string, Reads[]>, key: string, entry: Reads): void {
  const list = map.get(key) ?? [];
  if (!list.some((existing) => existing.target === entry.target && existing.slot === entry.slot)) {
    list.push(entry);
  }

  map.set(key, list);
}

function compileUnsafe(raw: unknown, options: CompileOptions): CompileResult {
  const top = asRaw(raw);
  if (top === undefined) {
    return { ok: false, reason: 'unreadable', detail: 'A schema is an object with sections.' };
  }

  const wrote = member(top, 'version');
  let version = wrote === undefined ? SCHEMA_VERSION : wrote;
  if (!whole(version, 0, Number.MAX_SAFE_INTEGER)) {
    return { ok: false, reason: 'unreadable', detail: 'The version of a schema is a whole number.' };
  }

  if (version > SCHEMA_VERSION) {
    return { ok: false, reason: 'foreign-version', detail: `This build reads schema version ${String(SCHEMA_VERSION)}; this one is version ${String(version)}. Update Omniview.` };
  }

  let working: Raw = top;
  const steps = options.migrations ?? MIGRATIONS;
  while (version < SCHEMA_VERSION) {
    const step = Object.hasOwn(steps, version) ? steps[version] : undefined;
    if (step === undefined) {
      return { ok: false, reason: 'foreign-version', detail: `This build cannot bring schema version ${String(version)} up to ${String(SCHEMA_VERSION)}.` };
    }

    let next: unknown;
    try {
      next = step(working);
    } catch {
      return { ok: false, reason: 'unreadable', detail: `The step from schema version ${String(version)} failed.` };
    }

    const found = asRaw(next);
    if (found === undefined) {
      return { ok: false, reason: 'unreadable', detail: `The step from schema version ${String(version)} did not answer a schema.` };
    }

    working = found;
    version += 1;
  }

  const sections = member(working, 'sections');
  if (!Array.isArray(sections)) {
    return { ok: false, reason: 'unreadable', detail: 'A schema has a list of sections.' };
  }

  const sink = makeSink();
  const { plans, ids } = planSections(sections, sink);
  let order = 0;
  const compiledSections: CompiledSection[] = [];
  const all: CompiledField[] = [];
  const index = new Map<string, CompiledField>();
  const readers = new Map<string, Reads[]>();
  const ctxReaders = new Map<string, Reads[]>();
  const dependents = new Map<string, string[]>();

  const listReads = (condition: CompiledCondition | undefined, entry: Reads): void => {
    for (const id of condition?.fields ?? []) {
      addReads(readers, id, entry);
    }

    for (const key of condition?.ctx ?? []) {
      addReads(ctxReaders, key, entry);
    }
  };

  for (const plan of plans) {
    const visible = compileCondition(member(plan.raw, 'visibleWhen'), { path: `${plan.path}.visibleWhen`, has: (id) => ids.has(id), isSecret: (id) => ids.get(id)?.sensitive === true, problems: sink.problems });
    const fields: CompiledField[] = [];
    for (const fieldPlan of plan.fields) {
      let field: CompiledField;
      try {
        field = compileField(fieldPlan, { ids, sink, sectionId: plan.id, index: order });
      } catch {
        sink.add('bad-field', fieldPlan.path, 'A field could not be read.');
        ids.delete(fieldPlan.id);
        continue;
      }

      order += 1;
      fields.push(field);
      all.push(field);
      index.set(field.id, field);
    }

    listReads(visible, { target: plan.id, slot: 'section' });
    for (const field of fields) {
      listReads(field.visible, { target: field.id, slot: 'visible' });
      listReads(field.enabled, { target: field.id, slot: 'enabled' });
      for (const note of field.notes) {
        listReads(note.when, { target: field.id, slot: 'notes' });
      }

      for (const other of [field.constraints.sameAs, ...(field.validate?.dependsOn ?? [])]) {
        if (other !== undefined) {
          const list = dependents.get(other) ?? [];
          if (!list.includes(field.id)) {
            list.push(field.id);
          }

          dependents.set(other, list);
        }
      }
    }

    compiledSections.push(Object.freeze({
      id: plan.id,
      label: cleanText(member(plan.raw, 'label'), LIMITS.label),
      help: cleanText(member(plan.raw, 'help'), LIMITS.help),
      collapsed: member(plan.raw, 'collapsed') === true,
      visible,
      fields: Object.freeze(fields),
    }));
  }

  const id = cleanText(member(working, 'id'), 128);
  return {
    ok: true,
    schema: Object.freeze({
      id: id === '' ? 'form' : id,
      version: SCHEMA_VERSION,
      sections: Object.freeze(compiledSections),
      fields: Object.freeze(all),
      index,
      readers,
      ctxReaders,
      dependents,
    }),
    problems: Object.freeze(sink.problems),
  };
}

/** Reads a schema. `ok: false` says why it cannot be used (`unreadable`, or `foreign-version` for a version this build cannot bring up or read); otherwise the compiled schema and what was left out. Never throws. */
export function compileSchema(raw: unknown, options: CompileOptions = {}): CompileResult {
  try {
    return compileUnsafe(raw, options);
  } catch {
    return { ok: false, reason: 'unreadable', detail: 'The schema could not be read.' };
  }
}
