import type { LogSource } from '@/providers/BottomDrawer/containers/LogViewer/types';

export interface LogFilterComponentProps {
  sessionId: string;
  sources: LogSource[];
  selectedSourceIds: Set<string>;
  onSourceSelectionChange: (ids: Set<string>) => void;
}
