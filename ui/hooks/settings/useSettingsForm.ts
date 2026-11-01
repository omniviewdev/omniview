import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SettingsCommitResult, SettingsValidationResult } from '@omniviewdev/runtime';

type Options = {
  validate: (id: string, value: unknown) => Promise<SettingsValidationResult>;
  commit: (values: Record<string, unknown>) => Promise<SettingsCommitResult>;
};

export type SettingsForm = {
  draftValues: Record<string, unknown>;
  setDraftValues: (values: Record<string, unknown>) => void;
  validation: Record<string, Pick<SettingsValidationResult, 'valid' | 'message'>>;
  saving: boolean;
  warning: string;
  save: () => Promise<boolean>;
  discard: () => void;
  hasDrafts: boolean;
};

export type SettingsNavigationForm = Pick<SettingsForm, 'hasDrafts' | 'save' | 'discard' | 'saving'>;
export const SettingsFormRegistration = createContext<((form: SettingsNavigationForm | null) => void) | null>(null);

export function useSettingsForm({ validate, commit }: Options): SettingsForm {
  const [draftValues, setDraftState] = useState<Record<string, unknown>>({});
  const [validation, setValidation] = useState<Record<string, Pick<SettingsValidationResult, 'valid' | 'message'>>>({});
  const [saving, setSaving] = useState(false);
  const [warning, setWarning] = useState('');
  const register = useContext(SettingsFormRegistration);
  const revision = useRef(0);
  const operations = useRef({ validate, commit });
  useLayoutEffect(() => {
    operations.current = { validate, commit };
  }, [validate, commit]);
  const setDraftValues = (values: Record<string, unknown>) => {
    revision.current++;
    setDraftState(values);
    setValidation(Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)
      .map(([id]) => [id, { valid: false, message: 'Checking…' }])));
  };

  const discard = () => {
    setDraftValues({}); 
  };

  useEffect(() => {
    const current = revision.current;
    const timer = window.setTimeout(() => {
      Object.entries(draftValues).filter(([, value]) => value !== undefined).forEach(([id, value]) => {
        operations.current.validate(id, value).then(result => {
          if (revision.current === current) {
            setValidation(previous => ({ ...previous, [id]: result }));
          }
        }).catch(() => {
          if (revision.current === current) {
            setValidation(previous => ({ ...previous, [id]: { valid: false, message: 'Could not validate. Save to retry.' } }));
          }
        });
      });
    }, 400);
    return () => {
      window.clearTimeout(timer); 
    };
  }, [draftValues]);
  useEffect(() => () => {
    revision.current++; 
  }, []);

  const save = async () => {
    const current = revision.current;
    const values = Object.fromEntries(Object.entries(draftValues).filter(([, value]) => value !== undefined));
    setSaving(true);
    try {
      const results = await Promise.all(Object.entries(values).map(async ([id, value]) =>
        [id, await operations.current.validate(id, value)] as const));
      if (current !== revision.current) {
        return false;
      }

      setValidation(Object.fromEntries(results));
      if (results.some(([, result]) => !result.valid)) {
        return false;
      }

      const result = await operations.current.commit(values);
      if (current !== revision.current) {
        return false;
      }

      discard();
      setWarning(!result.applied || result.uncertain ? result.message || 'Settings saved. Some changes could not be applied. Restart Omniview to apply saved changes.' : '');
      return true;
    } catch {
      if (current === revision.current) {
        setValidation(Object.fromEntries(Object.keys(values)
          .map(id => [id, { valid: false, message: 'Could not save. Check the value and try again.' }])));
      }

      return false;
    } finally {
      setSaving(false);
    }
  };

  const form = { draftValues, setDraftValues, validation, saving, warning, save, discard,
    hasDrafts: Object.values(draftValues).some(value => value !== undefined) };
  useLayoutEffect(() => {
    register?.(form);
  });
  useLayoutEffect(() => () => register?.(null), [register]);
  return form;
}
