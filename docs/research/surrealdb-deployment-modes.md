# SurrealDB Deployment Modes for Plugin

> Research for the [[SurrealDB Memory Plugin]] architecture. Covers every deployment
> mode relevant to a Claude Code memory plugin, with detailed evaluation of persistence,
> latency, resource footprint, and suitability for different user personas.

---

## Overview: Storage / Compute Separation

SurrealDB separates its **compute layer** (query engine, permissions, API) from its **storage layer** (key-value backends). This architectural choice is what makes the wide range of deployment modes possible -- the same query engine runs identically regardless of whether data lives in RAM, on disk via RocksDB/SurrealKV, in a browser via IndexedDB, or across a distributed TiKV cluster.

For a Claude Code plugin, this means we can offer a **single codebase** that targets multiple backends, letting users choose their deployment without changing application logic.

### Storage Backends at a Glance

| Backend | Persistence | Distributed | Embedded | Server | Use Case |
|---------|------------|-------------|----------|--------|----------|
| `memory` | None (volatile) | No | Yes | Yes | Testing, ephemeral sessions |
| `surrealkv://` | Disk (file) | No | Yes | Yes | Local single-user (recommended) |
| `rocksdb://` | Disk (file) | No | Yes | Yes | Local single-user (mature/stable) |
| `tikv://` | Disk (distributed) | Yes | No | Yes | Multi-node clusters |
| `indxdb://` | IndexedDB (browser) | No | Yes | No | Browser WASM only |

---

## Mode 1: In-Memory (`surreal start memory`)

### How It Works

The in-memory backend stores all data in a BTreeMap in RAM. It is the **default** when no path argument is given to `surreal start`.

```bash
# Start in-memory (these are equivalent)
surreal start memory --user root --pass secret
surreal start --user root --pass secret
```

### Persistence Capabilities

**By default, in-memory mode has NO persistence** -- all data is lost when the process stops. However, the SurrealDB codebase reveals several persistence-adjacent features for the in-memory engine:

1. **Persistence Path**: The in-memory engine can be configured to persist data to a filesystem path using the `SURREAL_DATASTORE_PERSIST` environment variable or by providing a path in the URL (e.g., `mem:///path`).

2. **Snapshots**: Configurable via `SURREAL_DATASTORE_SNAPSHOT` environment variable or the `snapshot` query parameter. This allows periodic saving of in-memory state to disk.

3. **Append-Only Log (AOL)**: The in-memory engine supports AOL modes (`never`, `sync`, `async`) via `SURREAL_DATASTORE_AOL` environment variable. This provides write-ahead logging for crash recovery.

> **Important caveat**: These persistence features (persist path, snapshots, AOL) appear in the SurrealDB source code (`core/src/kvs/config.rs`) but are **not prominently documented** in the official user-facing docs as of v2.3.x. They may be internal/experimental. For production persistence, the official recommendation is to use a file-based backend.

### Export/Import as Persistence Strategy

The most **reliable** way to persist in-memory data is via the `surreal export` / `surreal import` commands (see [[#Export and Import Commands]] below). A plugin could:

1. Start SurrealDB in memory for speed
2. Periodically run `surreal export` to save state
3. On next startup, `surreal import` the saved file

This is a viable strategy for the plugin, though it adds complexity around lifecycle management.

### Evaluation for Plugin

| Criterion | Rating | Notes |
|-----------|--------|-------|
| Startup latency | Excellent | Near-instant, no disk I/O |
| Data persistence | None (without export strategy) | Data lost on process exit |
| Resource footprint | Low baseline, grows with data | All data in RAM |
| Ease of setup | Zero config | Just `surreal start memory` |
| Best for | Testing, CI/CD, throwaway sessions | Not for long-term memory storage |

---

## Mode 2: File-Based (RocksDB and SurrealKV)

### RocksDB (`rocksdb://`)

RocksDB is the **default and recommended** persistent storage engine, originally forked from Google's LevelDB and maintained by Meta. It is written in C++ and uses a Log-Structured Merge-tree (LSM) data structure.

```bash
surreal start --user root --pass secret rocksdb://path/to/mydb
surreal start -u root -p secret rocksdb:~/surrealdb-data
```

**Characteristics:**
- **Mature and battle-tested** -- the default production recommendation
- **Write-optimized** via LSM trees (efficient for write-heavy workloads)
- **External C/C++ dependencies** required for compilation (can be complex on Windows)
- **Higher memory usage** -- RocksDB uses significant memory for caching:

| Instance Memory | Estimated RocksDB Usage |
|----------------|------------------------|
| 512 MiB | ~80 MiB |
| 1 GiB | ~80 MiB |
| 2 GiB | ~640 MiB |
| 4 GiB | ~1.25 GiB |
| 8 GiB | ~3.25 GiB |

- **Startup time**: Fast (sub-second for typical databases). The KVS store initialization is nearly instant based on server logs:
  ```
  INFO surrealdb::kvs::ds: Starting kvs store in rocksdb:/path
  INFO surrealdb::kvs::ds: Started kvs store in rocksdb:/path
  ```

### SurrealKV (`surrealkv://`) -- Beta

SurrealKV is SurrealDB's **custom storage engine**, built entirely in Rust. It uses an Immutable Versioned Adaptive Radix Trie (VART) data structure.

```bash
surreal start --user root --pass secret surrealkv://path/to/mydb

# With versioning enabled (temporal queries)
surreal start --user root --pass secret "surrealkv://path/to/mydb?versioned=true"
```

**Characteristics:**
- **Written entirely in Rust** -- no external C/C++ dependencies, easier compilation
- **Low memory footprint** -- designed for resource-constrained devices
- **Built-in MVCC versioning** -- supports temporal/historical queries via `VERSION` clause:
  ```sql
  SELECT * FROM user VERSION d'2024-08-12T11:03:00Z'
  ```
- **Configurable disk sync modes**: `Never`, `Every`, `Interval`
- **Version retention**: Configurable retention period for old versions (zero = unlimited)
- **Still in beta** as of SurrealDB 2.x -- may have file format changes in future releases
- **Stores entire index in memory** -- fast reads but memory usage scales with data size
- **Compaction support** for efficient storage management

### RocksDB vs SurrealKV: Which for the Plugin?

| Feature | RocksDB | SurrealKV |
|---------|---------|-----------|
| Stability | Production-ready | Beta |
| Dependencies | C/C++ (complex on Windows) | Pure Rust (easy cross-platform) |
| Memory footprint | Higher (LSM caches) | Lower (but index in memory) |
| Write performance | Optimized (LSM) | Good |
| Versioning/temporal queries | No | Yes (built-in MVCC) |
| Compilation time | Long (C++ deps) | Faster (pure Rust) |
| Official recommendation | Default for production | Experiment, wait for 1.0 |

**Recommendation for the plugin**: Default to **RocksDB** for the stable path. Offer **SurrealKV** as an opt-in for users who want temporal queries (useful for memory versioning -- "what did I know about X last week?") or who are on platforms where RocksDB compilation is painful.

### Evaluation for Plugin

| Criterion | Rating | Notes |
|-----------|--------|-------|
| Startup latency | Very good | Sub-second for typical databases |
| Data persistence | Excellent | ACID-compliant, survives crashes |
| Resource footprint | Moderate | RocksDB: ~80 MiB minimum; SurrealKV: lower |
| Ease of setup | Good | Just specify a path |
| Best for | Primary local deployment | The recommended default for the plugin |

---

## Mode 3: Embedded Mode

SurrealDB can run **embedded** directly inside your application -- no separate server process needed. This is available for Rust, JavaScript/Node.js, Python, and .NET.

### Embedded in Node.js (`@surrealdb/node`)

The Node.js engine is a **native Rust binding** (not WASM) that runs SurrealDB embedded in the Node.js process. This is the most relevant option for a Claude Code plugin.

```bash
npm install surrealdb @surrealdb/node
```

```typescript
import { Surreal, createRemoteEngines } from "surrealdb";
import { createNodeEngines } from "@surrealdb/node";

const db = new Surreal({
  engines: {
    ...createRemoteEngines(),   // http, https, ws, wss
    ...createNodeEngines(),      // mem, surrealkv
  },
});

// In-memory embedded
await db.connect("mem://");

// Persistent embedded (SurrealKV)
await db.connect("surrealkv://./my-memory-db");
```

**Key facts:**
- Supports `memory` and `surrealkv` backends (not RocksDB in embedded JS)
- The `@surrealdb/node` package versions sync major/minor with SurrealDB (e.g., `2.3.5` uses SurrealDB >= `2.3.0`)
- Works in Node.js, Deno, and Bun
- **ES modules only** -- does not support CommonJS `require()`
- The WASM SDK (`@surrealdb/wasm`) now also supports running within a **Web Worker** for offloading database operations from the main thread

### Embedded in Browser (`@surrealdb/wasm`)

The WASM engine runs SurrealDB in the browser with IndexedDB persistence.

```bash
npm install surrealdb @surrealdb/wasm
```

```typescript
import { createWasmEngines } from "@surrealdb/wasm";
import { Surreal } from "surrealdb";

const db = new Surreal({
  engines: createWasmEngines(),
});

// In-memory in browser
await db.connect("mem://");

// Persistent via IndexedDB
await db.connect("indxdb://demo");
```

**Relevance to Claude Code plugin**: Limited. Claude Code runs in a terminal/CLI environment, not a browser. However, if we ever build a companion web UI for memory browsing, IndexedDB persistence would be useful.

### Embedded in Python (`surrealdb` PyPI package)

The Python SDK supports embedded mode with both in-memory and file-based backends. The embedded functionality is included in pre-built wheels on PyPI.

```python
from surrealdb import AsyncSurreal

# In-memory embedded
async with AsyncSurreal("mem://") as db:
    await db.use("test", "test")
    person = await db.create("person", {"name": "John Doe"})

# Persistent embedded (RocksDB)
async with AsyncSurreal("rocksdb://mydb") as db:
    await db.use("test", "test")
    company = await db.create("company", {"name": "TechStart"})

# Persistent embedded (SurrealKV)
async with AsyncSurreal("surrealkv://mydb") as db:
    await db.use("test", "test")
```

**Connection protocols available:**
- `ws://` / `wss://` -- WebSocket (full feature set including live queries)
- `http://` / `https://` -- HTTP (some features unavailable, no live queries)
- `mem://` or `memory` -- Embedded in-memory
- `rocksdb://` -- Embedded with RocksDB
- `surrealkv://` -- Embedded with SurrealKV
- `file://` -- Deprecated, maps to SurrealKV

**Relevance to Claude Code plugin**: High. If the plugin MCP server is written in Python (or has a Python component), embedded mode avoids needing a separate SurrealDB process entirely.

### Embedded in Rust

The Rust SDK provides the most complete embedded experience:

```rust
use surrealdb::engine::local::Mem;
use surrealdb::engine::local::RocksDb;
use surrealdb::engine::local::SurrealKv;
use surrealdb::Surreal;

// In-memory
let db = Surreal::new::<Mem>(()).await?;

// RocksDB persistent
let db = Surreal::new::<RocksDb>("./mydb").await?;

// SurrealKV persistent
let db = Surreal::new::<SurrealKv>("./mydb").await?;
```

### Embedded vs Server Mode Performance

- **Embedded eliminates network overhead** -- no HTTP/WebSocket round-trips
- **Startup is near-instant** for embedded -- no server boot, port binding, etc.
- **Single-process** -- simpler lifecycle management, no orphan server processes
- **Limitation**: Embedded databases cannot be accessed by external tools (Surrealist UI, CLI) simultaneously
- **Trade-off**: Couples the database lifecycle to the application process

### Evaluation for Plugin

| Criterion | Rating | Notes |
|-----------|--------|-------|
| Startup latency | Best | No server startup, instant |
| Data persistence | Depends on backend | mem:// = none, surrealkv:// = full |
| Resource footprint | Lowest | No separate process overhead |
| Ease of setup | Best (zero config) | Just `npm install` / `pip install` |
| Best for | Default plugin mode | Ideal for "just works" experience |

---

## Mode 4: Docker

### Minimal Docker Setup

```bash
# In-memory (ephemeral)
docker run --rm -p 8000:8000 surrealdb/surrealdb:latest \
  start --user root --pass secret memory

# Persistent with RocksDB and volume mount
mkdir -p mydata
docker run --rm -p 8000:8000 \
  --user $(id -u) \
  -v $(pwd)/mydata:/mydata \
  surrealdb/surrealdb:latest \
  start --user root --pass secret rocksdb:/mydata/mydatabase.db

# Persistent with SurrealKV
docker run --rm -p 8000:8000 \
  -v $(pwd)/mydata:/mydata \
  surrealdb/surrealdb:latest \
  start --user root --pass secret surrealkv:/mydata/mydatabase.db
```

### Docker Compose Template

```yaml
version: "3.8"
services:
  surrealdb:
    image: surrealdb/surrealdb:latest
    pull_policy: always
    container_name: engram
    ports:
      - "8000:8000"
    volumes:
      - surrealdb_data:/data
    command: >
      start
      --user root
      --pass secret
      --log info
      rocksdb:///data/memory-plugin.db
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "surreal", "is-ready", "--conn", "http://localhost:8000"]
      interval: 10s
      timeout: 5s
      retries: 3

volumes:
  surrealdb_data:
```

### Docker Resource Footprint

- **Image size**: The official `surrealdb/surrealdb:latest` image is relatively small (single Rust binary)
- **Memory**: Base memory usage depends on backend:
  - In-memory: Minimal baseline, grows with data
  - RocksDB: ~80 MiB minimum for small databases
  - SurrealKV: Lower than RocksDB
- **CPU**: Low idle usage; scales with query load
- **The `--user $(id -u)` flag** is recommended for correct file permissions on mounted volumes

### Evaluation for Plugin

| Criterion | Rating | Notes |
|-----------|--------|-------|
| Startup latency | Good | Container start + DB init (~1-3 seconds) |
| Data persistence | Excellent | Volumes survive container restarts |
| Resource footprint | Moderate | Container overhead + DB backend |
| Ease of setup | Good (if Docker installed) | One `docker run` command |
| Best for | Users who prefer containerized services | Isolation, reproducibility |

---

## Mode 5: Remote (SurrealDB Cloud / Self-Hosted Server)

### Connection String Format

```
# WebSocket (recommended for full features including live queries)
ws://hostname:port
wss://hostname:port          # TLS

# HTTP (no live queries, some features unavailable)
http://hostname:port
https://hostname:port        # TLS

# SurrealDB Cloud
wss://<instance-id>.cloud.surrealdb.com/rpc
```

### SDK Connection Examples

```typescript
// JavaScript
await db.connect('wss://cloud.surrealdb.com/rpc', {
  namespace: 'myns',
  database: 'mydb',
});
await db.signin({ username: 'root', password: 'secret' });
```

```python
# Python
async with AsyncSurreal("wss://cloud.surrealdb.com") as db:
    await db.use("myns", "mydb")
    await db.signin({"username": "root", "password": "secret"})
```

### Authentication Methods

1. **Root authentication**: Username/password for full database access
   ```sql
   -- Root level
   db.signin({ username: "root", password: "secret" })
   ```
2. **Namespace authentication**: Scoped to a namespace
3. **Database authentication**: Scoped to a specific database
4. **JWT token authentication**: For token-based auth flows
   ```bash
   surreal export --token <jwt-token> --ns test --db test backup.surql
   ```
5. **Record-level authentication**: Fine-grained user-level access (signup/signin)

### SurrealDB Cloud

**Free tier:**
- 1 GB storage
- 0.25 vCPU
- 1 GB memory
- Community support
- Social authentication
- Surreal Sidekick AI copilot included
- **Limitation**: Instances exceeding 1 GB free storage are limited to data retrieval only (no writes)

**Paid tiers:**
- **Start**: From $0.021/hour, single node, up to 512 GB storage / 16 vCPU / 64 GB memory, daily automated backups
- **Dedicated**: Contact sales, multi-node, up to 1 PB cluster storage, fault-tolerant, PrivateLink
- Currently runs on **AWS only** (GCP and Azure planned)

**Limitations:**
- CLI arguments and environment variables cannot be configured on Cloud instances
- GraphQL support not yet enabled on Cloud
- Backups can only be restored to the same region
- Cannot restore a backup into an existing instance

### Self-Hosted Remote

For self-hosted deployments, SurrealDB runs as a server accessible over the network:

```bash
surreal start --bind 0.0.0.0:8000 --user root --pass secret rocksdb://mydb
```

This can run on any server, VM, or Kubernetes cluster. SurrealDB provides official docs for deploying on:
- Kubernetes (generic)
- Amazon EKS
- Google GKE
- Azure AKS

### Latency Considerations

- **Local network**: <1ms round-trip (negligible for memory operations)
- **Same-region cloud**: 1-5ms round-trip
- **Cross-region**: 50-200ms round-trip (may be noticeable for frequent small queries)
- **For Claude Code hooks**: Network latency adds to hook execution time. Local/embedded modes are strongly preferred for latency-sensitive hooks.

### Evaluation for Plugin

| Criterion | Rating | Notes |
|-----------|--------|-------|
| Startup latency | N/A (always running) | No startup needed, but network latency per query |
| Data persistence | Excellent | Managed backups, high availability |
| Resource footprint | Zero local | All resources on remote server |
| Ease of setup | Good (Cloud) / Moderate (self-hosted) | Cloud: click-to-deploy; Self-hosted: ops burden |
| Best for | Teams, shared memory, production | Multi-user, enterprise scenarios |

---

## Export and Import Commands

These commands are **critical** for the plugin's data portability and backup strategy.

### `surreal export`

Exports a database as a SurrealQL script file containing all table definitions, field definitions, events, indexes, and data as `CREATE` statements.

```bash
# Basic export
surreal export \
  --conn http://localhost:8000 \
  --user root --pass secret \
  --ns myns --db mydb \
  ./backup.surql

# Export to stdout (pipe-friendly)
surreal export \
  --conn http://localhost:8000 \
  --user root --pass secret \
  --ns myns --db mydb

# Export with token authentication
surreal export \
  --conn http://localhost:8000 \
  --token <jwt-token> \
  --ns myns --db mydb \
  ./backup.surql
```

**Output format**: SurrealQL statements that can recreate the entire database:

```sql
-- Exported data from SurrealDB
-- Namespace: myns, Database: mydb

-- Table definitions
DEFINE TABLE users SCHEMAFULL;

-- Data
CREATE users:1 SET name = 'Alice', email = 'alice@example.com';
CREATE users:2 SET name = 'Bob', email = 'bob@example.com';
```

**Command options:**
| Option | Description |
|--------|-------------|
| `--endpoint, -e, --conn` | Database server URL (default: `http://127.0.0.1:8000`) |
| `--user, -u` | Root username |
| `--pass, -p` | Root password |
| `--token, -t` | JWT token (alternative to user/pass) |
| `--namespace, --ns` | Namespace to export from |
| `--database, --db` | Database to export from |
| `[FILE]` | Output file path (stdout if omitted) |

### `surreal import`

Imports a SurrealQL script file into a database, effectively restoring from backup.

```bash
surreal import \
  --conn http://localhost:8000 \
  --user root --pass secret \
  --ns myns --db mydb \
  ./backup.surql
```

### Plugin Implications

**Export/import enables several plugin strategies:**

1. **Periodic backup**: Schedule `surreal export` to save snapshots of memory data
2. **Migration between modes**: Export from in-memory, import to file-based (or vice versa)
3. **Cross-machine sync**: Export on one machine, import on another
4. **Version control**: Store `.surql` exports in git for memory versioning
5. **In-memory with persistence**: Start in-memory for speed, export periodically, import on restart

**Incremental backups**: Listed as a **future** feature on the SurrealDB roadmap. Currently, only full exports are supported. For a memory plugin with frequent small changes, full exports may be wasteful for large databases.

**SDK-level export/import**: The Rust SDK (and by extension the embedded engines) provides `db.export()` and `db.import()` methods that can be called programmatically:

```rust
// Export to a file
db.export("backup.surql").await?;

// Import from a file
db.import("backup.surql").await?;
```

This is much better than spawning CLI processes for the plugin.

---

## Recommended Deployment Tiers for the Plugin

Based on all research, here is the recommended deployment architecture for the [[SurrealDB Memory Plugin]]:

### Tier 0: Zero Config (Default)

**Mode**: Embedded via `@surrealdb/node` with `surrealkv://` backend

```typescript
const db = new Surreal({ engines: createNodeEngines() });
await db.connect("surrealkv://~/.claude/memory/surrealdb");
```

- **Startup**: Near-instant (no separate process)
- **Persistence**: Automatic (SurrealKV on disk)
- **Setup**: `npm install` only -- nothing else needed
- **Trade-off**: Database only accessible from the plugin process
- **Best for**: Individual developers, getting started

### Tier 1: Local Server

**Mode**: `surreal start rocksdb://` or `surreal start surrealkv://`

```bash
surreal start --user root --pass secret --bind 127.0.0.1:8000 rocksdb://~/.claude/memory/surrealdb
```

- **Startup**: Sub-second
- **Persistence**: Full ACID
- **Setup**: Install SurrealDB binary + start command
- **Advantage**: Database accessible from multiple tools (Surrealist UI, CLI, plugin)
- **Best for**: Power users who want to inspect/query memory directly

### Tier 2: Docker

**Mode**: Docker container with volume mount

```bash
docker run -d --name claude-memory \
  -p 8000:8000 \
  -v ~/.claude/memory/surrealdb:/data \
  surrealdb/surrealdb:latest \
  start --user root --pass secret rocksdb:///data/memory.db
```

- **Startup**: 1-3 seconds (container boot)
- **Persistence**: Docker volume
- **Setup**: Docker installed + one command
- **Advantage**: Isolation, easy cleanup, reproducible
- **Best for**: Users who prefer containerized services

### Tier 3: Remote / Cloud

**Mode**: SurrealDB Cloud or self-hosted server

```typescript
await db.connect("wss://instance-id.cloud.surrealdb.com/rpc");
```

- **Startup**: N/A (always running)
- **Persistence**: Managed backups
- **Setup**: Create cloud account or deploy server
- **Advantage**: Shared across machines, team collaboration
- **Trade-off**: Network latency on every query
- **Best for**: Teams, multi-machine workflows, enterprise

---

## Performance Context

### SurrealDB 3.0 Benchmarks (vs 2.0)

SurrealDB 3.0 shows major performance improvements:

| Operation | 2.0 Mean Latency | 3.0 Mean Latency | Improvement |
|-----------|-----------------|-----------------|-------------|
| CREATE | 1.94 ms | 0.72 ms | +63% faster |
| UPDATE | 2.58 ms | 0.73 ms | +72% faster |
| WHERE id = record:42 | 3,936 ms | 0.68 ms | +99.98% faster |
| LIMIT (all fields) | 17.45 ms | 2.46 ms | +86% faster |
| Graph out depth 3 | 18.02 ms | 3.02 ms | +83% faster |

These numbers are from dedicated benchmark hardware. Real-world performance on developer laptops will differ, but the relative improvements hold. Sub-millisecond individual record lookups are excellent for memory retrieval in hooks.

### Embedded vs SQLite (Relational Comparison)

SurrealDB publishes crud-bench comparisons against SQLite for embedded use. While SQLite is faster for pure relational CRUD, SurrealDB's multi-model capabilities (graph traversal, full-text search, vector search) make it more suitable for a memory system that needs diverse query patterns.

---

## Key Decisions for Plugin Architecture

1. **Default mode should be embedded `surrealkv://`** -- zero config, instant startup, persistent
2. **Offer `surreal export`/`import` for migration** between modes and for backup
3. **Support remote connection strings** for advanced users and teams
4. **SurrealKV temporal queries** are a unique advantage -- "show me what I knew about X on date Y"
5. **The `@surrealdb/node` package** is the primary integration point if the MCP server is in TypeScript
6. **The `surrealdb` PyPI package** is the alternative if the MCP server is in Python
7. **Docker compose template** should be provided as a ready-to-use option
8. **Export format is SurrealQL** (text-based, human-readable) -- good for debugging and version control
9. **Incremental backups are not yet available** -- full export only; plan accordingly for large memory stores
10. **SurrealDB Cloud free tier** (1 GB) is viable for lightweight/experimental use but not for heavy memory workloads

---

## Licensing Note

SurrealDB is available under the **Business Source License (BSL) 1.1**:
- **Free** for non-commercial use, development, testing, and internal applications
- **Commercial SaaS/cloud providers** offering SurrealDB as a service need a commercial license
- After a set period, the BSL transitions to an open-source license
- For a Claude Code plugin used by individual developers: **no licensing concerns**

---

## Sources

- SurrealDB official docs: surrealdb.com/docs
- SurrealDB releases: surrealdb.com/releases
- SurrealDB GitHub: github.com/surrealdb/surrealdb
- surrealdb.js GitHub: github.com/surrealdb/surrealdb.js
- surrealdb.py GitHub/PyPI: github.com/surrealdb/surrealdb.py
- SurrealDB Cloud: surrealdb.com/cloud
- SurrealDB benchmarks: surrealdb.com/benchmarks
- SurrealKV deep dive: ori-cohen.medium.com (SurrealKV article)
- SurrealDB deployment/storage fundamentals: surrealdb.com/learn/fundamentals/performance/deployment-storage

---

*Research conducted 2026-02-23 for [[SurrealDB Memory Plugin]] architecture design.*
