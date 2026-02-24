// Auto-generated shim for '@omniviewdev/ui/inputs'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['@omniviewdev/ui/inputs'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "@omniviewdev/ui/inputs" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

export const Autocomplete = mod.Autocomplete;
export const Checkbox = mod.Checkbox;
export const ColorPicker = mod.ColorPicker;
export const DebouncedInput = mod.DebouncedInput;
export const FormField = mod.FormField;
export const FormSection = mod.FormSection;
export const KeyValueEditor = mod.KeyValueEditor;
export const RadioGroup = mod.RadioGroup;
export const SearchInput = mod.SearchInput;
export const Select = mod.Select;
export const Slider = mod.Slider;
export const Switch = mod.Switch;
export const TagInput = mod.TagInput;
export const TextArea = mod.TextArea;
export const TextField = mod.TextField;
export const TimeRangePicker = mod.TimeRangePicker;

export default mod.default !== undefined ? mod.default : mod;
