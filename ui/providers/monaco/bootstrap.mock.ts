import { vi } from 'vitest';

const mockSetDiagnosticsOptions = vi.fn();
const mockYamlUpdate = vi.fn();

export const monaco = {
  languages: {
    json: {
      jsonDefaults: {
        setDiagnosticsOptions: mockSetDiagnosticsOptions,
      },
    },
  },
};

export const monacoYaml = {
  update: mockYamlUpdate,
};
