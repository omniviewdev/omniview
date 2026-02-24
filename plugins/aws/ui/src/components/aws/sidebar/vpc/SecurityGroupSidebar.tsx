import React from "react";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import { Stack } from "@omniviewdev/ui/layout";
import { Text } from "@omniviewdev/ui/typography";
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
      <Text size="sm" sx={{ color: "text.secondary" }}>
        No rules configured
      </Text>
    );
  }

  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell sx={{ width: "15%", py: 0.5 }}>Protocol</TableCell>
          <TableCell sx={{ width: "20%", py: 0.5 }}>Port Range</TableCell>
          <TableCell sx={{ width: "35%", py: 0.5 }}>Source</TableCell>
          <TableCell sx={{ width: "30%", py: 0.5 }}>Description</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {rules.map((rule, i) => (
          <TableRow key={i}>
            <TableCell sx={{ py: 0.5 }}>{formatProtocol(rule.IpProtocol)}</TableCell>
            <TableCell sx={{ py: 0.5 }}>{formatPortRange(rule)}</TableCell>
            <TableCell sx={{ py: 0.5, wordBreak: "break-all" }}>{collectSources(rule)}</TableCell>
            <TableCell sx={{ py: 0.5 }}>{collectDescription(rule)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
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
    <Stack direction="column" width="100%" spacing={1}>
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
