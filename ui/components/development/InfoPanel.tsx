import Tabs from '@mui/joy/Tabs';
import TabList from '@mui/joy/TabList';
import Tab from '@mui/joy/Tab';
import TabPanel from '@mui/joy/TabPanel';
import ListItemDecorator from '@mui/joy/ListItemDecorator';
import { LuPlug } from 'react-icons/lu';

export default function DevelopmentInfoPanel() {
  return (
    <Tabs aria-label="DevelopmentInfoPanel" defaultValue={0}>
      <TabList>
        <Tab>
          <ListItemDecorator>
            <LuPlug />
          </ListItemDecorator>
          Extension Points
        </Tab>
      </TabList>
      <TabPanel value={0}>
        Extension Points view
      </TabPanel>
    </Tabs>
  );
}
