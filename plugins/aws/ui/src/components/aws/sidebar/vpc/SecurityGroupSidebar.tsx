import React from "react";
import { Stack, Table, Text } from '@omniviewdev/base-ui';
import MetadataSection from "../../../shared/sidebar/pages/overview/sections/MetadataSection";
import DetailsCard from "../../../shared/DetailsCard";
import ExpandableSection from "../../../shared/ExpandableSection";
import TagsSection from "../sections/TagsSection";

interface Props {
  ctx: { data?: Record<string, any> };
}

const PROTOCOL_NAMES: Record<string, string> = {
  "-1": "All",
  "6": "TCP",
  "17": "UDP",
  "1": "ICMP",
};

function formatProtocol(protocol: string | undefined): string {
  if (!protocol) return "All";
  return PROTOCOL_NAMES[protocol] ?? protocol.toUpperCase();
}

function formatPortRange(rule: Record<string, any>): string {
  const protocol = rule.IpProtocol;
  if (protocol === "-1") return "All";
  const from = rule.FromPort;
  const to = rule.ToPort;
  if (from === undefined && to === undefined) return "All";
  if (from === to) return String(from);
  return `${from} - ${to}`;
}

function collectSources(rule: Record<string, any>): string {
  const sources: string[] = [];
  if (Array.isArray(rule.IpRanges)) {
    rule.IpRanges.forEach((r: Record<string, any>) => {
      if (r.CidrIp) sources.push(r.CidrIp);
    });
  }
  if (Array.isArray(rule.Ipv6Ranges)) {
    rule.Ipv6Ranges.forEach((r: Record<string, any>) => {
      if (r.CidrIpv6) sources.push(r.CidrIpv6);
    });
  }
  if (Array.isArray(rule.UserIdGroupPairs)) {
    rule.UserIdGroupPairs.forEach((r: Record<string, any>) => {
      if (r.GroupId) sources.push(r.GroupId);
    });
  }
  return sources.join(", ") || "-";
}

function collectDescription(rule: Record<string, any>): string {
  const lists = [
    ...(Array.isArray(rule.IpRanges) ? rule.IpRanges : []),
    ...(Array.isArray(rule.Ipv6Ranges) ? rule.Ipv6Ranges : []),
    ...(Array.isArray(rule.UserIdGroupPairs) ? rule.UserIdGroupPairs : []),
  ];
  for (const entry of lists) {
    if (entry.Description) return entry.Description;
  }
  return "-";
}

function RulesTable({ rules }: { rules: Array<Record<string, any>> }) {
  if (rules.length === 0) {
    return (
      <Text size="sm" tone="muted">
        No rules configured
      </Text>
    );
  }

  return (
    <Table size="sm">
      <Table.Head>
        <Table.Row>
          <Table.HeaderCell style={{ width: "15%", paddingTop: 4, paddingBottom: 4 }}>Protocol</Table.HeaderCell>
          <Table.HeaderCell style={{ width: "20%", paddingTop: 4, paddingBottom: 4 }}>Port Range</Table.HeaderCell>
          <Table.HeaderCell style={{ width: "35%", paddingTop: 4, paddingBottom: 4 }}>Source</Table.HeaderCell>
          <Table.HeaderCell style={{ width: "30%", paddingTop: 4, paddingBottom: 4 }}>Description</Table.HeaderCell>
        </Table.Row>
      </Table.Head>
      <Table.Body>
        {rules.map((rule, i) => (
          <Table.Row key={i}>
            <Table.Cell style={{ paddingTop: 4, paddingBottom: 4 }}>{formatProtocol(rule.IpProtocol)}</Table.Cell>
            <Table.Cell style={{ paddingTop: 4, paddingBottom: 4 }}>{formatPortRange(rule)}</Table.Cell>
            <Table.Cell style={{ paddingTop: 4, paddingBottom: 4, wordBreak: "break-all" }}>{collectSources(rule)}</Table.Cell>
            <Table.Cell style={{ paddingTop: 4, paddingBottom: 4 }}>{collectDescription(rule)}</Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table>
  );
}

const SecurityGroupSidebar: React.FC<Props> = ({ ctx }) => {
  const data = ctx.data || {};

  const inboundRules = Array.isArray(data?.IpPermissions)
    ? data.IpPermissions
    : [];
  const outboundRules = Array.isArray(data?.IpPermissionsEgress)
    ? data.IpPermissionsEgress
    : [];

  return (
    <Stack direction="column" spacing={2} style={{ width: "100%" }}>
      <MetadataSection data={data} />

      <DetailsCard
        title="Security Group Details"
        entries={[
          { label: "Group ID", value: data?.GroupId },
          { label: "Group Name", value: data?.GroupName },
          { label: "VPC ID", value: data?.VpcId },
          { label: "Description", value: data?.Description },
        ]}
      />

      <ExpandableSection
        sections={[
          {
            title: "Inbound Rules",
            count: inboundRules.length,
            defaultExpanded: true,
            content: <RulesTable rules={inboundRules} />,
          },
          {
            title: "Outbound Rules",
            count: outboundRules.length,
            defaultExpanded: false,
            content: <RulesTable rules={outboundRules} />,
          },
        ]}
      />

      <TagsSection data={data} />
    </Stack>
  );
};

export default SecurityGroupSidebar;
