import { isObject } from '../tabs/json';
import { cleanText } from './text';
import { LIMITS, type Json, type Problem } from './types';

// Conditions: the declarative rules a schema uses to say when a field or a section is visible, when it can be edited, and when a note applies. A condition is DATA (a boolean, a
// comparison of one field or one host flag, `all`, `any`, `not`), never a function, so it can be written by a plugin in another language, saved, compared and checked. It is compiled
// once: what it reads is listed (`fields`, `ctx`), so a change of one value re-runs only the conditions that read it. A condition this build cannot read (an unknown field, an
// operator from a newer schema) is a problem and holds: a field is not hidden or locked for something this build does not understand, and the host validates on commit anyway.

type Op = 'equals' | 'notEquals' | 'in' | 'notIn' | 'has' | 'empty' | 'gt' | 'gte' | 'lt' | 'lte' | 'startsWith';
type Test = { readonly op: Op; readonly arg: Json };

type Node =
  | { readonly t: 'const'; readonly v: boolean; readonly reason: string }
  | { readonly t: 'all' | 'any'; readonly items: readonly Node[]; readonly reason: string }
  | { readonly t: 'not'; readonly item: Node; readonly reason: string }
  | { readonly t: 'cmp'; readonly source: 'field' | 'ctx'; readonly key: string; readonly tests: readonly Test[]; readonly reason: string };

export type CompiledCondition = {
  readonly node: Node;
  /** The fields it reads, once each, in the order they first appear. */
  readonly fields: readonly string[];
  /** The host flags it reads. */
  readonly ctx: readonly string[];
};

/** What a condition may ask of the form: the values, whether one is empty (the only thing a secret can be asked), and the host's flags. */
export type Reader = {
  readonly value: (id: string) => Json | undefined;
  readonly empty: (id: string) => boolean;
  readonly ctx: (key: string) => Json | undefined;
};

export type ConditionEnv = {
  /** Where the condition is, for a problem's path. */
  readonly path: string;
  readonly has: (id: string) => boolean;
  readonly isSecret: (id: string) => boolean;
  readonly problems: Problem[];
};

const OPS: readonly Op[] = ['equals', 'notEquals', 'in', 'notIn', 'has', 'empty', 'gt', 'gte', 'lt', 'lte', 'startsWith'];
const HEADS = ['all', 'any', 'not', 'field', 'ctx'] as const;
const KEYS = new Set<string>([...HEADS, ...OPS, 'reason']);

const isScalar = (value: unknown): value is string | number | boolean => typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));

const fine = (): Node => ({ t: 'const', v: true, reason: '' });

function operandOf(op: Op, raw: unknown): Json | undefined {
  switch (op) {
    case 'equals':
    case 'notEquals':
    case 'has':
      return isScalar(raw) ? raw : undefined;
    case 'in':
    case 'notIn':
      return Array.isArray(raw) && raw.length <= 256 && raw.every(isScalar) ? (raw) : undefined;
    case 'empty':
      return typeof raw === 'boolean' ? raw : undefined;
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
    case 'startsWith':
      return typeof raw === 'string' ? raw : undefined;
  }
}

/** The condition as a tree that can be evaluated and whose reads are listed; `undefined` for no condition at all. Never throws. */
export function compileCondition(raw: unknown, env: ConditionEnv): CompiledCondition | undefined {
  if (raw === undefined) {
    return undefined;
  }

  const fields: string[] = [];
  const ctx: string[] = [];
  let nodes = 0;

  const problem = (code: 'bad-condition' | 'unknown-field' | 'unknown-operator' | 'secret-rule', message: string): void => {
    if (env.problems.length < LIMITS.problems) {
      env.problems.push({ code, path: env.path, message });
    }
  };

  const compileNode = (value: unknown, depth: number): Node => {
    nodes += 1;
    if (nodes > LIMITS.conditionNodes) {
      if (nodes === LIMITS.conditionNodes + 1) {
        problem('bad-condition', `A condition has at most ${String(LIMITS.conditionNodes)} parts; the rest are ignored.`);
      }

      return fine();
    }

    if (typeof value === 'boolean') {
      return { t: 'const', v: value, reason: '' };
    }

    if (!isObject(value) || Array.isArray(value)) {
      problem('bad-condition', 'A condition is true, false or an object.');
      return fine();
    }

    if (depth > LIMITS.conditionDepth) {
      problem('bad-condition', `A condition is nested at most ${String(LIMITS.conditionDepth)} deep; the rest is ignored.`);
      return fine();
    }

    const reason = cleanText(value.reason, LIMITS.text);
    const heads = HEADS.filter((head) => Object.hasOwn(value, head));
    if (heads.length !== 1) {
      problem('bad-condition', heads.length === 0 ? 'A condition names all, any, not, field or ctx.' : 'A condition names one of all, any, not, field and ctx.');
      return fine();
    }

    const head = heads[0];
    if (head === 'all' || head === 'any') {
      const list = value[head];
      if (!Array.isArray(list)) {
        problem('bad-condition', `${head} is a list of conditions.`);
        return fine();
      }

      return { t: head, items: list.map((item) => compileNode(item, depth + 1)), reason };
    }

    if (head === 'not') {
      return { t: 'not', item: compileNode(value.not, depth + 1), reason };
    }

    const key = value[head];
    if (typeof key !== 'string' || key === '' || key.length > LIMITS.id) {
      problem('bad-condition', `${head} names a ${head === 'field' ? 'field' : 'flag'} by its id.`);
      return fine();
    }

    if (head === 'field' && !env.has(key)) {
      problem('unknown-field', 'A condition reads a field that this form does not have.');
      return fine();
    }

    const operators = Object.keys(value).filter((name) => !KEYS.has(name) || (OPS as readonly string[]).includes(name));
    if (operators.some((name) => !(OPS as readonly string[]).includes(name))) {
      problem('unknown-operator', 'A condition uses a comparison this version does not know.');
      return fine();
    }

    const secret = head === 'field' && env.isSecret(key);
    const tests: Test[] = [];
    for (const name of operators as readonly Op[]) {
      const arg = operandOf(name, value[name]);
      if (arg === undefined) {
        problem('bad-condition', `${name} needs plain data of the right kind.`);
        return fine();
      }

      if (secret && name !== 'empty') {
        problem('secret-rule', 'A condition can only ask whether a secret is empty.');
        continue;
      }

      tests.push({ op: name, arg });
    }

    if (tests.length === 0) {
      if (operators.length === 0) {
        problem('bad-condition', 'A comparison names what to compare with.');
      }

      return fine();
    }

    const list = head === 'field' ? fields : ctx;
    if (!list.includes(key)) {
      list.push(key);
    }

    return { t: 'cmp', source: head, key, tests, reason };
  };

  const node = compileNode(raw, 0);
  return Object.freeze({ node, fields: Object.freeze(fields), ctx: Object.freeze(ctx) });
}

function check(test: Test, value: Json | undefined): boolean {
  const { op, arg } = test;
  switch (op) {
    case 'equals':
      return value === arg;
    case 'notEquals':
      return value !== arg;
    case 'in':
      return Array.isArray(arg) && arg.some((item) => item === value);
    case 'notIn':
      return !(Array.isArray(arg) && arg.some((item) => item === value));
    case 'has':
      return Array.isArray(value) && value.some((item) => item === arg);
    case 'gt':
      return typeof value === 'number' && typeof arg === 'number' && value > arg;
    case 'gte':
      return typeof value === 'number' && typeof arg === 'number' && value >= arg;
    case 'lt':
      return typeof value === 'number' && typeof arg === 'number' && value < arg;
    case 'lte':
      return typeof value === 'number' && typeof arg === 'number' && value <= arg;
    case 'startsWith':
      return typeof value === 'string' && typeof arg === 'string' && value.startsWith(arg);
    case 'empty':
      return false;
  }
}

const isEmpty = (value: Json | undefined): boolean => value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);

function run(node: Node, read: Reader): boolean {
  switch (node.t) {
    case 'const':
      return node.v;
    case 'all':
      return node.items.every((item) => run(item, read));
    case 'any':
      return node.items.some((item) => run(item, read));
    case 'not':
      return !run(node.item, read);
    case 'cmp': {
      const value = node.source === 'field' ? read.value(node.key) : read.ctx(node.key);
      return node.tests.every((test) => {
        if (test.op === 'empty') {
          return (node.source === 'field' ? read.empty(node.key) : isEmpty(value)) === test.arg;
        }

        return check(test, value);
      });
    }
  }
}

export function evaluate(condition: CompiledCondition, read: Reader): boolean {
  return run(condition.node, read);
}

function explain(node: Node, read: Reader): string {
  if (run(node, read)) {
    return '';
  }

  if (node.reason !== '') {
    return node.reason;
  }

  if (node.t === 'all' || node.t === 'any') {
    for (const item of node.items) {
      const why = explain(item, read);
      if (why !== '') {
        return why;
      }
    }
  }

  return '';
}

/** The sentence a disabled field shows (DR1): the reason of the node that failed, the first in the order written; empty when the condition holds or no node says why. */
export function whyNot(condition: CompiledCondition, read: Reader): string {
  return explain(condition.node, read);
}
