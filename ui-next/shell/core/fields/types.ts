import type { Json } from '../tabs/types';

// The form field model's data, and the seams it calls through (design lab ch16 S124 to S132, ch04 section 3 "Validation timing and outcome", VL1, DR1; the host's settings contract,
// `backend/pkg/settings/service.go`). Plain data only: no React, no DOM, nothing a plugin owns. A SCHEMA is what a plugin or the host declares (plain JSON, no functions); the model
// COMPILES it once (`schema.ts`) and a STORE (`store.ts`) holds the values and answers a frozen snapshot: one `FieldState` per field, which a view draws and which carries every state
// a row can be in (the lab's twelve: default, modified, invalid, warning, checking, couldn't check, saved, apply failed, restart, set by environment, disabled, read-only).

export type { Json };

/** The version of the SCHEMA FORMAT this build reads. A newer kind or member is a MINOR addition (an older build degrades it, `unsupported`); a changed meaning is a new version. */
export const SCHEMA_VERSION = 1;

/** The version of a saved draft (`serialise`) and of a snapshot. */
export const FORM_VERSION = 1;

/** The closed list of kinds. A kind a schema names that is not here becomes an `unsupported` entry: read-only, never submitted, never a crash. */
export const FIELD_KINDS = ['text', 'number', 'boolean', 'select', 'multiselect', 'path', 'url', 'color', 'secret', 'list'] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];
export const isFieldKind = (value: unknown): value is FieldKind => typeof value === 'string' && (FIELD_KINDS as readonly string[]).includes(value);

/** What a kind's value is. `secret` has none the model ever shows: see `SecretState`. */
export type Scalar = string | number | boolean;

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The schema: what a plugin or the host writes. Every member but `id` and `kind` is optional. Unknown members are ignored (a newer schema), never an error.
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

/** One choice. `value` is what is stored; `label` is what is shown. */
export type Option = { readonly value: Scalar; readonly label: string; readonly description?: string | undefined; readonly disabled?: boolean | string | undefined };

/** Options that are too many to list come from a PROVIDER the host registers by name: asked with the query, aborted when the query moves on, bounded (see `OptionProvider`). */
export type OptionsSource = readonly Option[] | { readonly provider: string; readonly params?: Json | undefined; readonly limit?: number | undefined };

/** The comparisons a condition makes with a value. Several on one leaf all have to hold. A sensitive field takes only `empty`: a condition must not be able to probe a secret. */
export type Comparison = {
  readonly equals?: Scalar | undefined;
  readonly notEquals?: Scalar | undefined;
  readonly in?: readonly Scalar[] | undefined;
  readonly notIn?: readonly Scalar[] | undefined;
  /** The value is a list that holds this. */
  readonly has?: Scalar | undefined;
  /** The value is empty (an empty text, an empty list, nothing): `true`, or not: `false`. A secret is empty when it is not set. */
  readonly empty?: boolean | undefined;
  readonly gt?: number | undefined;
  readonly gte?: number | undefined;
  readonly lt?: number | undefined;
  readonly lte?: number | undefined;
  readonly startsWith?: string | undefined;
};

/**
 * A declarative condition over other fields' values and the host's context flags (`developer`, `platform`): data, never a function. `reason` is the sentence a disabled field shows
 * when this node is what failed (DR1: a disabled control says why, as visible text).
 */
export type Condition =
  | boolean
  | (Comparison & { readonly field: string; readonly reason?: string | undefined })
  | (Comparison & { readonly ctx: string; readonly reason?: string | undefined })
  | { readonly all: readonly Condition[]; readonly reason?: string | undefined }
  | { readonly any: readonly Condition[]; readonly reason?: string | undefined }
  | { readonly not: Condition; readonly reason?: string | undefined };

/** The declarative checks of a value. What a kind does not use is ignored. `messages` replaces a built-in sentence (at most 80 characters, "Problem. Fix."). */
export type Constraints = {
  readonly required?: boolean | undefined;
  /** text, secret, url, path, color. */
  readonly minLength?: number | undefined;
  readonly maxLength?: number | undefined;
  /** A JavaScript regular expression, tested against the whole value (flag `u`). At most `LIMITS.pattern` characters. */
  readonly pattern?: string | undefined;
  /** Characters that may be typed: `digits hex color header hostport dns`, or a regular expression class such as `[a-z0-9-]`. A character outside it is an error at once, and the view may refuse it (`allows`). */
  readonly allowedChars?: string | undefined;
  /** text: `datetime` is RFC 3339. */
  readonly format?: 'datetime' | undefined;
  /** number. */
  readonly min?: number | undefined;
  readonly max?: number | undefined;
  readonly step?: number | undefined;
  readonly integer?: boolean | undefined;
  /** multiselect and list. */
  readonly minItems?: number | undefined;
  readonly maxItems?: number | undefined;
  readonly unique?: boolean | undefined;
  /** list: what its items are. */
  readonly item?: 'text' | 'path' | 'url' | undefined;
  /** path: `file` (default) or `directory`; `absolute` demands a path that starts with `/`, `~` or a drive. */
  readonly pathKind?: 'file' | 'directory' | undefined;
  readonly absolute?: boolean | undefined;
  readonly extensions?: readonly string[] | undefined;
  /** The value must equal another field's (a confirmation). Not for a sensitive field to a visible one. */
  readonly sameAs?: string | undefined;
  readonly messages?: Readonly<Partial<Record<IssueCode, string>>> | undefined;
};

/** The host's own check: a validator the host registers by name (`FormOptions.validators`); it is asked on commit (default) or, debounced, while the value changes. Never for a sensitive field. */
export type RemoteValidation = {
  readonly remote: string;
  readonly on?: 'commit' | 'change' | undefined;
  readonly debounce?: number | undefined;
  readonly timeout?: number | undefined;
  /** The fields whose change asks again. */
  readonly dependsOn?: readonly string[] | undefined;
  /** What the lane says while it runs ("Looking for the shell…"). */
  readonly checking?: string | undefined;
};

/** A standing warning or note about a value that is true now ("Certificates aren't checked."): shown when `when` holds, never blocks. */
export type Note = { readonly when: Condition; readonly kind?: 'warning' | 'info' | undefined; readonly text: string };

export type FieldSpec = {
  /** Unique in the schema; opaque (a plugin's ids may contain dots). */
  readonly id: string;
  /** One of `FIELD_KINDS`. Anything else degrades to `unsupported`. */
  readonly kind: string;
  readonly label?: string | undefined;
  /** One sentence under the label (the SDK's `description`). */
  readonly help?: string | undefined;
  /** The short line in the message lane when nothing else is said ("1 to 300 seconds"). */
  readonly hint?: string | undefined;
  readonly placeholder?: string | undefined;
  readonly unit?: string | undefined;
  readonly default?: Json | undefined;
  readonly constraints?: Constraints | undefined;
  readonly options?: OptionsSource | undefined;
  readonly validate?: RemoteValidation | undefined;
  readonly visibleWhen?: Condition | undefined;
  readonly enabledWhen?: Condition | undefined;
  readonly notes?: readonly Note[] | undefined;
  readonly sensitive?: boolean | undefined;
  /** Shown but not editable (a fact): `readonly`, never `disabled` (ch14 F-4). */
  readonly readonly?: boolean | undefined;
  /** The change applies after a restart of Omniview (`true`, `app`) or of the plugin (`plugin`). */
  readonly restart?: boolean | 'app' | 'plugin' | undefined;
  readonly keywords?: readonly string[] | undefined;
  /** Presentation hints the view may follow and may ignore: `multiline`, `slider`, `segmented`, `cards`, `switch`, `checkbox`. */
  readonly display?: string | undefined;
  readonly mono?: boolean | undefined;
};

export type SectionSpec = {
  readonly id?: string | undefined;
  readonly label?: string | undefined;
  readonly help?: string | undefined;
  /** Rare advanced groups start collapsed (ch04: sections stay flat). */
  readonly collapsed?: boolean | undefined;
  readonly visibleWhen?: Condition | undefined;
  readonly fields: readonly FieldSpec[];
};

export type FormSchema = {
  /** The schema format version; absent is 1. */
  readonly version?: number | undefined;
  readonly id?: string | undefined;
  readonly sections: readonly SectionSpec[];
};

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// Messages and issues
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

/** The codes of the model's own sentences. A remote check and a host rejection have `remote` and `rejected`. */
export const ISSUE_CODES = [
  'required',
  'type',
  'chars',
  'min-length',
  'max-length',
  'pattern',
  'format',
  'not-a-number',
  'not-an-integer',
  'min',
  'max',
  'step',
  'not-an-option',
  'min-items',
  'max-items',
  'duplicate',
  'path',
  'url',
  'color',
  'same-as',
  'remote',
  'rejected',
] as const;
export type IssueCode = (typeof ISSUE_CODES)[number];

/** How early an issue is told (ch04): `now` at once (an illegal character, a value past its maximum), `complete` once the value was committed (blur, Enter) or a submit was tried, `required` only after a submit or after the field was edited and committed. */
export type IssueWhen = 'now' | 'complete' | 'required';

export type Issue = {
  readonly code: IssueCode;
  /** At most 80 characters: "Problem. Fix." (S127). */
  readonly text: string;
  /** What did not fit in the lane: the tooltip and `aria-describedby`. */
  readonly detail?: string | undefined;
  readonly severity: 'error' | 'warning';
  readonly source: 'local' | 'remote' | 'host';
};

/** The ONE message a field's lane shows, chosen in the order of S127. */
export type FieldMessage = {
  readonly kind: 'error' | 'warning' | 'checking' | 'retry' | 'saved' | 'restart' | 'info' | 'hint';
  readonly text: string;
  readonly detail?: string | undefined;
  readonly code?: IssueCode | undefined;
  /** `checking` for the loader's time (1 s): the view draws its loader only now. */
  readonly slow?: boolean | undefined;
  /** `retry`: the lane offers Retry; `failed` apply is `error` with Retry too. */
  readonly retry?: boolean | undefined;
};

/** A reason a field cannot be edited, and who says so. */
export type Lock = {
  readonly reason: string;
  readonly source: 'environment' | 'managed' | 'plugin' | 'store' | 'condition';
  /** `readonly` (selectable, a fact) or disabled (unavailable). */
  readonly readonly: boolean;
};

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The snapshot
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * What a view may know of a secret: whether one is saved, and whether the user has typed (or cleared) one. NEVER its value, not in a snapshot, a saved draft, a message or a log; the
 * value goes to the submit callback and nowhere else, and is dropped on submit, revert and dispose.
 */
export type SecretState = { readonly presence: 'set' | 'unset'; readonly changed: boolean };

export type OptionsState = {
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly query: string;
  /** How many there are in all, when the provider says and returned fewer. */
  readonly total?: number | undefined;
  readonly message?: string | undefined;
};

/** The display facts a view needs of a field's constraints. */
export type FieldSpecView = {
  readonly unit: string;
  readonly min?: number | undefined;
  readonly max?: number | undefined;
  readonly step?: number | undefined;
  readonly integer: boolean;
  readonly maxLength?: number | undefined;
  readonly pathKind?: 'file' | 'directory' | undefined;
  readonly extensions: readonly string[];
  readonly item?: 'text' | 'path' | 'url' | undefined;
  readonly display: string;
  readonly mono: boolean;
  /** The field is asked of the host: a check is declared. */
  readonly remote: boolean;
};

export type FieldState = {
  readonly id: string;
  /** `unsupported` for a kind this build does not know. */
  readonly kind: FieldKind | 'unsupported';
  readonly label: string;
  readonly help: string;
  readonly placeholder: string;
  readonly section: string;
  readonly spec: FieldSpecView;
  readonly visible: boolean;
  /** False: unavailable (a condition, a form lock, an unsupported kind). The reason is `lock`. */
  readonly enabled: boolean;
  /** True: shown as a fact (schema `readonly`, an environment variable, a managed value, an unsupported kind). */
  readonly readonly: boolean;
  readonly lock: Lock | undefined;
  readonly required: boolean;
  readonly sensitive: boolean;
  /** The draft. Absent for a secret (`secret` says what a view may know) and for `unsupported`. */
  readonly value?: Json | undefined;
  readonly default?: Json | undefined;
  readonly secret?: SecretState | undefined;
  /** The draft differs from the applied value (a secret: the user typed or cleared one). */
  readonly dirty: boolean;
  /** The value differs from the default: the reset marker (S126). */
  readonly modified: boolean;
  /** The user left the field or committed it. */
  readonly touched: boolean;
  /** The user changed it at least once since the form opened or was reverted. */
  readonly edited: boolean;
  readonly options?: readonly Option[] | undefined;
  readonly optionsState?: OptionsState | undefined;
  /** For a field whose options come from a provider: the options of the value that is chosen, from what the model has seen, so a list that is not open can still say what is chosen. */
  readonly selected?: readonly Option[] | undefined;
  /** A check or a change that was handed to the host has not finished. */
  readonly busy: boolean;
  /** The one message of the lane, or `undefined`. */
  readonly message: FieldMessage | undefined;
  /** Every issue that is told now (a view may list them for `aria-describedby`). */
  readonly issues: readonly Issue[];
  readonly validation: 'idle' | 'checking' | 'valid' | 'invalid' | 'unreachable';
  /** The restart a change needs, and whether it is waiting for one. */
  readonly restart: 'none' | 'app' | 'plugin';
  readonly pendingRestart: boolean;
  /** `unsupported`: what to say ("Not supported in this version.") and the kind as the schema wrote it. */
  readonly unsupported?: { readonly kind: string; readonly text: string } | undefined;
};

export type SectionState = {
  readonly id: string;
  readonly label: string;
  readonly help: string;
  readonly collapsed: boolean;
  readonly visible: boolean;
  readonly fields: readonly string[];
  /** Visible fields with an issue that is told, and fields that differ: the navigation marks a page with them (ch04: multi-page forms). */
  readonly invalid: number;
  readonly dirty: number;
};

/** What the host said about the whole form, as data (never the raw error): the apperror's title and sentence, bounded and cleaned. */
export type FormIssue = {
  readonly kind: 'error' | 'warning';
  readonly title: string;
  readonly text: string;
  readonly suggestions: readonly string[];
  readonly actions: readonly FormAction[];
  readonly recovery?: string | undefined;
  readonly requestId?: string | undefined;
  readonly code?: string | undefined;
};

export type FormAction = { readonly type: 'retry' | 'navigate' | 'open-url' | 'copy'; readonly label: string; readonly target?: string | undefined };

export type SubmitStatus = 'idle' | 'submitting' | 'succeeded' | 'failed';

export type SubmitState = {
  readonly status: SubmitStatus;
  /** A submit was tried (an invalid one counts): required fields now say so. */
  readonly attempted: boolean;
  readonly attempts: number;
  /** After a success the host may say more ("Saved, but not applied. Restart Omniview."). */
  readonly notice?: { readonly kind: 'info' | 'warning'; readonly text: string } | undefined;
};

export type FormClass = 'simple' | 'complex';

export type FormMode = 'apply-on-change' | 'explicit';

export type FormState = {
  readonly version: typeof FORM_VERSION;
  readonly mode: FormMode;
  readonly schema: { readonly id: string; readonly version: number };
  readonly fields: readonly FieldState[];
  readonly sections: readonly SectionState[];
  readonly dirty: boolean;
  readonly dirtyIds: readonly string[];
  /** Fields with an issue that is told and blocks. */
  readonly invalidIds: readonly string[];
  /** Fields whose check is running. */
  readonly pendingIds: readonly string[];
  /** The ids that wait for a restart. */
  readonly pendingRestart: readonly string[];
  /** Simple: at most three inputs and nothing else, so confirmation waits for the required values (ch04); complex: confirmation stays enabled so a submit can say what is missing. */
  readonly class: FormClass;
  readonly canSubmit: boolean;
  /** Why `canSubmit` is false, as visible text (DR1); empty otherwise. */
  readonly submitBlocked: string;
  /** The field to focus after an invalid submit; empty otherwise. */
  readonly firstInvalid: string;
  readonly submit: SubmitState;
  readonly issues: readonly FormIssue[];
  readonly lock: Lock | undefined;
};

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The seams
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

/** What a remote check answers: the host's `ValidationResult` (`{ valid, code, message }`). `valid` with a `message` is a note ("Go executable verified: 1.24.2."); `retry` is "couldn't check". */
export type RemoteResult = { readonly valid: boolean; readonly code?: string | undefined; readonly message?: string | undefined; readonly retry?: boolean | undefined };

export type RemoteRequest = {
  readonly id: string;
  readonly value: Json;
  /** The visible, non-sensitive values of the form: what a check may depend on. */
  readonly values: Readonly<Record<string, Json>>;
  readonly signal: AbortSignal;
};

/** Throwing, rejecting or taking longer than the timeout is "couldn't check", not "invalid". */
export type RemoteValidator = (request: RemoteRequest) => Promise<RemoteResult> | RemoteResult;

export type OptionAnswer = readonly Option[] | { readonly options: readonly Option[]; readonly total?: number | undefined; readonly message?: string | undefined };

export type OptionRequest = { readonly id: string; readonly query: string; readonly params: Json | undefined; readonly limit: number; readonly values: Readonly<Record<string, Json>>; readonly signal: AbortSignal };
export type OptionProvider = (request: OptionRequest) => Promise<OptionAnswer>;

/** What the submit callback gets: the values it may send, secrets included (the one place they go). */
export type SubmitPayload = {
  readonly mode: FormMode;
  readonly values: Readonly<Record<string, Json>>;
  /** The ids whose values differ from the applied ones. */
  readonly changed: readonly string[];
  readonly signal: AbortSignal;
};

/**
 * What the callback answers. Nothing or `{ ok: true }` accepts the submitted values. `values` supplies canonical values, or `null` if the write succeeded but its values could not
 * be read back. In that case the form keeps its last confirmed values. `notice` is what the host says about a success. `{ ok: false, errors, message }` is a rejection with the
 * reasons by field id. A thrown or rejected value is a host error: the apperror JSON, a `RuntimeError`, or anything: `errors.ts` reads it.
 */
export type SubmitOutcome =
  | void
  | { readonly ok: true; readonly values?: Readonly<Record<string, Json>> | null | undefined; readonly notice?: { readonly kind: 'info' | 'warning'; readonly text: string } | undefined }
  | { readonly ok: false; readonly errors?: Readonly<Record<string, string>> | undefined; readonly message?: string | undefined };

export type SubmitFn = (payload: SubmitPayload) => Promise<SubmitOutcome> | SubmitOutcome;

export type Scheduler = {
  readonly now: () => number;
  readonly setTimeout: (callback: () => void, ms: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
};

/** Hears a failure of a plugin's or the host's code. It gets a cleaned copy (never the raw error, which may carry a secret). */
export type ErrorHook = (error: { readonly name: string; readonly message: string }, where: string) => void;

export type Timing = {
  /** Quiet time after a change before a remote check declared `on: 'change'`. */
  readonly debounce: number;
  /** Quiet time after a query before the option provider is asked. */
  readonly options: number;
  /** A remote check that has not answered by then "couldn't check". */
  readonly timeout: number;
  readonly optionsTimeout: number;
  /** The loader appears after this long (ch 05: progress only for work that lasts more than a second). */
  readonly loader: number;
  /** "Saved" stays this long (S127). */
  readonly saved: number;
};

export const TIMING: Timing = Object.freeze({ debounce: 400, options: 150, timeout: 10_000, optionsTimeout: 5_000, loader: 1_000, saved: 2_000 });

export const LIMITS = Object.freeze({
  /** Fields in one schema. */
  fields: 2_000,
  sections: 200,
  id: 256,
  label: 120,
  help: 400,
  hint: 160,
  /** A message of the lane (S127). */
  message: 80,
  /** Any other text the schema carries. */
  text: 400,
  /** A text value, in characters. */
  value: 65_536,
  /** The longest input a `pattern` is run on. */
  patternInput: 4_096,
  pattern: 256,
  options: 5_000,
  /** Rows kept from an option provider. */
  providerRows: 200,
  items: 1_000,
  conditionDepth: 8,
  conditionNodes: 64,
  notes: 4,
  keywords: 16,
  problems: 100,
  /** Remote checks and option queries in flight at once. */
  inFlight: 4,
  /** Rounds a change may cascade through the conditions (a cycle of secrets that clear each other). */
  rounds: 4,
  /** Fields of a host error that are read. */
  hostFields: 100,
});

export type ProblemCode =
  | 'unreadable'
  | 'foreign-version'
  | 'bad-section'
  | 'bad-field'
  | 'duplicate-id'
  | 'forbidden-id'
  | 'too-many-fields'
  | 'unsupported-kind'
  | 'bad-default'
  | 'bad-constraint'
  | 'bad-options'
  | 'bad-condition'
  | 'unknown-field'
  | 'unknown-operator'
  | 'secret-rule'
  | 'bad-validate'
  | 'newer-version'
  | 'truncated';

export type Problem = { readonly code: ProblemCode; readonly path: string; readonly message: string };

export type FormStats = {
  /** Conditions evaluated (visible, enabled, notes). */
  readonly conditions: number;
  /** Local checks of a field's value. */
  readonly validations: number;
  /** Remote checks started. */
  readonly remote: number;
  /** Field states built. */
  readonly built: number;
  /** Listener calls. */
  readonly notified: number;
  /** Secrets the model holds right now: a count, never a value. */
  readonly secrets: number;
};

export type PersistedForm = { readonly version: typeof FORM_VERSION; readonly schema: string; readonly values: Readonly<Record<string, Json>> };

export type RefusedReason = 'unknown-field' | 'unsupported' | 'hidden' | 'locked' | 'type' | 'busy' | 'disposed' | 'mode';

/** What `setValue`, `reset` and `revert` of a field answer. A switch, a choice and a list apply at once in a form that applies on change: then `commit` says how it went. */
export type SetResult =
  | { readonly status: 'set'; readonly commit?: Promise<CommitResult> | undefined }
  | { readonly status: 'noop' }
  | { readonly status: 'refused'; readonly reason: RefusedReason };

/**
 * How a commit (Enter, blur, retry) went. In a form that applies on change: `applied` (the host took it), `same` (nothing to do), `invalid` (the value is wrong, here or by the host's
 * check or reply), `unchecked` (a check could not be made), `failed` (the host could not apply it), `stale` (a newer value or a revert replaced it). In a form that is submitted as a
 * whole a commit only tells the checks: `checked`, `invalid`, `unchecked`.
 */
export type CommitResult =
  | { readonly status: 'applied' | 'same' | 'checked' | 'invalid' | 'unchecked' | 'failed' | 'stale' }
  | { readonly status: 'refused'; readonly reason: RefusedReason };

export type SubmitResult =
  | { readonly status: 'succeeded' | 'noop' | 'failed' }
  | { readonly status: 'invalid'; readonly firstInvalid: string; readonly invalid: readonly string[] }
  | { readonly status: 'refused'; readonly reason: RefusedReason };
