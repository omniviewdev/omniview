import React, { useState } from 'react';
import { Button, Chip, IconButton, Separator, Stack, Text } from '@omniviewdev/base-ui';
import { LuPlus, LuShield, LuTrash2 } from 'react-icons/lu';
import TextInput from '../../../shared/ui/TextInput';
import SelectInput from '../../../shared/ui/SelectInput';
import FormSection from '../../../shared/forms/FormSection';
import styles from './SecurityGroupRuleForm.module.css';

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
    spacing={2}
    align='center'
    className={styles.ruleRow}
  >
    <Chip size='sm' variant='outline' style={{ borderRadius: 4, minWidth: 70, justifyContent: 'center' }}>{protocolLabel(rule.protocol)}</Chip>
    <Text as="div" size="xs" style={{ fontFamily: 'monospace', minWidth: 80, textAlign: 'center' }}>
      {portDisplay(rule)}
    </Text>
    <Text size="xs" style={{ fontFamily: 'monospace', flex: 1, minWidth: 0 }}>
      {rule.source || 'Any'}
    </Text>
    <Text size="xs" tone='muted' style={{ flex: 0.7, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
      {rule.description}
    </Text>
    {!readOnly && (
      <IconButton size='sm' variant='ghost' color='danger' aria-label='Remove' onClick={onRemove}>
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
    <Stack spacing={2} style={{ padding: 12 }}>
      <Stack direction='row' spacing={2} wrap>
        <div style={{ minWidth: 130 }}>
          <Text as="div" size="xs" style={{ marginBottom: 4 }}>Protocol</Text>
          <SelectInput
            size='sm'
            value={protocol}
            onChange={(value) => setProtocol(value || '-1')}
            options={PROTOCOL_OPTIONS}
          />
        </div>
        {needsPorts && (
          <>
            <div style={{ width: 80 }}>
              <Text as="div" size="xs" style={{ marginBottom: 4 }}>From Port</Text>
              <TextInput
                size='sm'
                type='number'
                value={String(fromPort)}
                inputProps={{ min: 0, max: 65535 }}
                onChange={(value) => setFromPort(value === '' ? '' : Number(value))}
              />
            </div>
            <div style={{ width: 80 }}>
              <Text as="div" size="xs" style={{ marginBottom: 4 }}>To Port</Text>
              <TextInput
                size='sm'
                type='number'
                value={String(toPort)}
                inputProps={{ min: 0, max: 65535 }}
                onChange={(value) => setToPort(value === '' ? '' : Number(value))}
              />
            </div>
          </>
        )}
        <div style={{ flex: 1, minWidth: 150 }}>
          <Text as="div" size="xs" style={{ marginBottom: 4 }}>Source / CIDR</Text>
          <TextInput
            size='sm'
            value={source}
            placeholder='0.0.0.0/0 or sg-xxx'
            onChange={(value) => setSource(value)}
          />
        </div>
        <div style={{ flex: 0.7, minWidth: 120 }}>
          <Text as="div" size="xs" style={{ marginBottom: 4 }}>Description</Text>
          <TextInput
            size='sm'
            value={description}
            placeholder='Optional'
            onChange={(value) => setDescription(value)}
          />
        </div>
      </Stack>
      <div>
        <Button size='sm' variant='soft' color='brand' startDecorator={<LuPlus size={14} />} onClick={handleAdd}>
          Add Rule
        </Button>
      </div>
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
          spacing={2}
          style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 4, paddingBottom: 4, borderBottom: '1px solid var(--ov-color-border-default)' }}
        >
          <Text size="xs" style={{ fontWeight: 700, minWidth: 70 }}>Protocol</Text>
          <Text as="div" size="xs" style={{ fontWeight: 700, minWidth: 80, textAlign: 'center' }}>Port Range</Text>
          <Text size="xs" style={{ fontWeight: 700, flex: 1 }}>Source</Text>
          <Text size="xs" style={{ fontWeight: 700, flex: 0.7 }}>Description</Text>
          {!readOnly && <div style={{ width: 32 }} />}
        </Stack>

        {/* Rules */}
        {rows.map((rule, i) => (
          <RuleRowDisplay key={i} rule={rule} onRemove={() => handleRemoveRow(i)} readOnly={readOnly} />
        ))}

        {rows.length === 0 && (
          <div style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 12, paddingBottom: 12 }}>
            <Text as="div" size="xs" tone='muted' style={{ textAlign: 'center' }}>No rules</Text>
          </div>
        )}

        {/* Add section */}
        {!readOnly && (
          <>
            <Separator />
            {showAddForm ? (
              <AddRuleForm onAdd={handleAddRule} />
            ) : (
              <div style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 6, paddingBottom: 6 }}>
                <Button
                  size='sm'
                  variant='ghost'
                  color='brand'
                  startDecorator={<LuPlus size={14} />}
                  onClick={() => setShowAddForm(true)}
                >
                  Add rule
                </Button>
              </div>
            )}
          </>
        )}
      </Stack>
    </FormSection>
  );
};

export default SecurityGroupRuleForm;
