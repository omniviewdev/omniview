import { TabPanel, Tabs, Text, type TabsItem } from '@omniviewdev/kit';
import { useState } from 'react';
import styles from './Tabs.examples.module.css';

// A strip and its panel, written the way a consumer writes them: the caller owns which tab is selected and draws its section.
function Sections({ id, label, tabs, initial }: { readonly id: string; readonly label: string; readonly tabs: readonly TabsItem[]; readonly initial: string }) {
  const [selected, setSelected] = useState(initial);
  const current = tabs.find((tab) => tab.id === selected);
  return (
    <>
      <Tabs id={id} label={label} tabs={tabs} selected={selected} onSelect={setSelected} />
      <TabPanel id={id} selected={selected}>
        <Text tone="muted">{current === undefined ? '' : `${current.label} section`}</Text>
      </TabPanel>
    </>
  );
}

const PLAIN: readonly TabsItem[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'events', label: 'Events' },
  { id: 'metrics', label: 'Metrics' },
  { id: 'yaml', label: 'YAML' },
];

const COUNTED: readonly TabsItem[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'items', label: 'Items', count: 3 },
  { id: 'events', label: 'Events', count: 12 },
  { id: 'metrics', label: 'Metrics' },
  { id: 'yaml', label: 'YAML' },
];

const ICONS: readonly TabsItem[] = [
  { id: 'overview', label: 'Overview', icon: 'layers' },
  { id: 'items', label: 'Items', icon: 'box', count: 3 },
  { id: 'events', label: 'Events', icon: 'clock' },
  { id: 'servers', label: 'Servers', icon: 'server' },
];

/** The first tab is selected: its face is filled with the tab colour and edged. Hover another face for the toolbar hover; Tab enters the strip once. */
export const Plain = () => <Sections id="tabs-plain" label="Item sections" tabs={PLAIN} initial="overview" />;

/** A count after the label, muted, in tabular figures. Zero is a value: it is shown. */
export const WithCounts = () => (
  <Sections
    id="tabs-counts"
    label="Item sections"
    tabs={[...COUNTED.slice(0, 3), { id: 'alerts', label: 'Alerts', count: 0 }]}
    initial="items"
  />
);

/** A 16 px glyph before the label. The glyph of a face that is not selected takes the icon colour. */
export const WithIcons = () => <Sections id="tabs-icons" label="Item sections" tabs={ICONS} initial="overview" />;

/** A selected tab in the middle: the arrows move from it both ways and wrap at the ends; Home and End jump. A tab that gets the focus is selected. */
export const SelectedMiddleTab = () => <Sections id="tabs-middle" label="Item sections" tabs={COUNTED} initial="events" />;

/** Tabs that do not fit their box: the strip does not wrap, it scrolls sideways, and a tab that takes the focus scrolls into view. */
export const ManyTabsInNarrowBox = () => (
  <div className={styles.narrow}>
    <Sections
      id="tabs-narrow"
      label="Item sections"
      tabs={[...ICONS, { id: 'metrics', label: 'Metrics' }, { id: 'yaml', label: 'YAML' }, { id: 'history', label: 'History', count: 7 }]}
      initial="overview"
    />
  </div>
);

/** The strip with its panel: choosing a tab switches the section below it. The panel is named by the selected tab. */
export const WithPanel = () => <Sections id="tabs-panel" label="Item sections" tabs={COUNTED} initial="overview" />;

/** One tab: a strip of one, still a tablist, with one stop and nowhere to go. */
export const OneTab = () => <Sections id="tabs-one" label="Item sections" tabs={[{ id: 'overview', label: 'Overview' }]} initial="overview" />;
