import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DataTable, dataTableFeatures } from "@omniviewdev/base-ui";
import { useResources } from "@omniviewdev/runtime";
import { ResourceClient } from "@omniviewdev/runtime/api";
import type { Value, HostEnumerateRequest, ResolvedResourceTarget } from "@omniviewdev/runtime";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useTable,
  type ColumnDef,
  type ExpandedState,
  type GroupingState,
} from "@tanstack/react-table";

const pluginID = "workspace-probe";
export const profiles = {
  "cloud-bundled-pages": "compute/instance",
  "container-bundled-events": "container",
  "hypervisor-bundled-vms": "vm",
  "kubernetes-snapshot": "core::v1::Pod",
} as const;
type Profile = keyof typeof profiles;
type Body = Record<string, unknown>;
type Sample = Record<string, unknown>;
type Row = { copy: number; body: Body; text: string; category: string };
const empty: Body[] = [];
const frames = () => {
  const { promise, resolve } = Promise.withResolvers<void>();
  requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  return promise;
};
const targets = new Map<Profile, ResolvedResourceTarget>();
async function resolveTarget(profile: Profile) {
  const cached = targets.get(profile);
  if (cached) return cached;
  const resolved = await ResourceClient.ResolveTarget(pluginID, {
    route: { connection: profile }, type: profiles[profile], representation: "native",
  });
  targets.set(profile, resolved);
  return resolved;
}
const request = (resolved: ResolvedResourceTarget, cursor = ""): HostEnumerateRequest => ({
  targetId: resolved.targetId,
  request: { target: resolved.target, pageSize: 200, ...(cursor ? { cursor } : {}) },
});
const list = async (profile: Profile, cursor = "") =>
  ResourceClient.Enumerate(pluginID, request(await resolveTarget(profile), cursor));
function decode(value: Value): unknown {
  switch (value.kind) {
    case "int64":
    case "uint64": {
      const integer = BigInt(value.value);
      return integer >= -9007199254740991n && integer <= 9007199254740991n
        ? Number(integer) : value.value;
    }
    case "null": return null;
    case "map": return Object.fromEntries(Object.entries(value.value).map(([key, item]) => [key, decode(item)]));
    case "list": return value.value.map(decode);
    default: return value.value;
  }
}
const bodiesOf = (page: { records: readonly { record: { body: Value } }[] }) =>
  page.records.map(({ record }) => decode(record.body) as Body);

interface BenchmarkControl {
  select(profile: Profile, copies: number): Promise<void>;
  mountEvents(): Promise<void>;
  unmount(): Promise<void>;
  metrics(): Promise<unknown>;
  release(): Promise<void>;
  snapshot(): unknown;
  clearOwnedCache(): Promise<void>;
  stop(): Promise<unknown>;
}
declare global {
  interface Window {
    __p02?: BenchmarkControl;
  }
}

// The opt-in page reuses fixed fixture connection IDs across root mounts.
// A new root must not race the previous root's asynchronous teardown.
let previousRootCleanup: Promise<unknown> = Promise.resolve();

function TransportTable({ bodies }: { bodies: Body[] }) {
  const [filter, setFilter] = useState("");
  const [grouping, setGrouping] = useState<GroupingState>([]);
  const [expanded, setExpanded] = useState<ExpandedState>({});
  const rows = useMemo<Row[]>(
    () =>
      bodies.map((body, copy) => ({
        copy,
        body,
        text: JSON.stringify(body),
        category: String(
          body.state ??
            body.name ??
            (body.status as { phase?: string } | undefined)?.phase ??
            "native",
        ),
      })),
    [bodies],
  );
  const columns = useMemo<ColumnDef<typeof dataTableFeatures, Row>[]>(
    () => [
      {
        id: "expand",
        header: "Detail",
        size: 90,
        cell: ({ row }) => (
          <button
            data-ov-expansion-toggle=""
            aria-label={`Expand copy ${row.original.copy}`}
            onClick={row.getToggleExpandedHandler()}
          >
            Details
          </button>
        ),
      },
      { accessorKey: "copy", header: "Payload copy", size: 110 },
      { accessorKey: "category", header: "Native value", size: 160 },
      {
        accessorKey: "text",
        header: "Actual decoded transport body (wide integers use decimal strings)",
        size: 1100,
      },
    ],
    [],
  );
  const table = useTable({
    features: dataTableFeatures,
    enableRowRangeSelection: false,
    manualPagination: true,
    data: rows,
    columns,
    state: { globalFilter: filter, grouping, expanded },
    onGroupingChange: setGrouping,
    onExpandedChange: setExpanded,
    onGlobalFilterChange: setFilter,
    manualSorting: true,
    getRowCanExpand: () => true,
    getRowId: (row) => String(row.copy),
    autoResetExpanded: false,
  });
  return (
    <div
      data-p02-table
      data-p02-rows={rows.length}
      data-p02-filtered={table.getFilteredRowModel().rows.length}
      data-p02-grouped={String(grouping.length > 0)}
    >
      <label>
        Local diagnostic filter{" "}
        <input
          aria-label="P02 local filter"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      </label>
      <button
        onClick={() => {
          setGrouping(grouping.length ? [] : ["category"]);
          setExpanded({});
        }}
      >
        Toggle diagnostic groups
      </button>
      <DataTable table={table} features={{ rowExpansion: true }}>
        <DataTable.Container
          style={{ height: 360, overflow: "auto" }}
          data-p02-scroll
        >
          <DataTable.Header />
          <DataTable.VirtualBody
            estimateRowSize={36}
            overscan={10}
            renderExpandedRow={(row: Row) => <pre>{row.text}</pre>}
          />
        </DataTable.Container>
      </DataTable>
    </div>
  );
}

function Finite({
  profile,
  copies,
  samples,
}: {
  profile: Profile;
  copies: number;
  samples: React.RefObject<Sample[]>;
}) {
  const query = useQuery({
    queryKey: ["p02-finite", profile, copies],
    retry: false,
    staleTime: Infinity,
    queryFn: async () => {
      const all: Body[] = [];
      let cursor = "";
      const seen = new Set<string>();
      do {
        if (seen.has(cursor)) throw new Error("Fixture repeated cursor");
        seen.add(cursor);
        const started = performance.now();
        const result = await list(profile, cursor);
        const bodies = bodiesOf(result);
        samples.current.push({
          phase: "finite-page",
          profile,
          copies,
          cursor,
          started,
          resolved: performance.now(),
          rows: bodies.length,
          decodedJSONBytes: new TextEncoder().encode(JSON.stringify(bodies))
            .length,
          transportedTotalCount: result.sourcePage.count,
          nextCursor: result.sourcePage.nextCursor ?? "",
        });
        all.push(...bodies);
        cursor = result.sourcePage.nextCursor ?? "";
      } while (cursor);
      if (copies && !all.length) throw new Error("Cannot repeat an empty source acquisition");
      return copies ? Array.from({ length: copies }, (_, index) => all[index % all.length]) : all;
    },
  });
  useLayoutEffect(() => {
    if (!query.data) return;
    let cancelled = false;
    void frames().then(() => {
      if (!cancelled)
        samples.current.push({
          phase: "finite-table-two-frames",
          profile,
          copies,
          at: performance.now(),
          rows: query.data.length,
        });
    });
    return () => {
      cancelled = true;
    };
  }, [query.data, profile, copies, samples]);
  if (query.error) return <pre role="alert">{String(query.error)}</pre>;
  return <TransportTable bodies={query.data ?? empty} />;
}
function EventsTable({ samples }: { samples: React.RefObject<Sample[]> }) {
  const resolved = targets.get("container-bundled-events");
  const { resources, watchState, isSynced } = useResources({
    pluginID,
    request: resolved ? request(resolved) : undefined,
  });
  const bodies = useMemo(() => resources.data ? bodiesOf(resources.data) : empty, [resources.data]);
  useLayoutEffect(() => {
    let cancelled = false;
    if (bodies.length)
      void frames().then(() => {
        if (!cancelled)
          samples.current.push({
            phase: "event-table-two-frames",
            at: performance.now(),
            states: bodies.map((body) => body.state),
            watchState,
          });
      });
    return () => {
      cancelled = true;
    };
  }, [bodies, watchState, samples]);
  return (
    <div
      data-p02-event-state={String(bodies[0]?.state ?? "")}
      data-p02-source-synced={String(isSynced)}
    >
      <TransportTable bodies={bodies} />
    </div>
  );
}

export function ResourceBenchmark() {
  const client = useQueryClient();
  const [selection, setSelection] = useState<{
    profile: Profile;
    copies: number;
    generation: number;
  } | null>(null);
  const [events, setEvents] = useState(false);
  const current = useRef<Profile>("cloud-bundled-pages");
  const generation = useRef(0);
  const samples = useRef<Sample[]>([]);
  const controlRef = useRef<BenchmarkControl | null>(null);
  useEffect(() => {
    // Each effect owns its sources, including starts still awaiting the bridge.
    // Root teardown drains those operations without consulting window.__p02.
    const started = new Set<Profile>();
    let disposed = false;
    let pending: Promise<unknown> = previousRootCleanup;
    function enqueue<T>(operation: () => Promise<T>): Promise<T> {
      const result = pending.then(operation);
      pending = result.catch(() => undefined);
      return result;
    }
    async function select(profile: Profile, copies: number) {
      if (disposed) throw new Error("P02 diagnostic is unmounted");
      if (
        !(profile in profiles) ||
        !Number.isInteger(copies) ||
        copies < 0 ||
        copies > 10000
      )
        throw new Error("Invalid diagnostic selection");
      if (!started.has(profile)) {
        await ResourceClient.LoadConnections(pluginID);
        if (disposed) return;
        await ResourceClient.StartConnection(pluginID, profile);
        started.add(profile);
        await resolveTarget(profile);
      }
      if (disposed) return;
      current.current = profile;
      setEvents(false);
      samples.current.push({
        phase: "select",
        profile,
        copies,
        at: performance.now(),
      });
      setSelection({ profile, copies, generation: ++generation.current });
      await frames();
    }
    async function stopSources() {
      if (!disposed) await control.unmount();
      const closed: unknown[] = [];
      const failures: unknown[] = [];
      for (const profile of started) {
        if (profile === "container-bundled-events") {
          try {
            await ResourceClient.StopResourceWatch(
              pluginID,
              { connection: profile },
              "container",
            );
            const deadline = performance.now() + 5000;
            let sourceWatches: unknown;
            do {
              const diagnostic = bodiesOf(await list(profile, "p02:metrics"))[0] as
                { activeSourceWatches?: number } | undefined;
              sourceWatches = diagnostic?.activeSourceWatches;
              if (sourceWatches === 0) break;
              if (typeof sourceWatches !== "number")
                throw new Error(
                  "Provider source-watch gauge unavailable during cleanup",
                );
              const { promise, resolve } = Promise.withResolvers<void>();
              setTimeout(resolve, 10);
              await promise;
            } while (performance.now() < deadline);
            if (sourceWatches !== 0)
              throw new Error(
                "Actual provider source watch survived explicit stop",
              );
          } catch (error) {
            failures.push(error);
          }
        }
        try {
          await ResourceClient.StopConnection(pluginID, profile);
          started.delete(profile);
          targets.delete(profile);
          closed.push({
            profile,
            stopped: true,
            ...(profile === "container-bundled-events"
              ? {
                  activeSourceWatches: 0,
                  observation: "Actual provider diagnostic after supported StopResourceWatch",
                }
              : {}),
          });
        } catch (error) {
          failures.push(error);
        }
      }
      try {
        await control.clearOwnedCache();
      } catch (error) {
        failures.push(error);
      }
      if (failures.length)
        throw new AggregateError(failures, "P02 source cleanup failed");
      return { closed, after: control.snapshot() };
    }
    const control: BenchmarkControl = {
      select: (profile, copies) => enqueue(() => select(profile, copies)),
      mountEvents: () =>
        enqueue(async () => {
          await select("container-bundled-events", 0);
          if (disposed) return;
          setSelection(null);
          setEvents(true);
          await frames();
          if (!disposed)
            await ResourceClient.EnsureResourceWatch(
              pluginID,
              (await resolveTarget("container-bundled-events")).target,
            );
        }),
      async unmount() {
        if (disposed) return;
        setSelection(null);
        setEvents(false);
        await frames();
      },
      async metrics() {
        return bodiesOf(await list(current.current, "p02:metrics:gc"))[0];
      },
      async release() {
        const at = performance.now();
        await list("container-bundled-events", "p02:release");
        samples.current.push({
          phase: "source-release-roundtrip",
          at,
          resolved: performance.now(),
        });
      },
      snapshot() {
        const owned = client
          .getQueryCache()
          .getAll()
          .filter(
            (query) =>
              query.queryKey[0] === pluginID ||
              query.queryKey[0] === "p02-finite",
          );
        return {
          samples: samples.current.slice(),
          cacheEntries: owned.length,
          cacheObservers: owned.map((query) => ({
            key: query.queryKey,
            observers: query.getObserversCount(),
            status: query.state.status,
          })),
          domRows: document.querySelectorAll("[data-p02-table] tbody tr")
            .length,
        };
      },
      async clearOwnedCache() {
        await client.cancelQueries({
          predicate: (query) =>
            query.queryKey[0] === pluginID ||
            query.queryKey[0] === "p02-finite",
        });
        client.removeQueries({
          predicate: (query) =>
            query.queryKey[0] === pluginID ||
            query.queryKey[0] === "p02-finite",
        });
        samples.current = [];
      },
      stop: () => enqueue(stopSources),
    };
    window.__p02 = control;
    controlRef.current = control;
    return () => {
      disposed = true;
      if (window.__p02 === control) delete window.__p02;
      if (controlRef.current === control) controlRef.current = null;
      previousRootCleanup = enqueue(stopSources).catch((error) =>
        console.error("P02 root teardown failed", error),
      );
    };
  }, [client]);
  return (
    <section data-p02-ready>
      <h2>P02 verification-only real provider boundary</h2>
      <p>
        V2 tagged bodies retain exact integers; diagnostic JSON displays wide integers
        as decimal strings. Stress copies repeat decoded bodies only after canonical
        acquisition; they are not new resource identities or additional source rows.
        Local table models are not host query execution.
      </p>
      <button
        onClick={() =>
          void controlRef.current
            ?.mountEvents()
            .catch((error) => console.error("P02 event mount failed", error))
        }
      >
        Mount container event diagnostic
      </button>
      <button
        onClick={() =>
          void controlRef.current
            ?.stop()
            .catch((error) => console.error("P02 source cleanup failed", error))
        }
      >
        Stop P02 sources
      </button>
      {selection ? (
        <Finite key={selection.generation} {...selection} samples={samples} />
      ) : null}
      {events ? <EventsTable samples={samples} /> : null}
    </section>
  );
}
