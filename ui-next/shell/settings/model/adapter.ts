import { LIMITS, readValue, type Constraints, type FieldKind, type FieldSpec, type FormSchema, type Json, type Option, type RemoteValidation, type SectionSpec } from '../../core/fields';
import { MATERIAL_FIELDS, materialField } from './material';
import { HOST_SCOPE, type HostCategory, type HostSetting, type HostSnapshot, type SettingsScope } from './types';

// The adapter: what the host's settings service declares (its snapshot: categories of typed settings) written as the form model's schema, so that Settings draws each field by its kind from DECLARED data and no
// field is a hand-written form. Plain TypeScript, no React, no DOM, no host call. It is also where Settings says what it does not draw: a setting a part cannot draw is left out with its reason, never drawn as something it is
// not, and a page left with nothing to draw is not offered (a nav entry that leads to an empty page is a dead end).

/**
 * The pages of the Core group in the design's order (ch16 S124: "Core order is deliberate"). The host sends its categories alphabetical by id, and has no order of its own to send: the design's table is the order. A category the
 * table does not know follows these, by label, so nothing a host adds is lost.
 */
const PAGE_ORDER = ['appearance', 'general', 'editor', 'terminal', 'notifications', 'telemetry', 'developer'] as const;

export const THEME_FIELD = 'appearance.theme';
const TEXT_SIZE = 'appearance.textSize';
export const LAYOUT_FIELDS: readonly string[] = ['appearance.density', TEXT_SIZE, 'appearance.motion'];
const APPEARANCE_ORDER: readonly string[] = [THEME_FIELD, ...LAYOUT_FIELDS, ...MATERIAL_FIELDS];
const appearanceOrder = (id: string): number => {
  const index = APPEARANCE_ORDER.indexOf(id);
  return index < 0 ? APPEARANCE_ORDER.length : index;
};

/** The native terminal application needs a discovery-backed picker, not a free-form bundle ID. */
export const NOT_DRAWN: Readonly<Record<string, 'picker'>> = Object.freeze({ 'terminal.nativeApplication': 'picker' });

export type NotDrawnReason = 'picker' | 'developer' | 'type' | 'presence';

export type NotDrawn = { readonly id: string; readonly reason: NotDrawnReason };

/** One page of Settings: a category of the host, with the ids of the fields it draws, in order. */
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
  /** Only keys the form model cannot take verbatim need a local id. Never send that local id to the provider. */
  readonly wireKeys: Readonly<Record<string, string>>;
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
  // Check classification before reading any value-bearing metadata, including the shape of a value.
  if (setting.type === 'password') return { kind: 'secret' };
  if (setting.sensitive) return setting.type === 'text' || setting.type === 'select' ? { kind: 'secret' } : undefined;
  const arrayValue = Array.isArray(setting.value) || Array.isArray(setting.default);
  if (arrayValue || (setting.fileSelection?.enabled && setting.fileSelection.multiple)) {
    // The SDK's text type also carries string arrays. A path list is not one path, even when empty.
    if (setting.type !== 'text' || setting.options?.length) return undefined;
    for (const value of [setting.value, setting.default]) {
      if (value != null && (!Array.isArray(value) || value.length > LIMITS.items || !value.every((item: unknown) => typeof item === 'string' && item.length <= LIMITS.value))) return undefined;
    }
    return { kind: 'list' };
  }
  switch (setting.type) {
    case 'toggle':
      return { kind: 'boolean' };
    case 'integer':
    case 'float':
      return { kind: 'number' };
    case 'text':
    case 'select': {
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

function specOf(id: string, key: string, setting: HostSetting, drawn: Drawn, appearance: boolean, materialPage: boolean): FieldSpec {
  const { kind } = drawn;
  const secret = kind === 'secret';
  const fallback = secret ? undefined : readValue(kind, setting.default, false);
  const presentation = appearance && id === THEME_FIELD && kind === 'text' ? { display: 'theme-picker' }
    : appearance && kind === 'select' && LAYOUT_FIELDS.includes(id) ? { display: id === TEXT_SIZE ? 'slider' : 'segmented' }
    : materialPage ? materialField(id) : undefined;
  const paths = kind === 'path' || (kind === 'list' && setting.fileSelection?.enabled === true);
  const constraints: Constraints | undefined = paths
    ? { pathKind: setting.fileSelection?.allowFolders ? 'directory' : 'file', ...(kind === 'list' ? { item: 'path' } : {}) }
    : kind === 'number' && setting.type === 'integer' ? { integer: true } : undefined;
  const validate: RemoteValidation | undefined = (kind === 'text' && presentation?.display !== 'theme-picker') || kind === 'path' || kind === 'list' || (kind === 'number' && presentation?.display !== 'slider') ? { remote: 'host' } : undefined;

  return {
    id,
    kind,
    label: setting.label || key,
    ...(setting.description === '' ? {} : { help: setting.description }),
    ...(secret ? { sensitive: true } : {}),
    ...(fallback?.ok === true && fallback.value !== undefined ? { default: fallback.value } : {}),
    ...(drawn.options === undefined ? {} : { options: drawn.options }),
    ...(setting.requiresRestart === true ? { restart: true } : {}),
    // Typed values are checked before commit. The theme picker offers only palettes this UI can render; the host still validates the committed ID.
    ...(validate === undefined ? {} : { validate }),
    ...(constraints === undefined ? {} : { constraints }),
    ...(paths ? { mono: true } : {}),
    ...presentation,
  };
}

function orderOf(categories: HostSnapshot['categories']): readonly HostCategory[] {
  const present = Object.values(categories).filter((entry): entry is HostCategory => entry !== undefined);
  const rank = (entry: HostCategory): number => {
    const index = (PAGE_ORDER as readonly string[]).indexOf(entry.id);
    return index === -1 ? PAGE_ORDER.length : index;
  };

  return present.toSorted((a, b) => rank(a) - rank(b) || (a.label || a.id).localeCompare(b.label || b.id, 'en'));
}

/** Host commits address category.setting. Plugin commits address the original map key, including dots. */
export function modelOf(snapshot: HostSnapshot, scope: SettingsScope = HOST_SCOPE): SettingsModel {
  const pages: SettingsPage[] = [];
  const sections: SectionSpec[] = [];
  const initial: Record<string, Json> = {};
  const presence: Record<string, boolean> = {};
  const pendingRestart: string[] = [];
  const notDrawn: NotDrawn[] = [];
  const stored = snapshot.stored;
  const host = scope.kind === 'host';
  const wireKeys: Record<string, string> = {};
  let escaped = 0;

  for (const entry of orderOf(snapshot.categories)) {
    const fields: FieldSpec[] = [];
    if (!host && entry.id !== 'plugin') continue;
    const appearance = host && entry.id === 'appearance';
    const materialPage = appearance && entry.settings.windowMaterial !== undefined;
    for (const key of Object.keys(entry.settings).toSorted(byCode)) {
      const setting = entry.settings[key];
      if (setting === undefined) {
        continue;
      }

      const wireKey = host ? `${entry.id}.${key}` : key;
      if (host && Object.hasOwn(NOT_DRAWN, wireKey)) {
        notDrawn.push({ id: wireKey, reason: 'picker' });
        continue;
      }

      if (setting.devOnly === true) {
        notDrawn.push({ id: wireKey, reason: 'developer' });
        continue;
      }

      const drawn = drawnAs(setting);
      if (drawn === undefined) {
        notDrawn.push({ id: wireKey, reason: 'type' });
        continue;
      }

      // The plugin service redacts secrets without a presence fact. Never turn that into “unset”.
      const held = stored && Object.hasOwn(stored, wireKey) ? stored[wireKey] : undefined;
      if (drawn.kind === 'secret' && typeof held !== 'boolean') {
        notDrawn.push({ id: wireKey, reason: 'presence' });
        continue;
      }

      let id = wireKey;
      if (!host && (id === '' || id.startsWith('~') || id.length > LIMITS.id || /\p{Cc}/u.test(id) || id === 'prototype' || Object.hasOwn(Object.prototype, id))) {
        id = `~${++escaped}`;
        wireKeys[id] = wireKey;
      }

      if (drawn.kind === 'secret') {
        presence[id] = held === true;
      } else {
        const value = readValue(drawn.kind, setting.value, false);
        if (value.ok && value.value !== undefined) {
          initial[id] = value.value;
        }
      }

      if (setting.pendingRestart === true) {
        pendingRestart.push(id);
      }

      fields.push(specOf(id, key, setting, drawn, appearance, materialPage));
    }

    if (fields.length === 0) {
      continue;
    }

    if (appearance) {
      fields.sort((a, b) => appearanceOrder(a.id) - appearanceOrder(b.id));
    }

    const { description } = entry;
    const title = entry.label || entry.id;
    pages.push({ id: entry.id, title, description, icon: entry.icon, fields: fields.map((field) => field.id) });
    sections.push({ id: entry.id, label: title, ...(description === '' ? {} : { help: description }), fields });
  }

  return Object.freeze({
    schema: { id: host ? 'host-settings' : `plugin-settings/${scope.pluginId}`, sections },
    wireKeys: Object.freeze(wireKeys),
    pages: Object.freeze(pages),
    initial: Object.freeze(initial),
    presence: Object.freeze(presence),
    pendingRestart: Object.freeze(pendingRestart),
    notDrawn: Object.freeze(notDrawn),
  });
}
