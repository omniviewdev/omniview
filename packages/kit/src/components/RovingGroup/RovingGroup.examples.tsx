import { Button, Chip, IconButton, RovingGroup } from '@omniviewdev/kit';
import { useState } from 'react';

/** Three commands in one tab stop: Tab enters the row at its first command and leaves it again; Left and Right move, Home and End go to the ends. */
export const Row = () => (
  <RovingGroup label="Text alignment" gap={4}>
    <Button variant="ghost" size="compact">
      Left
    </Button>
    <Button variant="ghost" size="compact">
      Center
    </Button>
    <Button variant="ghost" size="compact">
      Right
    </Button>
  </RovingGroup>
);

/** A column: Up and Down move, Left and Right are left to the page. */
export const Column = () => (
  <RovingGroup label="Sort by" kind="column" gap={4} align="start">
    <Button variant="ghost" size="compact">
      Name
    </Button>
    <Button variant="ghost" size="compact">
      Size
    </Button>
    <Button variant="ghost" size="compact">
      Date
    </Button>
  </RovingGroup>
);

const STATES = [
  { name: 'All', count: 12 },
  { name: 'Running', count: 9 },
  { name: 'Failed', count: 3 },
] as const;

/** The tab stop is the pressed chip, not the first: Tab lands where the choice is. Press another chip and the stop follows the focus. */
export const PressedIsTheStop = () => {
  const [selected, setSelected] = useState<string>('Running');
  return (
    <RovingGroup label="Item state" gap={8} wrap align="center">
      {STATES.map((state) => (
        <Chip
          key={state.name}
          pressed={selected === state.name}
          count={state.count}
          onClick={() => {
            setSelected(state.name);
          }}
        >
          {state.name}
        </Chip>
      ))}
    </RovingGroup>
  );
};

/** A command that is unavailable for a reason is still in the group: the keyboard reaches it and reads why. */
export const ReasonedDisabledStaysReachable = () => (
  <RovingGroup label="Actions" gap={4}>
    <Button variant="ghost" size="compact">
      Copy
    </Button>
    <Button variant="ghost" size="compact" disabledReason="Nothing is selected">
      Delete
    </Button>
    <Button variant="ghost" size="compact">
      Share
    </Button>
  </RovingGroup>
);

/** A toolbar of icon buttons, each named by its label: the group is one stop however many there are. */
export const IconButtons = () => (
  <RovingGroup label="View" gap={4}>
    <IconButton icon="folder-tree" label="List" variant="ghost" />
    <IconButton icon="box" label="Grid" variant="ghost" />
    <IconButton icon="columns" label="Columns" variant="ghost" />
  </RovingGroup>
);
