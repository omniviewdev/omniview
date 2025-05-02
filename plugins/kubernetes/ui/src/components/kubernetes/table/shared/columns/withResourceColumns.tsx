import { ColumnDef } from "@tanstack/react-table";
import selectColumn from "./selectColumn";
import nameColumn from './nameColumn';
import namespaceColumn from "./namespaceColumn";
import ageColumn from "./ageColumn";
import { ObjectMeta } from "kubernetes-types/meta/v1";
import actionsColumn from "./actionsColumn";
import { ColumnArgs } from "./types";

type Resource = {
  metadata?: ObjectMeta
}

/**
 * Provides the standard columns for cluster-scoped resources (non-namespaced)
 */
export function withClusterResourceColumns<T extends Resource>(columns: Array<ColumnDef<T>>, args: ColumnArgs): Array<ColumnDef<T>> {
  return [
    selectColumn(),
    nameColumn(),
    ...columns,
    ageColumn(),
    actionsColumn(args),
  ]
}

/**
 * Provides the standard columns for namespace-scoped resources
 */
export function withNamespacedResourceColumns<T extends Resource>(columns: Array<ColumnDef<T>>, args: ColumnArgs): Array<ColumnDef<T>> {
  return [
    selectColumn(),
    nameColumn(),
    namespaceColumn(),
    ...columns,
    ageColumn(),
    actionsColumn(args),
  ]
}
