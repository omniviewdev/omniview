import { readValue, type FieldKind, type FieldSpec, type FormSchema, type Json, type Option, type SectionSpec } from '../../core/fields';
import type { HostCategory, HostSetting, HostSnapshot } from './types';

// The adapter: what the host's settings service declares (its snapshot: categories of typed settings) written as the form model's schema, so that the Settings sheet draws each field by its kind from DECLARED data and no
// field is a hand-written form. Plain TypeScript, no React, no DOM, no host call. It is also where the sheet says what it does not draw: a setting a part cannot draw is left out with its reason, never drawn as something it is
// not, and a page left with nothing to draw is not offered (a nav entry that leads to an empty page is a dead end).

/**
 * The pages of the Core group in the design's order (ch16 S124: "Core order is deliberate"). The host sends its categories alphabetical by id, and has no order of its own to send: the design's table is the order. A category the
 * table does not know follows these, by label, so nothing a host adds is lost.
 */
const PAGE_ORDER = ['appearance', 'general', 'editor', 'terminal', 'notifications', 'telemetry', 'developer'] as const;

/**
 * Settings whose editor is a picker, not a field (the old window registers one for each: `ui/pages/settings/CoreSettingsPage.tsx`, `CORE_SETTING_RENDERERS`): the schema says only `text`, and a text field for a theme id or a
 * bundle id would let a person type what only a list can offer. A later slice draws them; until then they are not drawn.
 */
export const NOT_DRAWN: Readonly<Record<string, 'picker'>> = Object.freeze({ 'appearance.theme': 'picker', 'terminal.nativeApplication': 'picker' });

export type NotDrawnReason = 'picker' | 'developer' | 'type' | 'presence';

export type NotDrawn = { readonly id: string; readonly reason: NotDrawnReason };

/** One page of the sheet: a category of the host, with the ids of the fields it draws, in order. */
export type SettingsPage = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  /** The SDK's glyph name for the category (`LuSettings2`). The view draws it when the kit has that glyph. */
  readonly icon: string;
  readonly fields: readonly string[];
};

export type SettingsModel = {
  readonly schema: FormSchema;
  readonly pages: readonly SettingsPage[];
  /** The values the host holds, by field id: what the form starts from. A secret has none. */
  readonly initial: Readonly<Record<string, Json>>;
  /** For each secret that is drawn: whether the host holds a value. The host's fact (`Snapshot.Stored`), never inferred. */
  readonly presence: Readonly<Record<string, boolean>>;
  /** The fields whose saved change waits for a restart of the app. */
  readonly pendingRestart: readonly string[];
  readonly notDrawn: readonly NotDrawn[];
};

const byCode = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The options of a setting as the model reads them: only a text, a number or a switch can be a value. */
function optionsOf(setting: HostSetting): readonly Option[] {
  const options: Option[] = [];
  for (const option of setting.options ?? []) {
    const { value } = option;
    if (typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) {
      options.push({ value, label: option.label, description: option.description ?? '' });
    }
  }

  return options;
}

type Drawn = { readonly kind: FieldKind; readonly options?: readonly Option[] };

/** What kind a setting is drawn as, or `undefined` when no part of this slice can draw it. */
function drawnAs(setting: HostSetting): Drawn | undefined {
  switch (setting.type) {
    case 'toggle':
      return { kind: 'boolean' };
    case 'integer':
    case 'float':
      return { kind: 'number' };
    case 'password':
      return { kind: 'secret' };
    case 'text':
    case 'select': {
      if (setting.sensitive === true) {
        return { kind: 'secret' };
      }

      const options = optionsOf(setting);
      if (options.length > 0) {
        return { kind: 'select', options };
      }

      return setting.fileSelection?.enabled === true ? { kind: 'path' } : { kind: 'text' };
    }

    default:
      return undefined;
  }
}

function specOf(id: string, setting: HostSetting, drawn: Drawn): FieldSpec {
  const { kind } = drawn;
  const secret = kind === 'secret';
  const fallback = secret ? undefined : readValue(kind, setting.default, false);
  const extra: { constraints?: Record<string, unknown>; mono?: boolean } = {};
  if (kind === 'number' && setting.type === 'integer') {
    extra.constraints = { integer: true };
  }

  if (kind === 'path') {
    extra.constraints = { pathKind: setting.fileSelection?.allowFolders === true ? 'directory' : 'file' };
    extra.mono = true;
  }

  return {
    id,
    kind,
    label: setting.label === '' ? setting.id : setting.label,
    ...(setting.description === '' ? {} : { help: setting.description }),
    ...(secret ? { sensitive: true } : {}),
    ...(fallback?.ok === true && fallback.value !== undefined ? { default: fallback.value } : {}),
    ...(drawn.options === undefined ? {} : { options: drawn.options }),
    ...(setting.requiresRestart === true ? { restart: true } : {}),
    // A typed value is asked of the host on commit; a chosen one is one of the host's own options, and a secret is never asked.
    ...(kind === 'text' || kind === 'path' || kind === 'number' ? { validate: { remote: 'host' } } : {}),
    ...extra,
  } as FieldSpec;
}

function orderOf(categories: HostSnapshot['categories']): readonly HostCategory[] {
  const present = Object.values(categories).filter((entry): entry is HostCategory => entry !== undefined);
  const rank = (entry: HostCategory): number => {
    const index = (PAGE_ORDER as readonly string[]).indexOf(entry.id);
    return index === -1 ? PAGE_ORDER.length : index;
  };

  return present.toSorted((a, b) => rank(a) - rank(b) || (a.label || a.id).localeCompare(b.label || b.id, 'en'));
}

/** Reads a snapshot of the host's settings into the schema the sheet draws and the values it starts from. */
export function modelOf(snapshot: HostSnapshot): SettingsModel {
  const pages: SettingsPage[] = [];
  const sections: SectionSpec[] = [];
  const initial: Record<string, Json> = {};
  const presence: Record<string, boolean> = {};
  const pendingRestart: string[] = [];
  const notDrawn: NotDrawn[] = [];
  const stored = snapshot.stored;

  for (const entry of orderOf(snapshot.categories)) {
    const fields: FieldSpec[] = [];
    for (const key of Object.keys(entry.settings).toSorted(byCode)) {
      const setting = entry.settings[key];
      if (setting === undefined) {
        continue;
      }

      const id = `${entry.id}.${key}`;
      if (Object.hasOwn(NOT_DRAWN, id)) {
        notDrawn.push({ id, reason: 'picker' });
        continue;
      }

      if (setting.devOnly === true) {
        notDrawn.push({ id, reason: 'developer' });
        continue;
      }

      const drawn = drawnAs(setting);
      if (drawn === undefined) {
        notDrawn.push({ id, reason: 'type' });
        continue;
      }

      if (drawn.kind === 'secret') {
        // Whether a secret is saved is the host's fact to state (`Snapshot.Stored`): without it the field could only guess, so it is not drawn.
        const held = stored?.[id];
        if (held === undefined) {
          notDrawn.push({ id, reason: 'presence' });
          continue;
        }

        presence[id] = held;
      } else {
        const value = readValue(drawn.kind, setting.value, false);
        if (value.ok && value.value !== undefined) {
          initial[id] = value.value;
        }
      }

      if (setting.pendingRestart === true) {
        pendingRestart.push(id);
      }

      fields.push(specOf(id, setting, drawn));
    }

    if (fields.length === 0) {
      continue;
    }

    pages.push({ id: entry.id, title: entry.label === '' ? entry.id : entry.label, description: entry.description, icon: entry.icon, fields: fields.map((field) => field.id) });
    sections.push({ id: entry.id, label: entry.label === '' ? entry.id : entry.label, ...(entry.description === '' ? {} : { help: entry.description }), fields });
  }

  return Object.freeze({
    schema: { id: 'host-settings', sections },
    pages: Object.freeze(pages),
    initial: Object.freeze(initial),
    presence: Object.freeze(presence),
    pendingRestart: Object.freeze(pendingRestart),
    notDrawn: Object.freeze(notDrawn),
  });
}
