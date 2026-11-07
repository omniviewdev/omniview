import {
  jsonTextToValue,
  jsonToValue,
  valueToJSONText,
  type Schema,
  type SchemaProperty,
  type Value,
} from '@omniviewdev/runtime';

export type ParameterFieldDraft = {
  enabled: boolean;
  text: string;
  checked: boolean;
};

export type ActionParameterDraft = {
  fields: Record<string, ParameterFieldDraft>;
  additional: string;
  raw: string;
};

/** Drafts preserve integer lexemes and explicit presence; schema defaults are not applied. */
export function createActionParameterDraft(
  schema: Schema | undefined,
  input: Value,
): ActionParameterDraft {
  const draft: ActionParameterDraft = { fields: {}, additional: '{}', raw: valueToJSONText(input) };
  if (!schema) {
    return draft;
  }

  if (input.kind !== 'map' && input.kind !== 'null') {
    throw new Error(
      'This action requires object parameters. Review its resource view before continuing.',
    );
  }

  const values = input.kind === 'map' ? input.value : {};
  const additional: Record<string, Value> = {};
  for (const [name, value] of Object.entries(values)) {
    if (!Object.hasOwn(schema.properties ?? {}, name)) {
      additional[name] = value;
    }
  }

  draft.additional = valueToJSONText({ kind: 'map', value: additional });
  for (const [name, property] of Object.entries(schema.properties ?? {})) {
    const value = values[name];
    draft.fields[name] = {
      enabled: schema.required?.includes(name) === true || value !== undefined,
      text:
        value?.kind === 'string'
          ? value.value
          : value
            ? valueToJSONText(value)
            : property.type === 'object'
              ? '{}'
              : property.type === 'array'
                ? '[]'
                : '',
      checked: value?.kind === 'bool' && value.value,
    };
  }

  return draft;
}

function numericBound(value: Value, bound: number, minimum: boolean): boolean {
  if (!Number.isFinite(bound)) {
    throw new Error('The provider supplied an invalid numeric constraint.');
  }

  if (value.kind === 'int64' || value.kind === 'uint64') {
    const integer = BigInt(value.value);
    return minimum ? integer >= BigInt(Math.ceil(bound)) : integer <= BigInt(Math.floor(bound));
  }

  return value.kind === 'double' && (minimum ? value.value >= bound : value.value <= bound);
}

function validateObject(schema: Schema, value: Value, path: string): void {
  if (value.kind !== 'map') {
    throw new Error(`${path} must be an object.`);
  }

  for (const name of schema.required ?? []) {
    if (!Object.hasOwn(value.value, name)) {
      throw new Error(`${path}.${name} is required.`);
    }
  }

  for (const [name, property] of Object.entries(schema.properties ?? {})) {
    const item = value.value[name];
    if (item !== undefined) {
      validateProperty(property, item, `${path}.${name}`);
    }
  }
}

function validateProperty(property: SchemaProperty, value: Value, path: string): void {
  switch (property.type) {
    case 'string':
      if (value.kind !== 'string') {
        throw new Error(`${path} must be text.`);
      }

      if (property.enum?.length && !property.enum.includes(value.value)) {
        throw new Error(`${path} must match one of the available choices.`);
      }

      return;
    case 'boolean':
      if (value.kind !== 'bool') {
        throw new Error(`${path} must be a boolean.`);
      }

      return;
    case 'object':
      validateObject(property, value, path);
      return;
    case 'array':
      if (value.kind !== 'list') {
        throw new Error(`${path} must be an array.`);
      }

      return;
    case 'integer':
    case 'number':
      if (value.kind !== 'int64' && value.kind !== 'uint64' && value.kind !== 'double') {
        throw new Error(`${path} must be a number.`);
      }

      if (
        property.type === 'integer' &&
        value.kind === 'double' &&
        !Number.isInteger(value.value)
      ) {
        throw new Error(`${path} must be an integer.`);
      }

      if (property.minimum !== undefined && !numericBound(value, property.minimum, true)) {
        throw new Error(`${path} must be at least ${property.minimum}.`);
      }

      if (property.maximum !== undefined && !numericBound(value, property.maximum, false)) {
        throw new Error(`${path} must not exceed ${property.maximum}.`);
      }
  }
}

function fieldValue(property: SchemaProperty, field: ParameterFieldDraft): Value {
  if (property.type === 'string') {
    return jsonToValue(field.text);
  }

  if (property.type === 'boolean') {
    return jsonToValue(field.checked);
  }

  return jsonTextToValue(field.text);
}

/** Validate the retained schema subset without losing unconstrained, visible input. */
export function actionParameterValue(
  schema: Schema | undefined,
  draft: ActionParameterDraft,
): Value {
  if (!schema) {
    return jsonTextToValue(draft.raw);
  }

  const additional = jsonTextToValue(draft.additional);
  if (additional.kind !== 'map') {
    throw new Error('Additional parameters must be a JSON object.');
  }

  const values = { ...additional.value };
  for (const [name, property] of Object.entries(schema.properties ?? {})) {
    if (Object.hasOwn(values, name)) {
      throw new Error(`${name} must be edited in its own field, not in additional parameters.`);
    }

    const field = draft.fields[name];
    if (field?.enabled) {
      try {
        values[name] = fieldValue(property, field);
      } catch (error) {
        throw new Error(`${name}: ${error instanceof Error ? error.message : 'Invalid value.'}`);
      }
    }
  }

  const value: Value = { kind: 'map', value: values };
  validateObject(schema, value, 'Parameters');
  return value;
}
