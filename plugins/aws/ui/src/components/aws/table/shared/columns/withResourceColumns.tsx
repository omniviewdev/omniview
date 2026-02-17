import { ColumnDef } from "@tanstack/react-table";
import selectColumn from "./selectColumn";
import nameColumn from './nameColumn';
import regionColumn from "./regionColumn";
import actionsColumn from "./actionsColumn";
import { ColumnArgs } from "./types";

/**
 * Provides the standard columns for regional AWS resources (EC2, VPC, RDS, etc.)
 */
export function withRegionalResourceColumns<T>(columns: Array<ColumnDef<T>>, args: ColumnArgs): Array<ColumnDef<T>> {
  return [
    selectColumn(),
    nameColumn(),
    regionColumn(),
    ...columns,
    actionsColumn(args),
  ]
}

/**
 * Provides the standard columns for global AWS resources (IAM, Route53, CloudFront, S3)
 */
export function withGlobalResourceColumns<T>(columns: Array<ColumnDef<T>>, args: ColumnArgs): Array<ColumnDef<T>> {
  return [
    selectColumn(),
    nameColumn(),
    ...columns,
    actionsColumn(args),
  ]
}
