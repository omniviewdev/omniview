import { Tabs, TabPanel } from '@omniviewdev/ui/navigation';
import { LuPlug } from 'react-icons/lu';

export default function DevelopmentInfoPanel() {
  return (
    <Tabs
      aria-label="DevelopmentInfoPanel"
      defaultValue={0}
      tabs={[
        { label: 'Extension Points', value: 0, icon: <LuPlug /> },
      ]}
    >
      <TabPanel value={0}>
        Extension Points view
      </TabPanel>
    </Tabs>
  );
}
