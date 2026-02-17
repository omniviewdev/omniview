import React, { useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Divider,
  FormControl,
  FormLabel,
  IconButton,
  Input,
  Option,
  Select,
  Stack,
  Typography,
} from '@mui/joy';
import { LuPlus, LuShield, LuTrash2 } from 'react-icons/lu';
import FormSection from '../../../shared/forms/FormSection';

// ── Types ─────────────────────────────────────────────────────────────────────

export type IpPermission = {
  IpProtocol: string;
  FromPort?: number;
  ToPort?: number;
  IpRanges?: Array<{ CidrIp?: string; Description?: string }>;
  Ipv6Ranges?: Array<{ CidrIpv6?: string; Description?: string }>;
  UserIdGroupPairs?: Array<{ GroupId?: string; Description?: string }>;
  PrefixListIds?: Array<{ PrefixListId?: string; Description?: string }>;
};

type RuleRow = {
  protocol: string;
  fromPort: number | '';
  toPort: number | '';
  source: string;
  description: string;
};

const PROTOCOL_OPTIONS = [
  { label: 'All traffic', value: '-1' },
  { label: 'TCP', value: 'tcp' },
  { label: 'UDP', value: 'udp' },
  { label: 'ICMP', value: 'icmp' },
  { label: 'ICMPv6', value: '58' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function permissionsToRows(perms: IpPermission[]): RuleRow[] {
  const rows: RuleRow[] = [];
  for (const perm of perms) {
    const ipRanges = perm.IpRanges || [];
    const ipv6Ranges = perm.Ipv6Ranges || [];
    const groups = perm.UserIdGroupPairs || [];
    const prefixes = perm.PrefixListIds || [];

    for (const range of ipRanges) {
      rows.push({
        protocol: perm.IpProtocol,
        fromPort: perm.FromPort ?? '',
        toPort: perm.ToPort ?? '',
        source: range.CidrIp || '',
        description: range.Description || '',
      });
    }
    for (const range of ipv6Ranges) {
      rows.push({
        protocol: perm.IpProtocol,
        fromPort: perm.FromPort ?? '',
        toPort: perm.ToPort ?? '',
        source: range.CidrIpv6 || '',
        description: range.Description || '',
      });
    }
    for (const group of groups) {
      rows.push({
        protocol: perm.IpProtocol,
        fromPort: perm.FromPort ?? '',
        toPort: perm.ToPort ?? '',
        source: group.GroupId || '',
        description: group.Description || '',
      });
    }
    for (const prefix of prefixes) {
      rows.push({
        protocol: perm.IpProtocol,
        fromPort: perm.FromPort ?? '',
        toPort: perm.ToPort ?? '',
        source: prefix.PrefixListId || '',
        description: prefix.Description || '',
      });
    }
    // If no sources at all, still show the rule
    if (ipRanges.length === 0 && ipv6Ranges.length === 0 && groups.length === 0 && prefixes.length === 0) {
      rows.push({
        protocol: perm.IpProtocol,
        fromPort: perm.FromPort ?? '',
        toPort: perm.ToPort ?? '',
        source: '',
        description: '',
      });
    }
  }
  return rows;
}

function protocolLabel(proto: string): string {
  return PROTOCOL_OPTIONS.find((p) => p.value === proto)?.label || proto;
}

function portDisplay(row: RuleRow): string {
  if (row.protocol === '-1') return 'All';
  if (row.protocol === 'icmp' || row.protocol === '58') return 'N/A';
  if (row.fromPort === '' && row.toPort === '') return 'All';
  if (row.fromPort === row.toPort) return String(row.fromPort);
  return `${row.fromPort} - ${row.toPort}`;
}

// ── Subcomponents ─────────────────────────────────────────────────────────────

const RuleRowDisplay: React.FC<{
  rule: RuleRow;
  onRemove: () => void;
  readOnly?: boolean;
}> = ({ rule, onRemove, readOnly }) => (
  <Stack
    direction='row'
    spacing={1}
    alignItems='center'
    sx={{ px: 1.5, py: 0.5, '&:hover': { bgcolor: 'background.level2' } }}
  >
    <Chip size='sm' variant='outlined' sx={{ borderRadius: 'sm', minWidth: 70, justifyContent: 'center' }}>
      {protocolLabel(rule.protocol)}
    </Chip>
    <Typography level='body-xs' fontFamily='monospace' sx={{ minWidth: 80, textAlign: 'center' }}>
      {portDisplay(rule)}
    </Typography>
    <Typography level='body-xs' fontFamily='monospace' sx={{ flex: 1, minWidth: 0 }}>
      {rule.source || 'Any'}
    </Typography>
    <Typography level='body-xs' color='neutral' sx={{ flex: 0.7, minWidth: 0 }} noWrap>
      {rule.description}
    </Typography>
    {!readOnly && (
      <IconButton size='sm' variant='plain' color='danger' onClick={onRemove}>
        <LuTrash2 size={14} />
      </IconButton>
    )}
  </Stack>
);

const AddRuleForm: React.FC<{
  onAdd: (rule: RuleRow) => void;
}> = ({ onAdd }) => {
  const [protocol, setProtocol] = useState('-1');
  const [fromPort, setFromPort] = useState<number | ''>('');
  const [toPort, setToPort] = useState<number | ''>('');
  const [source, setSource] = useState('0.0.0.0/0');
  const [description, setDescription] = useState('');

  const needsPorts = protocol === 'tcp' || protocol === 'udp';

  const handleAdd = () => {
    onAdd({ protocol, fromPort, toPort, source, description });
    setProtocol('-1');
    setFromPort('');
    setToPort('');
    setSource('0.0.0.0/0');
    setDescription('');
  };

  return (
    <Stack spacing={1} sx={{ p: 1.5 }}>
      <Stack direction='row' spacing={1} flexWrap='wrap'>
        <FormControl size='sm' sx={{ minWidth: 130 }}>
          <FormLabel>Protocol</FormLabel>
          <Select size='sm' value={protocol} onChange={(_, v) => setProtocol(v || '-1')}>
            {PROTOCOL_OPTIONS.map((opt) => (
              <Option key={opt.value} value={opt.value}>{opt.label}</Option>
            ))}
          </Select>
        </FormControl>
        {needsPorts && (
          <>
            <FormControl size='sm' sx={{ width: 80 }}>
              <FormLabel>From Port</FormLabel>
              <Input
                size='sm'
                type='number'
                value={fromPort}
                slotProps={{ input: { min: 0, max: 65535 } }}
                onChange={(e) => setFromPort(e.target.value === '' ? '' : Number(e.target.value))}
              />
            </FormControl>
            <FormControl size='sm' sx={{ width: 80 }}>
              <FormLabel>To Port</FormLabel>
              <Input
                size='sm'
                type='number'
                value={toPort}
                slotProps={{ input: { min: 0, max: 65535 } }}
                onChange={(e) => setToPort(e.target.value === '' ? '' : Number(e.target.value))}
              />
            </FormControl>
          </>
        )}
        <FormControl size='sm' sx={{ flex: 1, minWidth: 150 }}>
          <FormLabel>Source / CIDR</FormLabel>
          <Input
            size='sm'
            value={source}
            placeholder='0.0.0.0/0 or sg-xxx'
            onChange={(e) => setSource(e.target.value)}
          />
        </FormControl>
        <FormControl size='sm' sx={{ flex: 0.7, minWidth: 120 }}>
          <FormLabel>Description</FormLabel>
          <Input
            size='sm'
            value={description}
            placeholder='Optional'
            onChange={(e) => setDescription(e.target.value)}
          />
        </FormControl>
      </Stack>
      <Box>
        <Button size='sm' variant='soft' color='primary' startDecorator={<LuPlus size={14} />} onClick={handleAdd}>
          Add Rule
        </Button>
      </Box>
    </Stack>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────

type Props = {
  direction: 'inbound' | 'outbound';
  permissions: IpPermission[];
  onChange: (permissions: IpPermission[]) => void;
  onSave?: () => void;
  onReset?: () => void;
  dirty?: boolean;
  saving?: boolean;
  readOnly?: boolean;
};

const SecurityGroupRuleForm: React.FC<Props> = ({
  direction,
  permissions,
  onChange,
  onSave,
  onReset,
  dirty,
  saving,
  readOnly,
}) => {
  const [showAddForm, setShowAddForm] = useState(false);
  const rows = permissionsToRows(permissions);

  const handleRemoveRow = (index: number) => {
    // Rebuild permissions without this row
    const newRows = rows.filter((_, i) => i !== index);
    // Simple approach: convert rows back to permissions (one per row)
    const newPerms: IpPermission[] = newRows.map((r) => {
      const perm: IpPermission = { IpProtocol: r.protocol };
      if (r.fromPort !== '') perm.FromPort = r.fromPort;
      if (r.toPort !== '') perm.ToPort = r.toPort;
      if (r.source) {
        if (r.source.startsWith('sg-')) {
          perm.UserIdGroupPairs = [{ GroupId: r.source, Description: r.description || undefined }];
        } else if (r.source.startsWith('pl-')) {
          perm.PrefixListIds = [{ PrefixListId: r.source, Description: r.description || undefined }];
        } else if (r.source.includes(':')) {
          perm.Ipv6Ranges = [{ CidrIpv6: r.source, Description: r.description || undefined }];
        } else {
          perm.IpRanges = [{ CidrIp: r.source, Description: r.description || undefined }];
        }
      }
      return perm;
    });
    onChange(newPerms);
  };

  const handleAddRule = (rule: RuleRow) => {
    const perm: IpPermission = { IpProtocol: rule.protocol };
    if (rule.fromPort !== '') perm.FromPort = rule.fromPort;
    if (rule.toPort !== '') perm.ToPort = rule.toPort;
    if (rule.source) {
      if (rule.source.startsWith('sg-')) {
        perm.UserIdGroupPairs = [{ GroupId: rule.source, Description: rule.description || undefined }];
      } else if (rule.source.startsWith('pl-')) {
        perm.PrefixListIds = [{ PrefixListId: rule.source, Description: rule.description || undefined }];
      } else if (rule.source.includes(':')) {
        perm.Ipv6Ranges = [{ CidrIpv6: rule.source, Description: rule.description || undefined }];
      } else {
        perm.IpRanges = [{ CidrIp: rule.source, Description: rule.description || undefined }];
      }
    }
    onChange([...permissions, perm]);
    setShowAddForm(false);
  };

  const title = direction === 'inbound' ? 'Inbound Rules' : 'Outbound Rules';

  return (
    <FormSection
      title={title}
      icon={<LuShield size={16} />}
      onSave={onSave}
      onReset={onReset}
      dirty={dirty}
      saving={saving}
    >
      <Stack spacing={0}>
        {/* Header */}
        <Stack
          direction='row'
          spacing={1}
          sx={{ px: 1.5, py: 0.5, borderBottom: '1px solid', borderColor: 'divider' }}
        >
          <Typography level='body-xs' fontWeight={700} sx={{ minWidth: 70 }}>Protocol</Typography>
          <Typography level='body-xs' fontWeight={700} sx={{ minWidth: 80, textAlign: 'center' }}>Port Range</Typography>
          <Typography level='body-xs' fontWeight={700} sx={{ flex: 1 }}>Source</Typography>
          <Typography level='body-xs' fontWeight={700} sx={{ flex: 0.7 }}>Description</Typography>
          {!readOnly && <Box sx={{ width: 32 }} />}
        </Stack>

        {/* Rules */}
        {rows.map((rule, i) => (
          <RuleRowDisplay key={i} rule={rule} onRemove={() => handleRemoveRow(i)} readOnly={readOnly} />
        ))}

        {rows.length === 0 && (
          <Box sx={{ px: 1.5, py: 1.5 }}>
            <Typography level='body-xs' color='neutral' textAlign='center'>No rules</Typography>
          </Box>
        )}

        {/* Add section */}
        {!readOnly && (
          <>
            <Divider />
            {showAddForm ? (
              <AddRuleForm onAdd={handleAddRule} />
            ) : (
              <Box sx={{ px: 1.5, py: 0.75 }}>
                <Button
                  size='sm'
                  variant='plain'
                  color='primary'
                  startDecorator={<LuPlus size={14} />}
                  onClick={() => setShowAddForm(true)}
                >
                  Add rule
                </Button>
              </Box>
            )}
          </>
        )}
      </Stack>
    </FormSection>
  );
};

export default SecurityGroupRuleForm;
