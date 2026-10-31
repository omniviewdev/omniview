import { StrictMode } from "react";
import type * as BaseUI from "@omniviewdev/base-ui";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResourceBenchmark, profiles } from "../../e2e/fixtures/workspace-probe/ui/src/ResourceBenchmark";

// Lifecycle unit tests only: provider calls are the external boundary. These
// doubles do not establish transport, subscription, table or performance proof.
const api = vi.hoisted(() => ({
  LoadConnections: vi.fn(),
  StartConnection: vi.fn(),
  StopConnection: vi.fn(),
  EnsureResourceWatch: vi.fn(),
  StopResourceWatch: vi.fn(),
  Enumerate: vi.fn(),
  ResolveTarget: vi.fn(),
}));
vi.mock("@omniviewdev/runtime/api", () => ({ ResourceClient: api }));
vi.mock("@omniviewdev/runtime", () => ({
  useResources: () => ({
    resources: { data: { records: [], sourcePage: { count: { kind: "unknown" }, coverage: { kind: "complete", paths: [] }, consistency: "bestEffort" } } },
    watchState: "",
    isSynced: false,
  }),
}));
vi.mock("@omniviewdev/base-ui", async (importOriginal) => ({
  ...(await importOriginal<typeof BaseUI>()),
  DataTable: Object.assign(() => null, {
    Container: () => null,
    Header: () => null,
    VirtualBody: () => null,
  }),
}));

let client: QueryClient;
let connections: Set<string>;
let watches: Set<string>;
function mount(strict = false) {
  const component = (
    <QueryClientProvider client={client}>
      <ResourceBenchmark />
    </QueryClientProvider>
  );
  return render(strict ? <StrictMode>{component}</StrictMode> : component);
}
async function select(
  profile: keyof typeof profiles,
) {
  await act(async () => {
    await window.__p02!.select(profile, 0);
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  connections = new Set();
  watches = new Set();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 0),
  );
  api.LoadConnections.mockResolvedValue([]);
  api.StartConnection.mockImplementation(async (_plugin, profile) => {
    connections.add(profile);
  });
  api.StopConnection.mockImplementation(async (_plugin, profile) => {
    connections.delete(profile);
  });
  api.ResolveTarget.mockImplementation(async (_plugin, request) => ({
    targetId: `target:${request.route.connection}`,
    target: { route: request.route, provider: "workspace-probe", authority: "test-host-authority", type: request.type, scope: [], representation: request.representation },
    authority: { continuity: "connectionLocal", limitations: [] },
    catalogRevision: "test-v2",
  }));
  api.EnsureResourceWatch.mockImplementation(async (_plugin, target) => {
    watches.add(target.route.connection);
  });
  api.StopResourceWatch.mockImplementation(async (_plugin, route) => {
    watches.delete(route.connection);
  });
  api.Enumerate.mockImplementation(async (_plugin, { targetId, request }) => ({
    records: request.cursor === "p02:metrics" ? [{
      key: "diagnostic", addressKey: "diagnostic-address", targetId, route: request.target.route,
      record: {
        reference: { address: { provider: request.target.provider, authority: request.target.authority, type: request.target.type, scope: [], id: "metrics" } },
        body: { kind: "map", value: { activeSourceWatches: { kind: "int64", value: watches.has(request.target.route.connection) ? "1" : "0" } } },
        representation: { id: "native", revision: "1", schema: { state: "absent", validation: "none", unvalidated: [] } },
        coverage: { kind: "complete", paths: [] },
      },
    }] : [],
    sourcePage: { count: { kind: "unknown" }, coverage: { kind: "complete", paths: [] }, consistency: "bestEffort" },
  }));
});
afterEach(async () => {
  cleanup();
  await waitFor(() => expect(connections.size).toBe(0));
  client.clear();
  vi.unstubAllGlobals();
});

describe("P02 root ownership versus table-only retention", () => {
  it("acquires every profile through its resolved V2 target", async () => {
    mount();
    for (const profile of Object.keys(profiles) as (keyof typeof profiles)[]) {
      const before = api.Enumerate.mock.calls.length;
      await select(profile);
      await waitFor(() => expect(api.Enumerate.mock.calls.length).toBeGreaterThan(before));
      expect(api.ResolveTarget).toHaveBeenCalledWith("workspace-probe", {
        route: { connection: profile }, type: profiles[profile], representation: "native",
      });
      expect(api.Enumerate).toHaveBeenCalledWith("workspace-probe", {
        targetId: `target:${profile}`,
        request: {
          target: { route: { connection: profile }, provider: "workspace-probe", authority: "test-host-authority", type: profiles[profile], scope: [], representation: "native" },
          pageSize: 200,
        },
      });
    }
  });

  it("repeats decoded stress bodies only after unique canonical acquisition", async () => {
    api.Enumerate.mockResolvedValueOnce({
      records: [{
        key: "host-record", addressKey: "host-address", targetId: "target:cloud-bundled-pages",
        route: { connection: "cloud-bundled-pages" },
        record: {
          reference: { address: { provider: "workspace-probe", authority: "test-host-authority", type: "compute/instance", scope: [], id: "native-id" } },
          body: { kind: "map", value: { name: { kind: "string", value: "native fixture" }, sizeBytes: { kind: "int64", value: "9007199254740993" } } },
          representation: { id: "native", revision: "1", schema: { state: "absent", validation: "none", unvalidated: [] } },
          coverage: { kind: "complete", paths: [] },
        },
      }],
      sourcePage: { count: { kind: "exact", value: "1" }, coverage: { kind: "complete", paths: [] }, consistency: "bestEffort" },
    });
    mount();
    await act(async () => { await window.__p02!.select("cloud-bundled-pages", 501); });
    await waitFor(() => expect(client.getQueryData<unknown[]>(["p02-finite", "cloud-bundled-pages", 501])).toHaveLength(501));
    const bodies = client.getQueryData<unknown[]>(["p02-finite", "cloud-bundled-pages", 501])!;
    expect(bodies[0]).toEqual({ name: "native fixture", sizeBytes: "9007199254740993" });
    expect(bodies.every((body) => body === bodies[0])).toBe(true);
    expect(api.Enumerate).toHaveBeenCalledTimes(1);
    expect(api.Enumerate.mock.calls[0][1].request).not.toHaveProperty("cursor");
  });

  it("closes source watches/connections and only owned caches after root unmount", async () => {
    const view = mount();
    fireEvent.click(view.getByText("Mount container event diagnostic"));
    await waitFor(() => expect(watches.size).toBe(1));
    client.setQueryData(["p02-finite", "container-bundled-events", 0], []);
    client.setQueryData(
      ["workspace-probe", "resource-v2", "enumerate", {
        targetId: "target:container-bundled-events",
        request: { target: { route: { connection: "container-bundled-events" }, provider: "workspace-probe", authority: "test-host-authority", type: "container", scope: [], representation: "native" }, pageSize: 200 },
      }],
      { records: [], sourcePage: { count: { kind: "unknown" }, coverage: { kind: "complete", paths: [] }, consistency: "bestEffort" } },
    );
    client.setQueryData(["unrelated-plugin", "keep"], 42);
    view.unmount();
    expect(window.__p02).toBeUndefined();
    await waitFor(() => {
      expect(watches.size).toBe(0);
      expect(connections.size).toBe(0);
      expect(
        client
          .getQueryCache()
          .getAll()
          .map((query) => query.queryKey),
      ).toEqual([["unrelated-plugin", "keep"]]);
    });
  });

  it("retains source and inactive cache for the deliberate table-only unmount", async () => {
    mount();
    await select("cloud-bundled-pages");
    await act(async () => {
      await window.__p02!.unmount();
    });
    expect(connections.has("cloud-bundled-pages")).toBe(true);
    expect(
      client.getQueryData(["p02-finite", "cloud-bundled-pages", 0]),
    ).toEqual([]);
    await act(async () => {
      await window.__p02!.stop();
    });
    expect(connections.size).toBe(0);
    expect(client.getQueryCache().getAll()).toEqual([]);
  });

  it("collects a connection whose startup resolves after root unmount", async () => {
    const start = Promise.withResolvers<void>();
    api.StartConnection.mockImplementation(async (_plugin, profile) => {
      await start.promise;
      connections.add(profile);
    });
    const view = mount();
    const pending = window.__p02!.select("cloud-bundled-pages", 0);
    await waitFor(() => expect(api.StartConnection).toHaveBeenCalled());
    view.unmount();
    start.resolve();
    await pending;
    await waitFor(() =>
      expect(api.StopConnection).toHaveBeenCalledWith(
        "workspace-probe",
        "cloud-bundled-pages",
      ),
    );
    expect(connections.size).toBe(0);
  });

  it("waits for an in-flight watch start before stopping the source", async () => {
    const ensure = Promise.withResolvers<void>();
    api.EnsureResourceWatch.mockImplementation(async (_plugin, target) => {
      await ensure.promise;
      watches.add(target.route.connection);
    });
    const view = mount();
    fireEvent.click(view.getByText("Mount container event diagnostic"));
    await waitFor(() => expect(api.EnsureResourceWatch).toHaveBeenCalled());
    view.unmount();
    ensure.resolve();
    await waitFor(() =>
      expect(api.StopResourceWatch).toHaveBeenCalledWith(
        "workspace-probe",
        { connection: "container-bundled-events" },
        "container",
      ),
    );
    expect(watches.size).toBe(0);
    await waitFor(() => expect(connections.size).toBe(0));
  });

  it("cleans other sources and cache even when one watch stop fails", async () => {
    mount();
    await select("container-bundled-events");
    await select("cloud-bundled-pages");
    api.StopResourceWatch.mockRejectedValueOnce(
      new Error("watch stop unavailable"),
    );
    let failure: unknown;
    await act(async () => {
      try {
        await window.__p02!.stop();
      } catch (error) {
        failure = error;
      }
    });
    expect(failure).toBeInstanceOf(AggregateError);
    expect(connections.size).toBe(0);
    expect(client.getQueryCache().getAll()).toEqual([]);
  });

  it("finishes old root cleanup before a remount reuses its connection IDs and cache", async () => {
    const oldStop = Promise.withResolvers<void>();
    api.StopConnection.mockImplementationOnce(async (_plugin, profile) => {
      await oldStop.promise;
      connections.delete(profile);
    });
    const oldRoot = mount();
    await select("cloud-bundled-pages");
    oldRoot.unmount();
    await waitFor(() => expect(api.StopConnection).toHaveBeenCalled());
    mount();
    const selection = window.__p02!.select("cloud-bundled-pages", 0);
    let startsBeforeRelease = 0;
    await act(async () => {
      await Promise.resolve();
      startsBeforeRelease = api.StartConnection.mock.calls.length;
      oldStop.resolve();
      await selection;
    });
    expect(startsBeforeRelease).toBe(1);
    expect(connections.has("cloud-bundled-pages")).toBe(true);
    expect(
      client.getQueryData(["p02-finite", "cloud-bundled-pages", 0]),
    ).toEqual([]);
  });

  it("keeps the current control usable after StrictMode effect replay", async () => {
    mount(true);
    await select("cloud-bundled-pages");
    expect(window.__p02).toBeDefined();
    expect(connections.has("cloud-bundled-pages")).toBe(true);
    await act(async () => {
      await window.__p02!.stop();
    });
    expect(connections.size).toBe(0);
  });
});
