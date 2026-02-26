# Deployment Modes

The engram plugin supports five deployment modes. Each uses the same
memory operations and MCP tools -- only the database backend changes.

## Mode Comparison

| Feature | Embedded SurrealKV | In-Memory | Local Server | Docker | Remote/Cloud |
|---------|-------------------|-----------|-------------|--------|-------------|
| Setup | Zero config | Minimal | Low | Medium | Medium |
| Persistence | Continuous | Snapshot on exit | Continuous | Continuous | Server-side |
| Dependencies | None (bundled) | `surreal` binary | `surreal` binary | Docker | Network |
| Process mgmt | In-process | Plugin-managed | Plugin-managed | Docker | None |
| Multi-machine | No | No | No | No | Yes |
| Crash recovery | Built-in | Snapshot only | WAL | WAL + Docker | Server-side |
| Best for | Single developer | Evaluation, CI | Power users | Teams, isolation | Teams, multi-machine |

## 1. Embedded SurrealKV (Default)

The simplest option. SurrealDB runs in-process via the `surrealdb` npm package
with the SurrealKV embedded engine. No external processes or binaries needed.

### How it Works

The MCP server connects using a `surrealkv://` endpoint that points to a local
directory. The SurrealDB engine runs inside the Bun process itself.

```typescript
// From mcp/src/index.ts
const db = new SurrealDBClient({
  mode: "embedded",
  dataPath: process.env.SURREAL_DATA_PATH ?? `${process.env.HOME}/.claude/engram/data`,
  username: "root",
  password: "root",
  namespace: "memory",
  database: "default",
});
```

The connection endpoint resolves to:

```
surrealkv:///Users/you/.claude/engram/data
```

### Data Location

By default: `~/.claude/engram/data/`

This is a directory of SurrealKV files that persist across sessions. To change it,
set the `SURREAL_DATA_PATH` environment variable or configure `local.data_path`
in the config file.

### Setup

No setup required. Just install dependencies and launch:

```bash
cd mcp && bun install
claude --plugin-dir /path/to/engram
```

### Trade-offs

- (+) Zero configuration, zero external dependencies
- (+) Data persists automatically -- no import/export cycle
- (+) Fastest possible latency (no network hop)
- (+) No port conflicts
- (-) Single machine only
- (-) Data directory grows over time

---

## 2. In-Memory with Snapshots

Data lives entirely in memory during a session. On session end, the plugin
exports a `.surql` snapshot. On next session start, the snapshot is imported.

### How it Works

1. Plugin spawns `surreal start memory --bind 0.0.0.0:8000` as a child process
2. Connects via `ws://localhost:8000`
3. If a snapshot exists at the configured path, imports it
4. On session end, runs `surreal export` to save a timestamped snapshot
5. Keeps the last N snapshots (default 5)

### Prerequisites

- `surreal` binary on PATH -- install from https://surrealdb.com/install

### Configuration

```yaml
---
mode: memory

local:
  port: 8000
  auto_start: true
  auto_stop: true

persistence:
  snapshot_on_stop: true
  snapshot_path: .claude/engram/snapshots
  max_snapshots: 5
---
```

### Snapshot Directory

```
.claude/engram/snapshots/
  latest.surql              # symlink to most recent
  2026-02-23T083000.surql   # timestamped snapshots
  2026-02-22T143000.surql
```

### Trade-offs

- (+) Zero disk usage during session
- (+) Clean state each time (import from snapshot)
- (-) Data loss if process crashes before export
- (-) Import time grows with data size
- (-) Requires `surreal` binary installed

---

## 3. Local Server

A standalone SurrealDB process managed by the plugin. Uses RocksDB or SurrealKV
for persistent, on-disk storage via a local WebSocket connection.

### Prerequisites

- `surreal` binary on PATH -- install from https://surrealdb.com/install

### How it Works

1. Plugin checks for a PID file at `.claude/engram/surreal.pid`
2. If a live process exists, reuses the connection
3. If not, spawns `surreal start rocksdb://.claude/engram/data --bind 0.0.0.0:8000`
4. Writes PID file
5. On shutdown (if `auto_stop: true`), sends SIGTERM and removes PID file

### Configuration

```yaml
---
mode: local

connection:
  url: ws://localhost:8000
  username: root
  password: root
  namespace: memory
  database: default

local:
  data_path: .claude/engram/data
  engine: rocksdb
  port: 8000
  auto_start: true
  auto_stop: true
  pid_file: .claude/engram/surreal.pid
  log_level: info
  startup_timeout_ms: 5000
---
```

### Engine Choice: RocksDB vs SurrealKV

| Feature | RocksDB | SurrealKV |
|---------|---------|-----------|
| Maturity | Production-proven | Newer, SurrealDB-native |
| Performance | Excellent for reads | Optimized for SurrealDB workloads |
| Disk usage | Moderate (LSM compaction) | Typically smaller |

Default to `rocksdb`. Set `local.engine: surrealkv` to use SurrealKV instead.

### Port Conflict Handling

If the configured port is in use:

1. Check if the occupant is a SurrealDB process (by PID file)
2. If yes, connect to it
3. If no, try next port (up to 3 attempts)

### Trade-offs

- (+) Persistent without manual export/import
- (+) Survives crashes (write-ahead log)
- (+) Can share the SurrealDB instance across tools
- (-) Requires `surreal` binary installed
- (-) Occupies a port on localhost

---

## 4. Docker

SurrealDB runs in a Docker container with a volume mount for data persistence.

### Prerequisites

- Docker daemon running (`docker info` should succeed)

### How it Works

1. Plugin checks if a container named `engram` exists
2. If stopped, starts it. If missing, creates a new one.
3. Waits for health check (`surreal isready`)
4. Connects via WebSocket

### Configuration

```yaml
---
mode: docker

connection:
  url: ws://localhost:8000
  username: root
  password: root
  namespace: memory
  database: default

docker:
  container_name: engram
  image: surrealdb/surrealdb:latest
  port: 8000
  data_path: .claude/engram/docker-data
  auto_start: true
  auto_stop: false
  restart_policy: unless-stopped
---
```

### Manual Docker Setup

If you prefer to manage the container yourself:

```bash
docker run -d \
  --name engram \
  --restart unless-stopped \
  -p 8000:8000 \
  -v "$(pwd)/.claude/engram/docker-data:/data" \
  surrealdb/surrealdb:latest \
  start --user root --pass root rocksdb:///data/db --log info
```

Or with docker-compose:

```yaml
# .claude/engram/docker-compose.yml
version: '3.8'

services:
  surrealdb:
    image: surrealdb/surrealdb:latest
    container_name: engram
    restart: unless-stopped
    ports:
      - "${SURREALDB_PORT:-8000}:8000"
    volumes:
      - ./docker-data:/data
    command: start --user root --pass root rocksdb:///data/db --log info
    healthcheck:
      test: ["CMD", "surreal", "isready", "--conn", "http://localhost:8000"]
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 5s
```

Then set `docker.auto_start: false` in your config since you manage the
container lifecycle.

### Trade-offs

- (+) Fully isolated from host
- (+) Easy version pinning
- (+) Team-friendly -- same image everywhere
- (-) Docker daemon must be running
- (-) Slightly higher latency (container networking)
- (-) More disk usage (image layer)

---

## 5. Remote / Cloud

Connect to a SurrealDB instance running elsewhere -- SurrealDB Cloud, a
self-hosted server, or a shared team instance.

### Prerequisites

- Network access to the SurrealDB endpoint
- Valid credentials

### Configuration

```yaml
---
mode: remote

connection:
  url: wss://my-instance.surrealdb.cloud
  username: ${SURREALDB_USER}
  password: ${SURREALDB_PASS}
  namespace: memory
  database: myproject
---
```

Use environment variables for credentials to avoid hardcoding secrets:

```bash
export SURREALDB_USER="myuser"
export SURREALDB_PASS="mypassword"
```

### Namespace Isolation for Teams

Multiple users can share one SurrealDB instance with namespace isolation:

```
SurrealDB Instance
  namespace: memory
    database: alice     # Alice's memories
    database: bob       # Bob's memories
    database: shared    # team-wide memories (optional)
```

Set `connection.database` to your username or a project identifier.

### Trade-offs

- (+) Memories sync across machines
- (+) Team sharing with namespace isolation
- (+) No local process management
- (-) Network latency on every query
- (-) Requires credential management
- (-) Data leaves local machine
- (-) Monthly cost (SurrealDB Cloud)

---

## Migration Between Modes

All modes use the same SurrealDB schema and data format. You can migrate between
modes using SurrealQL export/import.

### Export from Current Mode

```bash
# Connect to your current instance and export
surreal export --conn ws://localhost:8000 \
  --user root --pass root \
  --ns memory --db default \
  > backup.surql
```

### Import to New Mode

1. Set up the new mode (update config, start the new backend)
2. Import the data:

```bash
surreal import --conn ws://localhost:8000 \
  --user root --pass root \
  --ns memory --db default \
  backup.surql
```

### Step-by-Step Mode Switch

1. Export data from current mode (see above)
2. Edit `.claude/engram.local.md` to set the new `mode`
3. Restart Claude Code (the MCP server picks up the new config)
4. Import data into the new backend
5. Verify with `/memory-status`

### Embedded to Local Server Example

```bash
# 1. Start a local SurrealDB server
surreal start rocksdb://.claude/engram/data \
  --bind 0.0.0.0:8000 --user root --pass root

# 2. The embedded data is already on disk at the same path,
#    so switching to local mode pointing at the same data_path
#    should preserve everything. Update config:
#    mode: local
#    connection.url: ws://localhost:8000
#    local.data_path: .claude/engram/data

# 3. Restart Claude Code and verify
```

For embedded-to-remote or local-to-docker migrations where data paths differ,
use the export/import approach.
