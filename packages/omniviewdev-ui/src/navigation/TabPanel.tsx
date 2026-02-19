import Box from '@mui/material/Box';

export interface TabPanelProps {
  value: string;
  activeValue: string;
  children: React.ReactNode;
  keepMounted?: boolean;
}

export default function TabPanel({
  value,
  activeValue,
  children,
  keepMounted = false,
}: TabPanelProps) {
  const isActive = value === activeValue;

  if (!isActive && !keepMounted) return null;

  return (
    <Box
      role="tabpanel"
      hidden={!isActive}
      sx={{ display: isActive ? undefined : 'none' }}
    >
      {children}
    </Box>
  );
}

TabPanel.displayName = 'TabPanel';
