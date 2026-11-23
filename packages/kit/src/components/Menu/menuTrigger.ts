export type MenuTriggerMode = 'dropdown' | 'context';

export type MenuTriggerAttributes = {
  readonly 'data-ov-menu': string;
  readonly 'data-ov-menu-key'?: string;
  readonly 'data-ov-menu-mode': MenuTriggerMode;
  readonly 'aria-haspopup'?: 'menu';
};

/**
 * Mark a control for the document's `MenuHost`. The context key identifies a record, not a row element: use its stable ID even in a virtual list.
 * A context trigger needs to be focusable for keyboard use; the helper never sets `tabIndex`. Use `data-ov-menu-label` for a separate popup name.
 * Pointer opens on the menu itself unless `data-ov-menu-pointer-focus="first"` is set on the trigger.
 */
export function menuTrigger(id: string, contextKey?: string, mode: MenuTriggerMode = 'dropdown'): MenuTriggerAttributes {
  return {
    'data-ov-menu': id,
    ...(contextKey === undefined ? {} : { 'data-ov-menu-key': contextKey }),
    'data-ov-menu-mode': mode,
    ...(mode === 'dropdown' ? { 'aria-haspopup': 'menu' } : {}),
  };
}
