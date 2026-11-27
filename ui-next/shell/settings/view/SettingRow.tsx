import { Field, IconButton, NumberInput, SecretInput, SegmentedControl, Select, Slider, TextInput, Toggle, tip } from '@omniviewdev/kit';
import { useContext, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { FieldState, FormStore, Json, Option, Scalar, SetResult } from '../../core/fields';
import { SettingsWindowShown } from '../context';
import type { ScopeSession } from '../model/session';
import { ListControl } from './ListControl';
import styles from './SettingRow.module.css';
import { ThemePicker } from './ThemePicker';
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

type Choose = (value: Scalar) => void;
type UnavailableOption = (value: Scalar) => boolean;

function RangeControl({ field, choose }: { readonly field: FieldState; readonly choose: Choose }) {
  const shown = useContext(SettingsWindowShown);
  if (typeof field.value !== 'number') {
    return null;
  }

  // The kit owns the gesture. The form auto-commits sliders, so only the final value reaches it.
  return <Slider value={field.value} min={field.spec.min} max={field.spec.max} step={field.spec.step} unit={field.spec.unit} readOnly={!shown} onCommit={choose} />;
}

/** The native range moves by index. The field always holds the host option's actual value, never an intermediate percentage. */
function ChoiceRange({ options, index, choose }: { readonly options: readonly Option[]; readonly index: number; readonly choose: Choose }) {
  const shown = useContext(SettingsWindowShown);
  return (
    <Slider
      min={0} max={options.length - 1} step={1} value={index}
      stopLabels={options.map(option => option.label)}
      readOnly={!shown}
      onCommit={stop => {
        const option = options[stop];
        if (option) {
          choose(option.value);
        }
      }}
    />
  );
}

function Control({ field, form, choose, unavailableOption }: { readonly field: FieldState; readonly form: FormStore; readonly choose: Choose; readonly unavailableOption?: UnavailableOption | undefined }) {
  const { id } = field;
  if (field.spec.display === 'theme-picker' && typeof field.value === 'string') {
    return <ThemePicker label={field.label} value={field.value} onChoose={choose} />;
  }

  switch (field.kind) {
    case 'boolean':
      return <Toggle checked={field.value === true} onCheckedChange={choose} />;
    case 'select': {
      const options = field.options ?? [];
      const value = typeof field.value === 'string' || typeof field.value === 'number' || typeof field.value === 'boolean' ? String(field.value) : '';
      const disabled = (option: Option) => Boolean(option.disabled) || unavailableOption?.(option.value) === true;
      const chooseOption = (next: string) => {
        const option = options.find(candidate => String(candidate.value) === next);
        if (option && !disabled(option)) {
          choose(option.value);
        }
      };
      if (field.spec.display === 'segmented') {
        return (
          <SegmentedControl label={field.label} value={value} onValueChange={chooseOption} options={options.map(option => ({
            value: String(option.value), label: option.label,
            disabledReason: typeof option.disabled === 'string' ? option.disabled : disabled(option) ? 'Unavailable.' : undefined,
          }))} />
        );
      }

      if (field.spec.display === 'slider' && options.length > 1 && !options.some(disabled)) {
        const index = options.findIndex(option => option.value === field.value);
        if (index >= 0) {
          return <ChoiceRange options={options} index={index} choose={choose} />;
        }
      }

      return (
        <Select
          value={value}
          options={options.map(option => ({ value: String(option.value), label: option.label, disabled: disabled(option) }))}
          placeholder="Choose a value"
          width="normal"
          onValueChange={chooseOption}
        />
      );
    }

    case 'number':
      if (field.spec.display === 'slider') {
        return <RangeControl field={field} choose={choose} />;
      }

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
    case 'list':
      return <ListControl field={field} form={form} />;
    case 'color':
    case 'multiselect':
    case 'unsupported':
      // The adapter omits kinds for which Settings has no control.
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
  readonly session: ScopeSession;
  readonly id: string;
  readonly concise?: boolean;
  readonly rollback?: boolean;
  readonly disabledReason?: string | undefined;
  readonly unavailableOption?: UnavailableOption | undefined;
};

/** Use the kit Field's native label association, including the chosen member of a compound control. */
export function focusSetting(row: HTMLElement): void {
  const labelled = row.querySelector<HTMLLabelElement>('[data-ov-part="label"]')?.control;
  const target = labelled && !labelled.matches(':disabled') ? labelled : row.querySelector<HTMLElement>('[data-ov-part="control"] [tabindex="0"]:not(:disabled)');
  (target ?? row).focus({ preventScroll: true });
}

export function SettingRow({ form, session, id, concise, rollback, disabledReason, unavailableOption }: SettingRowProps) {
  const field = useSyncExternalStore(form.subscribe, () => form.field(id));
  const notes = useSyncExternalStore(session.elsewhere.subscribe, session.elsewhere.getSnapshot);
  const row = useRef<HTMLDivElement>(null);
  const [saveError, setSaveError] = useState('');
  // Reset leaves the row's control with the focus when the button that was pressed goes with the value that is the default again (S144: an action that removes the control that had focus moves it to a defined target).
  const resetting = useRef(false);
  const modified = field?.modified === true;
  useLayoutEffect(() => {
    if (resetting.current && !modified) {
      resetting.current = false;
      if (row.current) {
        focusSetting(row.current);
      }
    }
  }, [modified]);

  if (!field?.visible) {
    return null;
  }

  const blocked = disabledReason ?? (!field.enabled ? field.lock?.reason : undefined);
  const settle = (attempt: SetResult, value: Json | undefined): void => {
    if (!rollback) {
      return;
    }

    setSaveError('');
    if (attempt.status !== 'set' || !attempt.commit) {
      return;
    }

    void attempt.commit.then((result) => {
      if (result.status !== 'failed' && result.status !== 'invalid' && result.status !== 'unchecked') {
        return;
      }

      // Never overwrite a later choice. Revert reads the latest applied value, including a change from another window.
      const current = form.field(id);
      if (current?.dirty && current.value === value && form.revert(id)) {
        setSaveError(current.message?.text ?? 'Couldn’t save this change.');
      }
    });
  };

  const drafted = field.dirty || field.secret?.changed === true;
  const note = drafted && Object.hasOwn(notes, id) ? (field.secret === undefined ? elsewhereNote(notes[id]) : SECRET_ELSEWHERE) : undefined;
  return (
    <div ref={row} className={styles.row} tabIndex={-1} data-settings-row={id} data-settings-concise={concise || undefined}>
      <Field
        layout="row"
        label={field.label}
        help={!concise && field.help !== '' ? field.help : undefined}
        readOnly={field.readonly}
        disabledReason={blocked}
        message={saveError !== '' ? { kind: 'error', text: saveError } : laneOf(concise && field.message?.kind === 'saved' ? undefined : field.message, note)}
        lane={!concise}
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
              disabledReason={blocked ?? (field.readonly ? 'Read-only.' : undefined)}
              {...tip(resetLabel(field.label))}
              onClick={() => {
                resetting.current = true;
                settle(form.reset(id), field.default);
              }}
            />
          ) : undefined
        }
      >
        <Control
          field={field}
          form={form}
          unavailableOption={unavailableOption}
          choose={(value) => {
            settle(form.setValue(id, value, { commit: true }), value);
          }}
        />
      </Field>
    </div>
  );
}
