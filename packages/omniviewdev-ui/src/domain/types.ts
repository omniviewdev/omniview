export interface KubeEvent {
  type: 'Normal' | 'Warning';
  reason: string;
  message: string;
  count?: number;
  firstTimestamp?: string;
  lastTimestamp?: string;
  involvedObject?: { kind: string; name: string; namespace?: string };
}

export interface LogLine {
  timestamp?: string;
  content: string;
  severity?: 'info' | 'warn' | 'error' | 'debug';
  source?: string;
}

export interface DescriptionItem {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
  copyable?: boolean;
}
