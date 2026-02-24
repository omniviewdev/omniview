import React from "react";

// material-ui
import { Chip } from "@omniviewdev/ui";
import Grid from "@mui/material/Grid";
import { Stack } from "@omniviewdev/ui/layout";
import { Text } from "@omniviewdev/ui/typography";

// types
import { Ingress } from "kubernetes-types/networking/v1";
import { DrawerContext } from "@omniviewdev/runtime";

// project-imports
import ObjectMetaSection from "../../../shared/ObjectMetaSection";
import DetailsCard, { DetailsCardEntry } from "../../../shared/DetailsCard";
import { containsKeyWithPrefix } from "../../../../utils/objects";
import Card from "../../../shared/Card";
import RuleTable from "./RuleTable";
import { BrowserOpenURL } from "../../../../utils/ide";

interface Props {
  ctx: DrawerContext<Ingress>;
}

export const IngressSidebar: React.FC<Props> = ({ ctx }) => {
  if (!ctx.data) {
    return null;
  }

  const obj = ctx.data;

  // compose your component here
  return (
    <Stack direction="column" width={"100%"} spacing={1}>
      <ObjectMetaSection data={obj.metadata} />
      <div>
        <Grid container spacing={0.5}>
          {!!obj.status?.loadBalancer?.ingress?.length && (
            <Grid size={12}>
              <LoadBalancerInfo obj={obj} />
            </Grid>
          )}
          <Grid size={12}>
            <RuleInfo obj={obj} />
          </Grid>
          {/* AWS Load Balancer Controller */}
          {containsKeyWithPrefix(
            obj?.metadata?.annotations,
            "alb.ingress.kubernetes.io",
          ) && (
            <Grid size={12}>
              <AWSLoadBalancerControllerInfo obj={obj} />
            </Grid>
          )}
        </Grid>
      </div>
      {/* <pre>{JSON.stringify(data, null, 2)}</pre>; */}
    </Stack>
  );
};

interface InfoSectionProps {
  obj: Ingress;
}

const annotationValue = (obj: Ingress, key: string) => {
  return obj.metadata?.annotations?.["alb.ingress.kubernetes.io/" + key] ?? "";
};

const LoadBalancerInfo: React.FC<InfoSectionProps> = ({ obj }) => {
  const data = [] as DetailsCardEntry[];

  obj.status?.loadBalancer?.ingress?.forEach((ingress) => {
    if (ingress.hostname || ingress.ip) {
      data.push({
        key: ingress.hostname ? "Hostname" : "IP",
        value: `${ingress.hostname ?? ingress.ip} ${ingress.ports?.map((p) => `${p.protocol ?? ""}${p.port ?? ""}`).join(", ") ?? ""}`,
      });
    }
  });

  return <DetailsCard title="Load Balancer" data={data} />;
};

const RuleInfo: React.FC<InfoSectionProps> = ({ obj }) => {
  return (
    <Card title="Rules" icon="LuNetwork">
      {obj.spec?.rules?.map((rule) => (
        <Stack direction="column" spacing={1} p={1}>
          <Chip
            sx={{ px: 1, borderRadius: "sm" }}
            emphasis="outline"
            onClick={() =>
              rule.host &&
              BrowserOpenURL(
                rule.host.startsWith("http")
                  ? rule.host
                  : "https://" + rule.host,
              )
            }
            label={rule.host}
          />
          {rule.http?.paths ? (
            <RuleTable rule={rule} />
          ) : (
            <Text size="sm">No paths defined</Text>
          )}
        </Stack>
      ))}
    </Card>
  );
};

const AWSLoadBalancerControllerInfo: React.FC<InfoSectionProps> = ({ obj }) => {
  const data = [
    {
      key: "Name",
      value: annotationValue(obj, "load-balancer-name"),
      ratio: [4, 8],
    },
    {
      key: "Group",
      value: annotationValue(obj, "group.name"),
      ratio: [4, 8],
    },
    {
      key: "Group Order",
      value: annotationValue(obj, "group.order"),
      ratio: [4, 8],
    },
    {
      key: "Scheme",
      value: annotationValue(obj, "scheme"),
      ratio: [4, 8],
    },
    {
      key: "Certificate ARN",
      value: annotationValue(obj, "certificate-arn"),
      ratio: [4, 8],
    },
    {
      key: "Healthcheck Protocol",
      value: annotationValue(obj, "healthcheck-protocol"),
      ratio: [4, 8],
    },
    {
      key: "Healthcheck Path",
      value: annotationValue(obj, "healthcheck-path"),
      ratio: [4, 8],
    },
    {
      key: "Healthcheck Port",
      value: annotationValue(obj, "healthcheck-port"),
      ratio: [4, 8],
    },
  ] as DetailsCardEntry[];
  return (
    <DetailsCard
      title="AWS Load Balancer Controller"
      icon="https://kubernetes-sigs.github.io/aws-load-balancer-controller/v2.7/assets/images/aws_load_balancer_icon.svg"
      data={data}
    />
  );
};

export default IngressSidebar;
