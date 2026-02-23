# SurrealDB 3.0 -- Core Features and What's New

> **Released:** February 17, 2026
> **Funding:** $23M Series A extension (total $38M), with Chalfen Ventures and Begin Capital joining FirstMark and Georgian
> **Enterprise users:** Tencent, NVIDIA, Later.com
> **Written in:** Rust
> **License:** Business Source License (BSL)

---

## What Is SurrealDB?

SurrealDB is a multi-model database built in Rust that unifies **relational, document, graph, time-series, vector, full-text search, geospatial, and key-value** data models into a single engine. It exposes everything through its own query language, **SurrealQL**, which is close to standard SQL but with graph traversal, record links, and real-time capabilities baked in.

The value proposition: instead of running Postgres + Neo4j + Redis + Pinecone + Elasticsearch, you run one database. SurrealDB can be embedded (in-process), run as a single server, or scale horizontally via TiKV.

With 3.0, SurrealDB positions itself as a **persistent memory engine for AI agents** -- combining vector search, graph context, real-time queries, and MCP-based agent memory in one layer.

---

## Version 3.0 Release Highlights

SurrealDB 3.0 is the largest architectural overhaul since the 2.0 release. The focus areas are:

1. **Stability and performance** -- rearchitected execution engine, new streaming pipeline
2. **Developer experience** -- computed fields, custom API endpoints, client-side transactions, record references
3. **AI agent capabilities** -- file storage, improved vector indexing, Surrealism WASM extensions, SurrealMCP
4. **Breaking changes** -- futures removed, function renames, stricter schema enforcement

---

## Architecture and Execution Engine

### New Query Execution Pipeline

The single biggest change in 3.0 is the **rearchitected query execution engine**, inspired by the broader database community. SurrealQL now follows a standard pipeline:

```
AST --> LogicalPlan --> ExecutionPlan
```

with optimisations applied at each stage. The engine is **fully streaming internally** (end-to-end client streaming is coming in a future minor release).

This pipeline replaces the previous ad-hoc evaluation model that made it hard to optimise queries systematically.

### Splitting Values from Expressions

In 2.x, stored values and executable expressions (like `<future>` blocks) were interleaved in the same internal representation. This meant every read had to check whether data needed evaluation, adding overhead and unpredictability.

In 3.0, **values and expressions are cleanly separated**. What your data *is* (values) and how it's *derived* (expressions, now computed fields) are stored and evaluated differently. This removes unnecessary work from the read path.

### ID-Based Metadata Storage

Core metadata (table definitions, indexes, access rules) has moved to **ID-based storage**. Previously, metadata was keyed by name strings, which made renames expensive and lookups less efficient. The new model uses stable internal IDs, improving both correctness and performance.

### Synced Writes by Default

SurrealDB 3.0 **enables synchronised writes by default**. In 2.x, asynchronous writes were the default, which was faster but could lead to data loss on crashes. The new default prioritises durability. You can still tune this for throughput-critical workloads.

### Document Representation Redesign

How documents are represented on disk has been **completely redesigned**. A proper document wrapper type replaces the previous representation. This change improves serialisation efficiency, reduces storage overhead, and provides a cleaner foundation for future optimisation.

---

## Performance Improvements

The new execution engine delivers dramatic improvements. All benchmarks compare SurrealDB 3.0 vs 2.0 across all storage engines:

| Workload | Improvement |
|---|---|
| Graph queries (all traversal depths) | **4-24x faster** |
| `WHERE id = record:42` queries | **4,600x+ faster** (O(n) to O(1), now sub-millisecond) |
| Table scans with `LIMIT`, `START` | **3-7x faster** |
| `ORDER BY` queries | **~3x faster** |
| HNSW vector search | **~8x faster** (~36s to ~4.5s) |
| `GROUP BY` (multi-aggregation) | **~36% faster** |
| `CREATE` latency | **+62.9%** improvement (1.94ms to 0.72ms) |
| `UPDATE` latency | **+71.7%** improvement (2.58ms to 0.73ms) |

### Key Technical Details

- The new executor currently covers **read-only statements**. Write support expansion is on the near-term roadmap.
- The `WHERE id = record:42` improvement is especially significant -- this is one of the most common SQL patterns, and it previously triggered full table scans.
- Benchmarks used the open-source tool [crud-bench](https://github.com/surrealdb/crud-bench).

### Known Regressions

Some users have reported regressions in specific patterns (see [GitHub issue #6800](https://github.com/surrealdb/surrealdb/issues/6800)):
- Nested JSON `ORDER BY` (3+ levels deep) is still slow relative to top-level fields
- Some complex `WHERE + ORDER BY` combinations showed regressions in the beta

These are being tracked for the 3.x minor releases.

---

## Storage Engine Changes

### SurrealKV as In-Memory Engine

SurrealDB 3.0 now uses **SurrealKV for the in-memory storage engine**. The new design is:
- **Lock-free, MVCC-based** for massive concurrency
- Full **ACID transactions** even in-memory
- **Optional background persistence** (write-ahead)
- Ultra-low latency with predictable performance

### Supported Storage Backends

| Backend | Use Case |
|---|---|
| **Memory (SurrealKV)** | Ultra-low latency, development, edge |
| **RocksDB** | Balanced performance and persistence |
| **SurrealKV (on-disk)** | Optimised for SurrealDB workloads, versioned storage |
| **TiKV** | Horizontal scalability, distributed clusters |
| **IndxDB** | Browser/WASM environments |

### RocksDB Improvements

- BlobDB options now **configurable via environment variables**
- **Disk space limits** with read-only/deletion-only modes
- Blob compression made optional
- Aligned blob defaults with upstream RocksDB

### SurrealKV Enhancements

- **Versioning enabled on edges and relations**
- Configurable `sync_mode` for disk synchronisation tuning
- Configurable `retention_ns` for version retention

### FoundationDB Removed

The FoundationDB storage engine has been **removed** in 3.0.

---

## New Features and Capabilities

### Computed Fields

**Futures are gone.** In their place, `COMPUTED` fields are evaluated consistently whenever you query a record.

```sql
-- 2.x (removed)
DEFINE FIELD age ON person VALUE <future> { time::year(time::now()) - time::year(born) };

-- 3.0
DEFINE FIELD age ON person COMPUTED time::year(time::now()) - time::year(born);
```

Restrictions:
- Only in `DEFINE FIELD` statements
- No nested fields allowed inside or under computed fields
- Cannot be used on ID fields
- Cannot combine with `VALUE`, `DEFAULT`, `READONLY`, `ASSERT`, `REFERENCE`, `FLEXIBLE`

### Custom API Endpoints (`DEFINE API`)

Define HTTP routes and middleware **directly in the database** using SurrealQL. This eliminates the need for external middleware.

```sql
DEFINE API /comments FOR get
  AS {
    -- Rate limiting, auth, and query logic all in SurrealQL
    RETURN {
      status: 200,
      body: (SELECT * FROM comment ORDER BY created_at DESC LIMIT 50)
    };
  };
```

The endpoint is exposed at `/api/:namespace/:database/:endpoint_name`.

### Client-Side Transactions

Manage transaction flow directly in application code. Group operations across multiple requests and commit when ready, with full ACID guarantees.

### Record References

Record links can now be **bidirectional at the schema level**. A field defined with the `REFERENCE` clause lets referenced records track incoming links automatically.

```sql
DEFINE FIELD author ON article TYPE record<user> REFERENCE
  ON DELETE CASCADE;

-- The user table can now define a field of type `references`
-- that automatically tracks all articles pointing to it
```

This simplifies graph-like queries without explicit `RELATE` statements for every direction.

### File Storage

SurrealDB 3.0 brings native file support:
- **Buckets** for organising files
- **File pointers** stored as records
- Store, access, and transform images, audio, and documents directly in SurrealQL
- Files are queryable alongside structured data

### Surrealism (WASM Extension Framework)

Surrealism is a new **open-source extension framework** that turns SurrealDB into a programmable data and logic layer.

- Write functions in **Rust**, compile to **WebAssembly**
- Execute WASM plugins directly within SurrealQL
- Plugins participate in the **same ACID transaction** as the query
- **Sandboxed, deterministic** execution
- Hot-load and upgrade without downtime
- Fine-grained governance and multi-tenant control
- Support for other languages (JavaScript, Python) planned

Use cases:
- Calling LLMs/embedding models next to data
- Custom business logic and access control
- Transcribing audio, extracting entities, enriching data -- all in one transactional flow

See also: [[Surrealism Extensions]]

### SurrealMCP (Model Context Protocol Server)

The official MCP server for SurrealDB, enabling AI agents and tools to use SurrealDB as persistent, permission-aware memory.

- Runs via stdio (local IDE) or HTTP server
- Supports all SurrealDB data models through a unified interface
- Permission-aware: respects SurrealDB access rules
- Available as a Docker image: `surrealdb/surrealmcp:latest`

See also: [[SurrealDB MCP Server]]

### Indexing Improvements

| Feature | Details |
|---|---|
| **Compound indexes** | Prefix + range scans, descending order, LIMIT-aware iterators |
| **Full-text indexing** | Concurrent writers, log-based with background compaction |
| **Concurrent index builds** | Batch-based instead of single large transaction |
| **HNSW vectors** | Memory-bounded LRU cache, 32-bit floats by default |
| **`ALTER INDEX`** | New statement with `PREPARE REMOVE` for safe decommissioning |
| **`DEFER` keyword** | Background index building for large datasets |
| **OR boolean operations** | Full-text search now supports OR queries |
| **COUNT index** | With compaction system |

The MTREE vector index type has been **removed** -- use HNSW instead.

### GraphQL Support Stabilised

GraphQL support is now **stable** (was experimental in 2.x). Includes record references and functions in GraphQL.

### Surreal Sync (Data Migration Tool)

A new tool for moving data from other databases into SurrealDB. Currently in active development.

### Surqlize TypeScript ORM (Experimental)

A new TypeScript ORM for SurrealDB, providing type-safe query building.

### Additional SurrealQL Changes

- `set` literal syntax (`{1, 2, 3}` instead of `[1, 2, 3]`)
- `array::fold()` and `array::reduce()` methods
- New `string::distance` and `string::similarity` functions
- `DEFINE DATABASE ... STRICT` replaces the `--strict` CLI flag
- `$input` parameter accessible in EVENTS
- Variables in closures and live queries
- Multi-session support in RPC protocol
- Refresh token support in RPC and SDK
- Configurable WebSocket limits
- Configurable slow-query logging

---

## Breaking Changes from 2.x

SurrealDB provides an official [migration guide](https://surrealdb.com/docs/surrealdb/installation/upgrading/migrating-data-to-3x) and **Surrealist 3.7+** includes built-in migration diagnostics.

### Critical ("Will Break")

| # | Change | Action |
|---|---|---|
| 1 | `<future>` type removed | Replace with `COMPUTED` fields |
| 2 | Function renames | `duration::from::days` becomes `duration::from_days`, `type::thing` becomes `type::record`, `rand::guid()` becomes `rand::id()`, etc. |
| 3 | `array::range` args changed | Arguments are now `(start, end)` instead of `(offset, count)` |
| 4 | `LET` required for parameters | `$val = 10` must become `LET $val = 10` |
| 5 | `GROUP` + `SPLIT` cannot be combined | Use subqueries to achieve the same result |
| 6 | Like operators removed | `~`, `!~`, `?~`, `*~` gone; use `string::similarity::jaro()` |
| 7 | `SEARCH ANALYZER` renamed | Now `FULLTEXT ANALYZER` |
| 8 | `--strict` flag removed | Use `DEFINE DATABASE mydb STRICT` |
| 9 | MTREE index removed | Use `HNSW` instead |
| 10 | Stored closures removed | Closures can no longer be stored in records |
| 11 | Record references syntax changed | Experimental 2.x syntax must be manually updated |
| 12 | `ANALYZE` statement removed | Remove all uses |

### Likely to Break ("Can Break")

| # | Change | Notes |
|---|---|---|
| 13 | `.*` idiom behaviour changed | On arrays: dereferences records directly. On objects: returns object, not values array |
| 14 | Field idiom on arrays | Now works on individual elements, not whole array |
| 15 | Idiom fetching changes | Various changes to how nested fetches resolve |
| 16 | Optional parts syntax | `$val?.len()` becomes `$val.?.len()` |
| 17 | Parsing changes | Record ID escaping, Unicode escaping changes |
| 18 | Set type deduplicates AND orders | Displays with `{}` instead of `[]` |
| 19 | Schema strictness stricter | Non-existing tables error, SCHEMAFULL tables reject undefined fields |
| 20 | Numeric record ID ordering | `t:[1]` and `t:[1f]` are now the same key |

### Edge Cases ("Unlikely Break")

- `math::sqrt(-1)` returns `NaN` instead of `NONE`
- `math::min([])` returns `Infinity` instead of `NONE`
- `math::max([])` returns `-Infinity` instead of `NONE`
- `array::logical_and` / `array::logical_or` behaviour changes
- Mock ranges require `..=` for inclusive
- `.id` field special behaviour changed (use `.id()` function)
- Keywords as identifiers require backtick escaping

---

## Migration Guide Notes

### Automated Tools

1. **Surrealist Migration Diagnostics** (v3.6.17+) -- connects to your 2.x database and shows exactly what needs to change
2. **V3 Compatible Export** (SurrealDB 2.6.0+) -- `surreal export` produces 3.x-compatible output, auto-transforming function names, `SEARCH ANALYZER`, parameters, and MTREE indexes
3. **Surreal Sync** -- new data migration tool (in development)

### Manual Steps Required

- Futures to computed fields
- Record reference syntax changes
- Stored closures removal
- `ANALYZE` statement removal
- Schema strictness adjustments

### Recommended Migration Path

1. Update Surrealist to 3.7+ and run the **migration diagnostics view**
2. Update SurrealDB to **2.6.1+** and export with `surreal export --v3-compatible`
3. Review the export for any items that could not be auto-migrated
4. Start a fresh SurrealDB 3.0 instance and import the export
5. Test thoroughly, particularly around computed fields, index behaviour, and schema strictness

---

## What's Next (Roadmap)

From the SurrealDB team's published roadmap:

- **Write support in new executor** -- expanding the streaming execution engine to cover all statement types
- **End-to-end streaming** -- from internal execution all the way to the client
- **Indexing improvements** -- better planning, reduced scan overhead, new index types, composite strategies
- **Pipeline optimisation** -- continued tuning of the planning and execution pipeline
- **Surreal Cloud** -- managed SurrealDB offering scaling up
- **Surrealism language expansion** -- JavaScript and Python plugin support
- **Agent memory features** -- durable, scalable context for long-running AI agents

---

## Sources

- [Introducing SurrealDB 3.0 -- the future of AI agent memory](https://surrealdb.com/blog/introducing-surrealdb-3-0--the-future-of-ai-agent-memory) (official blog, Feb 17 2026)
- [SurrealDB 3.0 benchmarks: a new foundation for performance](https://surrealdb.com/blog/surrealdb-3-0-benchmarks-a-new-foundation-for-performance) (official blog, Feb 17 2026)
- [SurrealDB 3.0 landing page](https://surrealdb.com/3.0)
- [SurrealDB 3.0 benchmarks page](https://surrealdb.com/benchmarks)
- [Upgrading from 2.x to 3.x](https://surrealdb.com/docs/surrealdb/installation/upgrading/migrating-data-to-3x) (official docs)
- [Release Notes & Changelog](https://surrealdb.com/releases)
- [Introducing Surrealism](https://surrealdb.com/blog/introducing-surrealism) (official blog, Feb 17 2026)
- [Introducing SurrealMCP](https://surrealdb.com/blog/introducing-surrealmcp) (official blog, Aug 23 2025)
- [SurrealDB Secures $23M Series A, Launches 3.0](https://www.hpcwire.com/bigdatawire/this-just-in/surrealdb-secures-23m-series-a-boost-launches-surrealdb-3-0/) (HPCwire)
- [SurrealDB raises $23M, launches update to fuel agentic AI](https://www.techtarget.com/searchdatamanagement/news/366639042/SurrealDB-raises-23M-launches-update-to-fuel-agentic-AI) (TechTarget)
- [SurrealDB 3.0 wants to replace your five-database RAG stack](https://venturebeat.com/data/surrealdb-3-0-wants-to-replace-your-five-database-rag-stack-with-one) (VentureBeat)
- [Reddit announcement thread](https://www.reddit.com/r/surrealdb/comments/1r78b1j/introducing_surrealdb_30/)
- [GitHub issue #6800 -- Performance regressions](https://github.com/surrealdb/surrealdb/issues/6800)
- [surrealdb/surrealdb on GitHub](https://github.com/surrealdb/surrealdb)

---

## Related Research

- [[SurrealDB MCP Server]]
- [[SurrealQL Deep Dive]]
- [[Data Model -- Documents Graphs and Relations]]
- [[Real-time Live Queries and Changefeeds]]
- [[Auth Permissions and Security]]
- [[SDKs and Deployment]]
- [[Advanced Features -- Functions Analyzers and Indexes]]
- [[SurrealML and AI Vector Capabilities]]
