import { Field, IconButton, NumberInput, SecretInput, Select, TextInput, Toggle, tip } from '@omniviewdev/kit';
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { FieldState, FormStore, Json } from '../../core/fields';
import type { SettingsSession } from '../model/session';
import styles from './SettingRow.module.css';
import { elsewhereNote, laneOf, resetLabel, SECRET_ELSEWHERE } from './words';

// One setting, drawn from its declared field: the kit's row (`Field layout="row"`: the title, the description and the one message lane on one side, the control and the reset slot on the other) around the kit part its kind asks for,
// bound to the form model and to nothing else. The model decides every state of the row (S126, S127); this puts them on screen. A row subscribes to its own field and to the notes of what changed elsewhere, so a keystroke
// in one field draws that one row.

/** What the field model holds for a number, as the text a person would have typed. */
const numberText = (value: Json | undefined): string => (typeof value === 'number' || typeof value === 'string' ? String(value) : '');

/** The text typed into a number field stays in the field while the model's value is what it reads as: the model holds `1` for `1.` and `001`, and the part must not take a character away from a person who is typing. */
function NumberControl({ field, form }: { readonly field: FieldState; readonly form: FormStore }) {
  const [typed, setTyped] = useState<string | undefined>(undefined);
  const shown = typed !== undefined && (typed === field.value || Number(typed) === field.value) ? typed : numberText(field.value);
  return (
    <NumberInput
      value={shown}
      min={field.spec.min}
      max={field.spec.max}
      step={field.spec.step}
      unit={field.spec.unit === '' ? undefined : field.spec.unit}
      dirty={field.dirty}
      onValueChange={(text) => {
        setTyped(text);
        form.setValue(field.id, text);
      }}
      onCommit={() => {
        setTyped(undefined);
        void form.commit(field.id);
      }}
      onBlur={() => {
        setTyped(undefined);
        void form.blur(field.id);
      }}
      onRevert={() => {
        setTyped(undefined);
        form.revert(field.id);
      }}
    />
  );
}

function Control({ field, form }: { readonly field: FieldState; readonly form: FormStore }) {
  const { id } = field;
  switch (field.kind) {
    case 'boolean':
      return (
        <Toggle
          checked={field.value === true}
          onCheckedChange={(checked) => {
            form.setValue(id, checked);
          }}
        />
      );
    case 'select': {
      const options = (field.options ?? []).map((option) => ({ value: String(option.value), label: option.label }));
      return (
        <Select
          value={typeof field.value === 'string' || typeof field.value === 'number' || typeof field.value === 'boolean' ? String(field.value) : ''}
          options={options}
          placeholder="Choose a value"
          width="normal"
          onValueChange={(next) => {
            form.setValue(id, (field.options ?? []).find((option) => String(option.value) === next)?.value ?? next);
          }}
        />
      );
    }

    case 'number':
      return <NumberControl field={field} form={form} />;
    case 'secret':
      return (
        <SecretInput
          presence={field.secret?.presence ?? 'unset'}
          changed={field.secret?.changed === true}
          width="normal"
          onValueChange={(text) => {
            form.setValue(id, text);
          }}
          onCommit={() => {
            void form.commit(id);
          }}
          onBlur={() => {
            void form.blur(id);
          }}
          onRevert={() => {
            form.revert(id);
          }}
        />
      );
    case 'color':
    case 'list':
    case 'multiselect':
    case 'unsupported':
      // The adapter draws none of these in this slice (`NOT_DRAWN`, `drawnAs`).
      return null;
    case 'text':
    case 'path':
    case 'url':
      return (
        <TextInput
          value={typeof field.value === 'string' ? field.value : ''}
          width="normal"
          mono={field.spec.mono}
          placeholder={field.placeholder === '' ? undefined : field.placeholder}
          dirty={field.dirty}
          onValueChange={(text) => {
            form.setValue(id, text);
          }}
          onCommit={() => {
            void form.commit(id);
          }}
          onBlur={() => {
            void form.blur(id);
          }}
          onRevert={() => {
            form.revert(id);
          }}
        />
      );
  }
}

type SettingRowProps = {
  readonly form: FormStore;
  readonly session: SettingsSession;
  readonly id: string;
};

export function SettingRow({ form, session, id }: SettingRowProps) {
  const field = useSyncExternalStore(form.subscribe, () => form.field(id));
  const notes = useSyncExternalStore(session.elsewhere.subscribe, session.elsewhere.getSnapshot);
  const row = useRef<HTMLDivElement>(null);
  // Reset leaves the row's control with the focus when the button that was pressed goes with the value that is the default again (S144: an action that removes the control that had focus moves it to a defined target).
  const resetting = useRef(false);
  const modified = field?.modified === true;
  useLayoutEffect(() => {
    if (resetting.current && !modified) {
      resetting.current = false;
      row.current?.querySelector<HTMLElement>('input:not([type="hidden"]), select, button[role="switch"]')?.focus({ preventScroll: true });
    }
  }, [modified]);

  if (field === undefined) {
    return null;
  }

  const drafted = field.dirty || field.secret?.changed === true;
  const note = drafted && Object.hasOwn(notes, id) ? (field.secret === undefined ? elsewhereNote(notes[id]) : SECRET_ELSEWHERE) : undefined;
  return (
    <div ref={row} className={styles.row} data-settings-row={id}>
      <Field
        layout="row"
        label={field.label}
        help={field.help === '' ? undefined : field.help}
        message={laneOf(field.message, note)}
        lane
        onRetry={() => {
          void form.retry(id);
        }}
        trailing={
          modified ? (
            <IconButton
              icon="rotate-ccw"
              label={resetLabel(field.label)}
              variant="ghost"
              size="row"
              {...tip(resetLabel(field.label))}
              onClick={() => {
                resetting.current = true;
                form.reset(id);
              }}
            />
          ) : undefined
        }
      >
        <Control field={field} form={form} />
      </Field>
    </div>
  );
}
