# Deployment Modes

> How engram connects to SurrealDB across five deployment modes:
> embedded SurrealKV (default), local server, Docker, remote/cloud, and
> in-memory with snapshots.
>
> **See also:** [Overview](overview.md) | [Memory Model](memory-model.md)

---

## 1. Design Goal

The plugin's memory operations (store, recall, relate, forget, consolidate) are
identical regardless of which backend is active. The connection abstraction layer
resolves configuration, connects, manages health, and handles reconnection. Users
choose a deployment mode based on their needs -- the rest of the system is unaware
of the choice.

```
┌─────────────────────────────────────────────────────────┐
│                   Claude Code Plugin                     │
│  ┌───────────────────────────────────────────────────┐  │
│  │            Memory Operations Layer                 │  │
│  │   (store, recall, relate, forget, consolidate)    │  │
│  └──────────────────────┬────────────────────────────┘  │
│                         │                                │
│  ┌──────────────────────v────────────────────────────┐  │
│  │          Connection Abstraction Layer              │  │
│  │   (config -> connect -> health -> reconnect)      │  │
│  └──┬──────┬──────┬──────────┬──────────┬────────────┘  │
│     │      │      │          │          │                │
│  Embedded Local  Docker  Remote    In-Memory            │
│     v      v      v          v          v                │
│  surreal  ws://  docker   wss://     mem://              │
│  kv://    local  run                                     │
└─────────────────────────────────────────────────────────┘
```

---

## 2. Deployment Mode Summary

| Mode | Endpoint | Persistence | External Dependencies | Best For |
|------|----------|-------------|----------------------|----------|
| **Embedded** (default) | `surrealkv://{path}` | On-disk, continuous | None | Individual developer, daily use |
| **Local server** | `ws://localhost:{port}` | On-disk (RocksDB/SurrealKV) | `surreal` binary on PATH | Multiple plugins sharing one DB |
| **Docker** | `ws://localhost:{port}` | Docker volume | Docker daemon | Team use, environment isolation |
| **Remote** | `wss://{host}` | Cloud-managed | Network access | Shared/team memory, cross-machine |
| **In-memory** | `mem://` | Snapshots on exit | None | Testing, CI/CD, ephemeral use |

---

## 3. Embedded SurrealKV (Default)

This is the recommended mode for individual developers. The SurrealDB engine runs
in-process via the `surrealdb` npm package -- no external server, no Docker, no
network. Data persists to a local directory.

### Configuration

No configuration required. The plugin works out of the box.

**Default data path:** `~/.claude/engram/data`

**Endpoint:** `surrealkv://{data_path}`

### How It Works

1. MCP server starts, creates `SurrealDBClient` with `mode: "embedded"`
2. Client calls `db.connect("surrealkv://~/.claude/engram/data")`
3. SurrealDB opens/creates the SurrealKV database at that path
4. Schema is initialized via `initSchema()` (all `IF NOT EXISTS` -- idempotent)
5. Client is ready for queries

### Implementation

From `mcp/src/surrealdb-client.ts`:

```typescript
private resolveEndpoint(): string {
  switch (this.config.mode) {
    case "embedded":
      return `surrealkv://${this.config.dataPath
        ?? `${process.env.HOME}/.claude/engram/data`}`;
    // ...
  }
}
```

### Directory Structure

```
~/.claude/engram/
  data/                    <-- SurrealKV data files
    *.db                   <-- Database files (managed by SurrealKV)
```

### Trade-offs

- (+) Zero configuration, zero dependencies beyond `bun` and `surrealdb` npm package
- (+) No network hops -- fastest possible latency
- (+) Continuous persistence (survives crashes, no export/import)
- (+) No port conflicts or process management
- (-) Single process -- cannot be shared between concurrent Claude Code sessions
- (-) Data tied to one machine (no remote access)

---

## 4. Local Server Mode

A SurrealDB server runs as a separate process on localhost. Multiple Claude Code
sessions (or other tools) can share the same database.

### Configuration

Set via environment variables or `.claude/engram.local.md`:

```yaml
---
mode: local
url: ws://localhost:8000
username: root
password: root
namespace: memory
database: default
---
```

**Endpoint:** `ws://localhost:{port}` (default 8000)

### How It Works

1. User starts SurrealDB separately: `surreal start rocksdb://~/.claude/engram/data`
2. MCP server connects via WebSocket to the running instance
3. Authentication with username/password
4. Select namespace and database via `USE`
5. Schema initialized, client ready

### Server Startup

```bash
# Start SurrealDB with RocksDB persistence
surreal start rocksdb://~/.claude/engram/data \
  --bind 0.0.0.0:8000 \
  --user root --pass root \
  --log info

# Or with SurrealKV engine
surreal start surrealkv://~/.claude/engram/data \
  --bind 0.0.0.0:8000 \
  --user root --pass root
```

### PID Management (Planned)

The plugin will manage the server process lifecycle:

```bash
PID_FILE="$HOME/.claude/engram/surreal.pid"

# Check for existing instance
if [ -f "$PID_FILE" ]; then
  pid=$(cat "$PID_FILE")
  if kill -0 "$pid" 2>/dev/null; then
    echo "SurrealDB already running (PID $pid)"
    # Connect to existing instance
  else
    rm "$PID_FILE"  # stale PID
  fi
fi

# Start if not running
surreal start "rocksdb://$DATA_PATH" \
  --bind "0.0.0.0:$PORT" \
  --user root --pass root &
echo $! > "$PID_FILE"
```

### Port Collision Handling

If the configured port is occupied:
1. Check if the occupant is a SurrealDB process (by PID file or process name)
2. If yes, connect to it
3. If no, try next port (port + 1, up to 3 attempts)
4. Update runtime config with actual port used

### Trade-offs

- (+) Multiple clients can share one database
- (+) Persistent on disk (RocksDB WAL survives crashes)
- (+) Can be left running between sessions
- (-) Requires `surreal` binary installed
- (-) Port management complexity
- (-) Slightly higher latency than embedded (WebSocket hop)

---

## 5. Docker Mode

SurrealDB runs in a Docker container with volume-mounted persistence.

### Configuration

```yaml
---
mode: docker
url: ws://localhost:8000
username: root
password: root
---
```

### Container Management

```bash
CONTAINER_NAME="engram"
IMAGE="surrealdb/surrealdb:latest"
PORT=8000
DATA_DIR="$HOME/.claude/engram/docker-data"

# Start container (create if needed)
docker run -d \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  -p "${PORT}:8000" \
  -v "${DATA_DIR}:/data" \
  "$IMAGE" start \
  --user root --pass root \
  rocksdb:///data

# Or with docker-compose
docker compose -f .claude/engram/docker-compose.yml up -d
```

### docker-compose.yml (Planned)

```yaml
version: "3.8"
services:
  surrealdb:
    image: surrealdb/surrealdb:latest
    container_name: engram
    restart: unless-stopped
    ports:
      - "8000:8000"
    volumes:
      - ./data:/data
    command: start --user root --pass root rocksdb:///data
```

### Trade-offs

- (+) Complete isolation from host system
- (+) Easy to version-pin the SurrealDB image
- (+) Reproducible across machines
- (+) Container lifecycle management via Docker
- (-) Requires Docker daemon running
- (-) Higher startup latency (container boot)
- (-) Disk overhead for Docker layers

---

## 6. Remote / Cloud Mode

Connect to a remote SurrealDB instance (self-hosted or SurrealDB Cloud) over
secure WebSocket.

### Configuration

```yaml
---
mode: remote
url: wss://my-surreal.example.com
username: memory_user
password: <secret>
namespace: memory
database: default
---
```

**Endpoint:** `wss://{host}` (TLS required for remote)

### How It Works

1. MCP server connects via secure WebSocket to the remote endpoint
2. Authenticates with provided credentials
3. Selects namespace and database
4. All operations proceed over the network

### Use Cases

- **Team shared memory:** Multiple developers share a common SurrealDB instance,
  with each user in a separate namespace
- **Cross-machine continuity:** Access the same memory from different machines
- **SurrealDB Cloud:** Managed infrastructure, no self-hosting

### Security Considerations

- Always use `wss://` (TLS) for remote connections
- Credentials should not be committed to version control
- Use SurrealDB's namespace/database-level access control to isolate users
- Consider SurrealDB's `DEFINE ACCESS` for token-based authentication

### Trade-offs

- (+) Accessible from any machine
- (+) Team sharing via namespace isolation
- (+) No local infrastructure management
- (-) Network latency on every query (50-200ms typical)
- (-) Requires stable network connection
- (-) Data lives off-machine (privacy consideration)
- (-) Ongoing hosting cost

---

## 7. In-Memory Mode

All data lives in RAM. Optionally, a JSON snapshot is written on shutdown and
restored on startup.

### Configuration

```yaml
---
mode: memory
data_path: ~/.claude/engram/data
---
```

**Endpoint:** `mem://`

The `data_path` is used for snapshot storage, not for the database itself.

### How It Works

1. MCP server connects to `mem://` -- in-memory SurrealDB
2. If a snapshot file exists at `{data_path}/snapshot.json`, import it
3. All operations run against in-memory database (fastest possible)
4. On `close()`, export all data to `{data_path}/snapshot.json`

### Snapshot Persistence

From `mcp/src/surrealdb-client.ts`:

```typescript
async close(): Promise<void> {
  if (this.connected && this.config.mode === "memory") {
    await this.exportMemorySnapshot();
  }
  await this.db.close();
  this.connected = false;
}

private async exportMemorySnapshot(): Promise<void> {
  const dataPath = this.config.dataPath
    ?? `${process.env.HOME}/.claude/engram/data`;

  mkdirSync(dataPath, { recursive: true });

  const [memories] = await this.db.query(
    "SELECT * FROM memory WHERE status != 'forgotten'"
  );
  const [entities] = await this.db.query("SELECT * FROM entity");
  const [relations] = await this.db.query("SELECT * FROM relates_to");

  const snapshot = {
    exported_at: new Date().toISOString(),
    mode: this.config.mode,
    memories,
    entities,
    relations,
  };

  writeFileSync(
    join(dataPath, "snapshot.json"),
    JSON.stringify(snapshot, null, 2),
    "utf-8"
  );
}
```

### Trade-offs

- (+) Fastest possible read/write (pure RAM)
- (+) No disk I/O during operation
- (+) Good for testing and CI/CD
- (-) Data lost if process crashes before snapshot export
- (-) Import time grows with snapshot size
- (-) Memory usage grows with data volume

---

## 8. Configuration

### Environment Variables

The MCP server reads configuration from environment variables (set in `.mcp.json`):

| Variable | Default | Purpose |
|----------|---------|---------|
| `SURREAL_MODE` | `embedded` | Deployment mode |
| `SURREAL_DATA_PATH` | `~/.claude/engram/data` | Data directory |
| `SURREAL_URL` | -- | Server URL for local/remote modes |
| `SURREAL_USER` | `root` | Authentication username |
| `SURREAL_PASS` | `root` | Authentication password |
| `SURREAL_NS` | `memory` | SurrealDB namespace |
| `SURREAL_DB` | `default` | SurrealDB database |

### Project-Local Configuration File

Advanced configuration uses `.claude/engram.local.md` with YAML frontmatter.
The file is searched in the following order:

1. `{project_root}/.claude/engram.local.md`
2. `{CLAUDE_PROJECT_ROOT}/.claude/engram.local.md`
3. `{cwd}/.claude/engram.local.md`

```yaml
---
mode: local
url: ws://localhost:8000
data_path: /custom/data/path
username: root
password: root
namespace: memory
database: my_project
---

# SurrealDB Memory Configuration

This file configures the engram plugin for this project.
The YAML frontmatter above is parsed by the MCP server.
Everything below the frontmatter is documentation (ignored by the parser).
```

### Config Resolution

From `mcp/src/surrealdb-client.ts`:

```typescript
export function readConfig(projectRoot?: string): Partial<SurrealDBConfig> {
  const roots = [
    projectRoot,
    process.env.CLAUDE_PROJECT_ROOT,
    process.cwd(),
  ].filter(Boolean) as string[];

  for (const root of roots) {
    const configPath = join(root, ".claude", "engram.local.md");
    if (!existsSync(configPath)) continue;

    // Parse YAML frontmatter between --- delimiters
    const raw = readFileSync(configPath, "utf-8");
    const match = raw.match(/^---\n([\s\S]*?)\n---/);
    if (!match) continue;

    // Simple key: value parsing
    const config: Partial<SurrealDBConfig> = {};
    for (const line of match[1].split("\n")) {
      const [key, ...rest] = line.split(":");
      const value = rest.join(":").trim();
      // Map to config fields...
    }
    return config;
  }
  return {};
}
```

---

## 9. Connection Lifecycle

### State Machine

```
┌───────────────┐
│ DISCONNECTED  │ <-- initial state
└──────┬────────┘
       │ connect()
       v
┌───────────────┐
│  CONNECTING   │
└──────┬────────┘
       │ success
       v
┌───────────────┐     health check fail     ┌───────────────┐
│   CONNECTED   │ ─────────────────────────> │  RECONNECTING │
└──────┬────────┘                            └──────┬────────┘
       │                                            │
       │ close()                    reconnect       │
       v                           success          │
┌───────────────┐                     │             │
│ DISCONNECTING │                     └─────────────┘
└──────┬────────┘                           │
       │ (memory mode: export snapshot)     │ max retries
       v                                    v
┌───────────────┐                    ┌──────────────┐
│ DISCONNECTED  │                    │   FALLBACK   │
└───────────────┘                    └──────────────┘
```

### Connection in Code

From `mcp/src/surrealdb-client.ts`:

```typescript
async connect(): Promise<void> {
  const endpoint = this.resolveEndpoint();

  await this.db.connect(endpoint);

  // Memory mode doesn't need auth in SurrealDB embedded
  if (this.config.mode !== "memory") {
    await this.db.signin({
      username: this.config.username,
      password: this.config.password,
    });
  }

  await this.db.use({
    namespace: this.config.namespace,
    database: this.config.database,
  });

  this.connected = true;
}
```

---

## 10. Fallback Strategy

When the database is unreachable (network down, server crashed, Docker stopped),
the plugin degrades gracefully rather than blocking the user.

### JSONL Write Queue (Planned)

Writes that fail during an outage are appended to a local JSONL file:

```
~/.claude/engram/fallback-queue.jsonl
```

Each line is a JSON object with the operation and its parameters:

```json
{"op": "store_memory", "params": {"content": "...", "memory_type": "semantic", "scope": "project"}, "ts": "2026-02-23T14:30:00Z"}
{"op": "forget_memory", "params": {"memory_id": "memory:abc123"}, "ts": "2026-02-23T14:31:00Z"}
```

### Queue Replay

On reconnection, the queue is replayed in order:

```
1. Read fallback-queue.jsonl
2. For each line, execute the operation against SurrealDB
3. On success, remove the line
4. On failure, log and retry on next reconnection
5. When queue is empty, delete the file
```

### Hook Behavior During Outage

All hooks have timeouts (3-30 seconds). If SurrealDB is unreachable:

- **SessionStart hook:** Exits cleanly with code 0 (no memories injected)
- **PreToolUse hooks:** Return nothing (no memory context injected)
- **Stop hook:** Writes to fallback queue instead of SurrealDB
- **PreCompact hook:** Writes to fallback queue

The user's workflow is never blocked. Memory is an enhancement, not a gate.

---

## 11. Mode Selection Guide

| Scenario | Recommended Mode |
|----------|-----------------|
| First-time user, just trying it out | **Embedded** (default) |
| Daily individual development | **Embedded** |
| Multiple Claude Code sessions sharing memory | **Local server** |
| Team sharing memory across developers | **Remote** |
| CI/CD pipeline, ephemeral environments | **In-memory** |
| Need Docker isolation for compliance | **Docker** |
| Want zero local dependencies | **Remote** (SurrealDB Cloud) |
| Testing / development of the plugin itself | **In-memory** |

### Migration Between Modes

Data can be migrated between deployment modes using SurrealDB's native export/import:

```bash
# Export from embedded
surreal export --conn surrealkv://~/.claude/engram/data \
  --ns memory --db default > backup.surql

# Import to local server
surreal import --conn ws://localhost:8000 \
  --ns memory --db default \
  --user root --pass root < backup.surql
```

The JSON snapshot format (used by in-memory mode) is also a valid migration path:

```bash
# snapshot.json contains all memories, entities, and relations
# Can be imported programmatically via the MCP server
```
