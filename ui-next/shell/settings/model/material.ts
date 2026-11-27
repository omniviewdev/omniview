import type { Condition, FieldSpec, FormStore } from '../../core/fields';

// Presentation of the host's material settings. The host snapshot owns the labels, options, values and defaults.
export const WINDOW_MATERIAL = 'appearance.windowMaterial';
export const GLASS_STYLE = 'appearance.glassStyle';
export const SURFACE_OPACITIES = ['appearance.chromeOpacity', 'appearance.contentOpacity', 'appearance.menuOpacity', 'appearance.sheetOpacity'] as const;
export const MATERIAL_FIELDS = [WINDOW_MATERIAL, GLASS_STYLE, ...SURFACE_OPACITIES] as const;
const ORDER: readonly string[] = [...MATERIAL_FIELDS, 'appearance.density', 'appearance.textSize', 'appearance.motion'];

export function appearanceOrder(id: string): number {
  const rank = ORDER.indexOf(id);
  return rank < 0 ? ORDER.length : rank;
}

export const RESETTING_MATERIAL = 'resettingMaterial';
const idle: Condition = { ctx: RESETTING_MATERIAL, notEquals: true, reason: 'Reset in progress.' };
const glass: Condition = { field: WINDOW_MATERIAL, equals: 'glass', reason: 'Requires Liquid Glass.' };
const translucent: Condition = { field: WINDOW_MATERIAL, in: ['translucent', 'glass'], reason: 'Requires a translucent material.' };

/** Form conditions read the applied material, not a pending or refused selection. */
export function materialField(id: string): Pick<FieldSpec, 'display' | 'unit' | 'constraints' | 'enabledWhen'> | undefined {
  if (id === WINDOW_MATERIAL) {
    return { enabledWhen: idle };
  }

  if (id === GLASS_STYLE) {
    return { enabledWhen: { all: [idle, glass] } };
  }

  if ((SURFACE_OPACITIES as readonly string[]).includes(id)) {
    return { display: 'slider', unit: '%', constraints: { integer: true, min: 0, max: 100, step: 1 }, enabledWhen: { all: [idle, translucent] } };
  }

  return undefined;
}

/** A group reset can restore an inactive surface, but cannot bypass a policy lock or race another write to the group. */
export function materialResetBlock(form: FormStore): string | undefined {
  let modified = false;
  for (const id of MATERIAL_FIELDS) {
    const field = form.field(id);
    if (!field?.visible || field.readonly || field.default === undefined) {
      return 'Unavailable.';
    }

    if (field.busy) {
      return 'Save in progress.';
    }

    if (field.lock && (id === WINDOW_MATERIAL || field.lock.source !== 'condition')) {
      return field.lock.reason;
    }

    modified ||= field.modified;
  }

  return modified ? undefined : 'Already at defaults.';
}
