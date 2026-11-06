import React, { useId } from 'react';
import { Select } from '@omniviewdev/base-ui';
import { LuChevronDown } from 'react-icons/lu';
import type { Schema } from '@omniviewdev/runtime';
import type { ActionParameterDraft, ParameterFieldDraft } from './actionParameters';
import styles from './ActivityActionSurfaces.module.css';

type Props = {
  schema?: Schema;
  draft: ActionParameterDraft;
  disabled: boolean;
  onChange: (draft: ActionParameterDraft) => void;
};

export function ActionParameterFields({ schema, draft, disabled, onChange }: Props) {
  const prefix = useId();
  const setField = (name: string, update: Partial<ParameterFieldDraft>) => {
    onChange({
      ...draft,
      fields: { ...draft.fields, [name]: { ...draft.fields[name], ...update } },
    });
  };

  if (!schema) {
    return (
      <details className={styles.Help} open={draft.raw !== 'null' && draft.raw !== '{}'}>
        <summary>Parameters (JSON)</summary>
        <textarea
          aria-label="Parameters JSON"
          className={styles.JSON}
          disabled={disabled}
          value={draft.raw}
          spellCheck={false}
          onChange={(event) => {
            onChange({ ...draft, raw: event.target.value }); 
          }}
        />
      </details>
    );
  }

  return (
    <>
      {Object.entries(schema.properties ?? {}).map(([name, property], index) => {
        const field = draft.fields[name];
        const id = `${prefix}-${index}`;
        const required = schema.required?.includes(name) === true;
        const inactive = disabled || !field.enabled;
        let control: React.ReactNode;
        if (property.type === 'string' && property.enum?.length) {
          const items = property.enum.map((value) => ({
            label: value === '' ? '(empty)' : value,
            value,
          }));
          control = (
            <Select.Root
              items={items}
              value={property.enum.includes(field.text) ? field.text : null}
              disabled={inactive}
              onValueChange={(value) => {
                setField(name, { text: value ?? '' }); 
              }}
            >
              <Select.Trigger id={id} aria-label={name} aria-required={required}>
                <Select.Value placeholder="Select" />
                <Select.Icon>
                  <LuChevronDown aria-hidden />
                </Select.Icon>
              </Select.Trigger>
              <Select.Portal>
                <Select.Positioner sideOffset={4} alignItemWithTrigger={false}>
                  <Select.Popup>
                    <Select.List>
                      {items.map((item) => (
                        <Select.Item key={item.value} value={item.value}>
                          <Select.ItemText>{item.label}</Select.ItemText>
                        </Select.Item>
                      ))}
                    </Select.List>
                  </Select.Popup>
                </Select.Positioner>
              </Select.Portal>
            </Select.Root>
          );
        } else if (property.type === 'boolean') {
          control = (
            <input
              id={id}
              type="checkbox"
              checked={field.checked}
              disabled={inactive}
              aria-required={required}
              onChange={(event) => {
                setField(name, { checked: event.target.checked }); 
              }}
            />
          );
        } else if (property.type === 'object' || property.type === 'array') {
          control = (
            <textarea
              id={id}
              className={styles.JSON}
              value={field.text}
              disabled={inactive}
              aria-required={required}
              spellCheck={false}
              onChange={(event) => {
                setField(name, { text: event.target.value }); 
              }}
            />
          );
        } else {
          control = (
            <input
              id={id}
              className={styles.Input}
              value={field.text}
              disabled={inactive}
              inputMode={
                property.type === 'integer'
                  ? 'numeric'
                  : property.type === 'number'
                    ? 'decimal'
                    : 'text'
              }
              aria-required={required}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
                setField(name, { text: event.target.value }); 
              }}
            />
          );
        }

        return (
          <div className={styles.Field} key={name}>
            <div className={styles.FieldLabel}>
              <label htmlFor={id}>
                {name}
                {required && <span aria-hidden> *</span>}
              </label>
              {!required && (
                <label className={styles.Include}>
                  <input
                    type="checkbox"
                    aria-label={`Include ${name}`}
                    checked={field.enabled}
                    disabled={disabled}
                    onChange={(event) => {
                      setField(name, { enabled: event.target.checked }); 
                    }}
                  />{' '}
                  Include
                </label>
              )}
            </div>
            {control}
            {property.description && (
              <details className={styles.Help}>
                <summary>Help</summary>
                <p>{property.description}</p>
              </details>
            )}
          </div>
        );
      })}
      <details className={styles.Help} open={draft.additional !== '{}'}>
        <summary>Additional parameters (JSON)</summary>
        <textarea
          className={styles.JSON}
          aria-label="Additional parameters JSON"
          disabled={disabled}
          value={draft.additional}
          spellCheck={false}
          onChange={(event) => {
            onChange({ ...draft, additional: event.target.value }); 
          }}
        />
      </details>
    </>
  );
}
