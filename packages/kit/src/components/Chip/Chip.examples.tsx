import { Chip, type ChipTone } from '@omniviewdev/kit';
import { useState } from 'react';

// A toggle written the way a consumer writes it: the caller owns the pressed state.
function StatefulChip({ text, count, tone, initial = false }: { readonly text: string; readonly count?: number; readonly tone?: ChipTone; readonly initial?: boolean }) {
  const [pressed, setPressed] = useState(initial);
  return (
    <Chip
      pressed={pressed}
      count={count}
      tone={tone}
      onClick={() => {
        setPressed(!pressed);
      }}
    >
      {text}
    </Chip>
  );
}

/** Static text, 18 px high: a fact, quietly. It never wraps. */
export const Static = () => <Chip>Running</Chip>;

/** A key and its value: the count is bold in the plain text colour. */
export const WithCount = () => <Chip count={80}>Running</Chip>;

/** A tone is a state, and the text still names it: border, fill and text take the role. */
export const ToneSuccess = () => <Chip tone="success">Passed</Chip>;

export const ToneWarning = () => <Chip tone="warning">Attention</Chip>;

export const ToneError = () => <Chip tone="error">Failed</Chip>;

export const ToneInfo = () => <Chip tone="info">Update available</Chip>;

export const ToneMuted = () => <Chip tone="muted">Completed</Chip>;

export const CountWithTone = () => (
  <Chip tone="success" count={80}>
    Passed
  </Chip>
);

/** Nothing in it: zero is a value, and the muted tone is how a quick filter shows that. */
export const CountWithMutedTone = () => (
  <Chip tone="muted" count={0}>
    Completed
  </Chip>
);

/** A toggle is a button, 28 px high, with the control edge: it says whether it is pressed. Press it. */
export const Toggle = () => <StatefulChip text="Failed" count={3} />;

/** The pressed fill: the selection role and the raised edge. */
export const TogglePressed = () => <StatefulChip text="Failed" count={3} initial />;

export const ToggleWithoutCount = () => <StatefulChip text="All" />;

export const ToggleSuccess = () => <StatefulChip text="Passed" count={3} tone="success" />;

export const ToggleWarning = () => <StatefulChip text="Attention" count={3} tone="warning" />;

export const ToggleError = () => <StatefulChip text="Failed" count={3} tone="error" />;

export const ToggleInfo = () => <StatefulChip text="Update available" count={3} tone="info" />;

export const ToggleMuted = () => <StatefulChip text="Completed" count={3} tone="muted" />;

/** Pressed paints over the tone: the choice is shown by the fill, never by a state colour. */
export const TogglePressedWithTone = () => <StatefulChip text="Passed" count={3} tone="success" initial />;

export const TogglePressedMuted = () => <StatefulChip text="Completed" count={3} tone="muted" initial />;

/** A removable chip: static text and a 24 px Remove button named for what it removes. */
export const Removable = () => <Chip onRemove={() => undefined}>app=cart-api</Chip>;

export const RemovableWithTone = () => (
  <Chip onRemove={() => undefined} tone="warning">
    app=cart-api
  </Chip>
);
