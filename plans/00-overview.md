# Plugin SDK Simplification Plans

This directory contains detailed analysis and options for simplifying the Omniview plugin SDK.
Each document targets a specific pain point, provides concrete code examples showing the
current state, and presents options ranked by impact and feasibility.

## Documents

| # | Document | Pain Point | Impact |
|---|----------|------------|--------|
| 1 | [01-generic-type-params.md](01-generic-type-params.md) | 3 cascading generic type parameters (`ClientT`, `DiscoveryT`, `InformerT`) propagate through every layer | High |
| 2 | [02-controller-crud-duplication.md](02-controller-crud-duplication.md) | All 6 CRUD methods in `ResourceController` repeat identical static-to-dynamic fallback logic | Medium |
| 3 | [03-unified-resourcer-interface.md](03-unified-resourcer-interface.md) | `Resourcer[T]` and `DynamicResourcer[T]` are near-identical interfaces maintained in parallel | Medium |
| 4 | [04-factory-pattern-overuse.md](04-factory-pattern-overuse.md) | Generic factory interfaces add indirection with minimal value over simple function types | Medium |
| 5 | [05-plugin-opts-interface.md](05-plugin-opts-interface.md) | `IResourcePluginOpts` is a 17-method interface with 3 type params used as a glorified config bag | Medium |
| 6 | [06-resource-provider-interface.md](06-resource-provider-interface.md) | `ResourceProvider` composes 5 sub-interfaces into 20+ methods; callers rarely need all of them | Low-Med |
| 7 | [07-plugin-context-grpc.md](07-plugin-context-grpc.md) | `PluginContext` is serialized to JSON and passed via gRPC metadata with magic strings | Low-Med |

## Guiding Principles

These proposals aim to:

1. **Remove abstraction without losing functionality** - Every layer must earn its keep.
2. **Reduce cognitive load** - A new plugin author should be able to understand the SDK quickly.
3. **Keep generics where they pay for themselves** - `ClientT` on `Resourcer` is valuable; `DiscoveryT` on every opts accessor is not.
4. **Prefer concrete types over interfaces** - Use interfaces at boundaries (gRPC, plugin registration), structs internally.
5. **Maintain backward compatibility where cheap** - But don't contort the new design to preserve the old API.

## Suggested Order of Implementation

1. **[03] Unify Resourcer interfaces** - prerequisite for [02]
2. **[02] Deduplicate controller CRUD** - directly benefits from [03]
3. **[01] Reduce generic params** - biggest architectural win, but touches everything
4. **[04] Replace factories with funcs** - quick, isolated change
5. **[05] Replace opts interface with struct** - quick once [01] is done
6. **[06] Split ResourceProvider** - optional, improves granularity
7. **[07] Improve context propagation** - optional, improves safety
