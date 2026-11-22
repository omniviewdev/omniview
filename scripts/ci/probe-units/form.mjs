// The form parts (FM2a: Field, TextInput, NumberInput, Toggle, Select and SecretInput) against the pinned mock reference (packages/kit/probes/mock-form.json, measured from the mock's own helpers by mock-form-measure.mjs):
// the face, the message lane in each kind, the label, the switch, the number field, the select and the secret, at rest and in each state with real focus and the pointer, in Void and in Light; every example in every state of
// the field model; a typed secret that is found nowhere in the page but the live input; the keyboard paths; the paints of the parts in the nine themes; and axe, at 1440 x 900 and 1280 x 800 in both engines. It reads the
// ui-next build the shard makes.
const PATHS = [
  'packages/kit/probes/{form-probe.mjs,form-cases.mjs,mock-form.json,mock-form-measure.mjs}',
  'packages/kit/src/components/{Field,FormControl,TextInput,NumberInput,Toggle,Select,SecretInput}/**',
  'ui-next/parts/**',
];

export const units = [
  {
    id: 'form',
    name: 'Probe the form parts against the pinned mock reference',
    script: 'packages/kit/probes/form-probe.mjs',
    env: { DIST: '$PROBE_DIST', REPORT: '$RUNNER_TEMP/form-probe.json' },
    seconds: 37,
    paths: PATHS,
  },

  // The negative controls of the form probe: each plants one fault in the page after it loaded, and the fault trips the one assertion it is named for and no other (a text field at rest 4 px taller, a code-face field in the
  // interface face, a lane message 6 px lower, a switch track 4 px wider in the same place, padding in the number field, a label that is for no control, a read-only switch that is not exposed as unavailable, a stepper button
  // that is a tab stop, a locked select whose keydown is not refused, the typed secret copied into an attribute of its input). A control passes (exit 0) when its assertion sees the fault; with that assertion removed
  // (ASSERTION_OFF=says) nothing at all is left (exit 1, NOT DETECTED), and a fault that trips another assertion is INVALID (exit 2). Chromium at 1440 x 900, the section of the fault only.
  {
    id: 'form-controls',
    name: 'Probe that the form probe sees a form that is wrong',
    script: 'packages/kit/probes/form-probe.mjs',
    env: { DIST: '$PROBE_DIST' },
    controls: ['face-height', 'mono-font', 'lane-offset', 'track-width', 'stepper-pad', 'label-for', 'switch-pressable', 'step-tab-stop', 'select-unblocked', 'secret-attribute'],
    seconds: 36,
    paths: PATHS,
  },
];
