import { describe, expect, it } from 'vitest';
import { jsonTextToValue, type Schema } from '@omniviewdev/runtime';
import { actionParameterValue, createActionParameterDraft } from './actionParameters';

describe('reviewed action parameters', () => {
  it('keeps uint64 input exact through scalar and JSON array fields', () => {
    const schema: Schema = {
      properties: { capacity: { type: 'integer' }, snapshots: { type: 'array' } },
      required: ['capacity'],
    };
    const input = jsonTextToValue(
      '{"capacity":18446744073709551615,"snapshots":[9007199254740993]}',
    );
    const draft = createActionParameterDraft(schema, input);
    expect(actionParameterValue(schema, draft)).toEqual(input);
    draft.fields.capacity.text = '18446744073709551616';
    expect(() => actionParameterValue(schema, draft)).toThrow(/range/);
  });

  it('compares integer bounds without rounding adjacent values through number', () => {
    const schema: Schema = {
      properties: { capacity: { type: 'integer', minimum: 9007199254740992 } },
      required: ['capacity'],
    };
    const draft = createActionParameterDraft(
      schema,
      jsonTextToValue('{"capacity":9007199254740993}'),
    );
    expect(actionParameterValue(schema, draft)).toEqual(
      jsonTextToValue('{"capacity":9007199254740993}'),
    );
    draft.fields.capacity.text = '9007199254740991';
    expect(() => actionParameterValue(schema, draft)).toThrow(/at least/);
  });

  it('distinguishes omitted optional input from explicit false and empty text', () => {
    const schema: Schema = {
      properties: { verify: { type: 'boolean' }, note: { type: 'string' } },
    };
    const draft = createActionParameterDraft(schema, jsonTextToValue('{}'));
    expect(actionParameterValue(schema, draft)).toEqual(jsonTextToValue('{}'));
    draft.fields.verify.enabled = true;
    draft.fields.note.enabled = true;
    expect(actionParameterValue(schema, draft)).toEqual(
      jsonTextToValue('{"verify":false,"note":""}'),
    );
  });

  it('preserves visible unconstrained values and checks nested required and enum constraints', () => {
    const schema: Schema = {
      properties: {
        policy: {
          type: 'object',
          properties: { mode: { type: 'string', enum: ['safe', 'fast'] } },
          required: ['mode'],
        },
      },
      required: ['policy'],
    };
    const input = jsonTextToValue(
      '{"policy":{"mode":"safe","opaque":9007199254740993},"providerFlag":true}',
    );
    const draft = createActionParameterDraft(schema, input);
    expect(actionParameterValue(schema, draft)).toEqual(input);
    draft.fields.policy.text = '{"mode":"unsafe"}';
    expect(() => actionParameterValue(schema, draft)).toThrow(/available choices/);
    draft.fields.policy.text = '{}';
    expect(() => actionParameterValue(schema, draft)).toThrow(/mode is required/);
  });

  it('rejects hidden duplicate fields in additional parameters', () => {
    const schema: Schema = { properties: { replicas: { type: 'integer' } } };
    const draft = createActionParameterDraft(schema, jsonTextToValue('{"replicas":3}'));
    draft.additional = '{"replicas":9}';
    expect(() => actionParameterValue(schema, draft)).toThrow(/own field/);
  });
});
