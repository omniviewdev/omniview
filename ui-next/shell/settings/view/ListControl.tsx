import { IconButton, tip, useField } from '@omniviewdev/kit';
import { useRef, useState } from 'react';
import type { FieldState, FormStore } from '../../core/fields';
import styles from './SettingRow.module.css';

type Slot = number | 'new';

/** Each entry is one string, even if it contains a comma, a space or a newline. Only finished edits reach the list model, which applies each change immediately. */
export function ListControl({ field, form }: { readonly field: FieldState; readonly form: FormStore }) {
  const binding = useField();
  const add = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState<{ readonly slot: Slot; readonly value: string }>();
  // The field model accepts only string arrays for this kind.
  const items: readonly string[] = Array.isArray(field.value) ? field.value : [];
  const noun = field.spec.item === 'path' ? 'path' : 'value';
  const locked = binding?.disabledReason ?? (field.readonly ? 'Read-only.' : undefined);

  function entry(slot: Slot, item: string) {
    const adding = slot === 'new';
    const first = slot === 0 || (adding && items.length === 0);
    const pending = draft?.slot === slot ? draft : undefined;
    const removeLabel = `Remove ${noun} ${adding ? '' : slot + 1} from ${field.label}`;
    const commit = () => {
      if (!pending) {
        return;
      }

      setDraft(undefined);
      if (locked !== undefined || pending.value === item) {
        return;
      }

      const next = items.slice();
      next[adding ? next.length : slot] = pending.value;
      form.setValue(field.id, next);
    };

    return (
      <div className={styles.listEntry} key={slot}>
        <textarea
          ref={adding ? add : undefined}
          rows={1}
          id={first ? binding?.controlId : undefined}
          aria-label={first ? undefined : adding ? `Add a ${noun} to ${field.label}` : `${field.label}, ${noun} ${slot + 1}`}
          aria-describedby={binding?.describedBy}
          aria-invalid={binding?.invalid ? true : undefined}
          aria-disabled={binding?.disabledReason ? true : undefined}
          readOnly={locked !== undefined}
          data-mono={field.spec.mono || undefined}
          spellCheck={field.spec.mono ? false : undefined}
          placeholder={adding && !locked ? `Add a ${noun}` : undefined}
          value={pending?.value ?? item}
          onChange={event => {
            setDraft({ slot, value: event.currentTarget.value });
          }}
          onBlur={commit}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
              return;
            }

            if (event.key === 'Enter') {
              event.preventDefault();
              commit();
            } else if (event.key === 'Escape' && (pending !== undefined || field.dirty)) {
              event.preventDefault();
              event.stopPropagation();
              setDraft(undefined);
              form.revert(field.id);
            }
          }}
        />
        {!adding && locked === undefined && (
          <IconButton icon="close" size="row" variant="ghost" label={removeLabel} {...tip(removeLabel)} onClick={() => {
            add.current?.focus();
            form.setValue(field.id, items.filter((_, index) => index !== slot));
          }} />
        )}
      </div>
    );
  }

  return (
    <div className={styles.list} role="group" aria-labelledby={binding?.labelId}>
      {items.map((item, index) => entry(index, item))}
      {(locked === undefined || items.length === 0) && entry('new', '')}
    </div>
  );
}
