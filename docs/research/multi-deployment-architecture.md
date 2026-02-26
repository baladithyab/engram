# Multi-Deployment Architecture

> Design for supporting five SurrealDB deployment modes with a guided setup wizard,
> connection lifecycle management, data migration, and graceful fallback.

## Overview

The SurrealDB Memory Plugin must accommodate users ranging from "just trying it out" to
"running in production across a team." This document defines five deployment modes, a
setup wizard, configuration schema, connection management, migration tooling, and
fallback strategies — all designed so the plugin's memory operations remain identical
regardless of which backend is active.

```
┌─────────────────────────────────────────────────────────┐
│                   Claude Code Plugin                     │
│  ┌───────────────────────────────────────────────────┐  │
│  │            Memory Operations Layer                 │  │
│  │   (store, recall, relate, forget, consolidate)    │  │
│  └──────────────────────┬────────────────────────────┘  │
│                         │                                │
│  ┌──────────────────────▼────────────────────────────┐  │
│  │          Connection Abstraction Layer              │  │
│  │   (config → connect → health → reconnect → stop)  │  │
│  └──┬──────┬──────┬──────────┬──────────┬────────────┘  │
│     │      │      │          │          │                │
│   Memory  File  Docker  Installed   Remote              │
│     ▼      ▼      ▼          ▼          ▼                │
│  surreal surreal docker   ws://...  wss://...           │
│  start   start   run                                     │
│  memory  rocksdb surrealdb                               │
└─────────────────────────────────────────────────────────┘
```

---

## 1. Deployment Modes

### 1a. In-Memory (Zero-Config)

| Property | Value |
|----------|-------|
| Engine | `memory` |
| Persistence | None (snapshot on session end) |
| Startup command | `surreal start memory --bind 0.0.0.0:{{port}}` |
| User persona | Trying it out, ephemeral use, CI/CD |
| Requires | `surreal` binary on PATH |

**How it works:**

1. On MCP server startup, spawn `surreal start memory` as a child process.
2. Connect via `ws://localhost:{{port}}`.
3. Initialize [[SurrealDB Schema]] if first run.
4. On session end (Stop hook or MCP shutdown), run `surreal export` to snapshot file.
5. On next session start, if snapshot exists, run `surreal import` to restore.

**Snapshot persistence flow:**

```
Session Start                          Session End
    │                                      │
    ▼                                      ▼
surreal start memory              surreal export --conn ws://...
    │                                      │
    ▼                                      ▼
snapshot exists?                  .claude/engram/
  ├─ yes → surreal import            snapshots/{timestamp}.surql
  └─ no  → fresh start
```

**Snapshot directory structure:**

```
.claude/engram/snapshots/
  latest.surql              ← symlink to most recent
  2026-02-23T083000.surql   ← timestamped snapshots
  2026-02-22T143000.surql
```

Keep last 5 snapshots by default; configurable via `persistence.max_snapshots`.

**Trade-offs:**
- (+) Zero config, instant startup
- (+) No disk usage during session
- (-) Data loss if process crashes before export
- (-) Import time grows with data size
- (-) Requires `surreal` binary installed

---

### 1b. Local File (Recommended Default)

| Property | Value |
|----------|-------|
| Engine | `rocksdb` or `surrealkv` |
| Persistence | Continuous (on-disk) |
| Startup command | `surreal start rocksdb://.claude/engram/data --bind 0.0.0.0:{{port}}` |
| User persona | Individual developer, daily use |
| Requires | `surreal` binary on PATH |

**How it works:**

1. Check for existing PID file at `.claude/engram/surreal.pid`.
2. If PID exists and process is alive, reuse the connection.
3. If no running instance, spawn `surreal start` with file-backed engine.
4. Write PID file immediately after spawn.
5. On MCP shutdown (if `auto_stop: true`), send SIGTERM and remove PID file.

**PID management:**

```bash
PID_FILE=".claude/engram/surreal.pid"

start_surreal() {
    if [ -f "$PID_FILE" ]; then
        pid=$(cat "$PID_FILE")
        if kill -0 "$pid" 2>/dev/null; then
            echo "SurrealDB already running (PID $pid)"
            return 0
        fi
        rm "$PID_FILE"  # stale PID
    fi

    surreal start "rocksdb://$DATA_PATH" \
        --bind "0.0.0.0:$PORT" \
        --user root --pass root \
        --log info &

    echo $! > "$PID_FILE"
}

stop_surreal() {
    if [ -f "$PID_FILE" ]; then
        kill "$(cat "$PID_FILE")" 2>/dev/null
        rm "$PID_FILE"
    fi
}
```

**Port collision avoidance:**

The plugin checks if the configured port is in use before starting. If occupied:
1. Check if the occupant is a SurrealDB process (by PID file or process name).
2. If yes, connect to it.
3. If no, try next port (port + 1, up to 3 attempts).
4. Update config with actual port used.

**Engine choice — RocksDB vs SurrealKV:**

| Feature | RocksDB | SurrealKV |
|---------|---------|-----------|
| Maturity | Production-proven | Newer, SurrealDB-native |
| Performance | Excellent for reads | Optimized for SurrealDB workloads |
| Disk usage | Moderate (LSM compaction) | Typically smaller |
| Default | Yes (1.x) | May become default (2.x) |

Default to `rocksdb` unless user explicitly selects `surrealkv`. The setup wizard
will note the option.

**Trade-offs:**
- (+) Persistent without manual export/import
- (+) No Docker dependency
- (+) Survives crashes (write-ahead log)
- (-) Requires `surreal` binary
- (-) Data directory grows; needs occasional compaction

---

### 1c. Docker (Managed Container)

| Property | Value |
|----------|-------|
| Engine | `rocksdb` (inside container) |
| Persistence | Docker volume mount |
| Startup command | `docker run ...` or `docker compose up -d` |
| User persona | Team use, wants isolation |
| Requires | Docker daemon running |

**Container management:**

```bash
CONTAINER_NAME="engram"
IMAGE="surrealdb/surrealdb:latest"
PORT=8000
DATA_DIR="$(pwd)/.claude/engram/docker-data"

start_docker() {
    # Check if container exists
    if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        # Container exists — start if stopped
        if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
            docker start "$CONTAINER_NAME"
        fi
    else
        # Create new container
        docker run -d \
            --name "$CONTAINER_NAME" \
            --restart unless-stopped \
            -p "${PORT}:8000" \
            -v "${DATA_DIR}:/data" \
            "$IMAGE" \
            start --user root --pass root \
            "rocksdb:///data/db" \
            --log info
    fi
}

health_check() {
    docker exec "$CONTAINER_NAME" \
        surreal isready --conn http://localhost:8000 2>/dev/null
}
```

**docker-compose.yml template:**

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

**Trade-offs:**
- (+) Fully isolated — no host-level dependencies beyond Docker
- (+) Easy version pinning
- (+) Team-friendly: same image everywhere
- (-) Docker daemon must be running
- (-) Slightly higher latency (container networking)
- (-) More disk usage (image layer)

---

### 1d. Installed Binary (User-Managed)

| Property | Value |
|----------|-------|
| Engine | User's choice |
| Persistence | User-managed |
| Startup | User runs `surreal start` themselves |
| User persona | Already has SurrealDB running |
| Requires | Running SurrealDB instance |

**How it works:**

1. Plugin reads connection URL from config.
2. Attempts to connect — no process management.
3. If connection fails, notifies user to start their instance.
4. Plugin does NOT start or stop SurrealDB in this mode.

**Configuration:**

```yaml
mode: installed
connection:
  url: ws://localhost:8000
  username: root
  password: root
  namespace: memory
  database: default
local:
  auto_start: false
  auto_stop: false
```

**Trade-offs:**
- (+) No plugin process management complexity
- (+) User has full control
- (+) Can share SurrealDB instance across projects
- (-) User must manage startup/shutdown
- (-) Plugin can't auto-recover from connection loss (can only retry)

---

### 1e. Remote (Cloud / Self-Hosted)

| Property | Value |
|----------|-------|
| Engine | Remote (SurrealDB Cloud or self-hosted) |
| Persistence | Server-side |
| Connection | `wss://` (TLS) |
| User persona | Team, production, multi-machine |
| Requires | Network access, credentials |

**How it works:**

1. Plugin connects to remote SurrealDB instance via WebSocket (TLS).
2. Uses namespace isolation for multi-user: `namespace = memory`, `database = {username}`.
3. Credentials stored in config file (see [[#Credential Management]]).
4. Supports SurrealDB Cloud and any self-hosted instance.

**Namespace isolation for teams:**

```
SurrealDB Instance
└── namespace: memory
    ├── database: alice    ← Alice's memories
    ├── database: bob      ← Bob's memories
    └── database: shared   ← team-wide memories (optional)
```

Each user's plugin connects to their own database within a shared namespace.
Team-wide memories (conventions, architecture decisions) can go in a `shared` database
that all users can read but only designated users can write.

**Credential management:**

Credentials are stored in the config file. For remote mode, users should:

1. Use environment variables for sensitive values:
   ```yaml
   connection:
     url: wss://cloud.surrealdb.com
     username: ${SURREALDB_USER}
     password: ${SURREALDB_PASS}
   ```
2. Or store directly in `.local.md` config (which should be in `.gitignore`).

The plugin resolves `${ENV_VAR}` patterns in config values at connection time.

**Trade-offs:**
- (+) Multi-machine sync — memories follow you
- (+) Team sharing with namespace isolation
- (+) No local process management
- (-) Network latency
- (-) Requires credential management
- (-) Monthly cost (SurrealDB Cloud)
- (-) Data leaves local machine

---

## 2. Setup Wizard (`/memory-setup`)

The `/memory-setup` command is a user-invocable skill that guides configuration
through an interactive flow.

### Wizard Flow

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Step 1     │────▶│   Step 2     │────▶│   Step 3     │
│   Detect     │     │  Recommend   │     │  Configure   │
│  Environment │     │    Mode      │     │   Selected   │
└──────────────┘     └──────────────┘     └──────┬───────┘
                                                  │
┌──────────────┐     ┌──────────────┐     ┌──────▼───────┐
│   Step 6     │◀────│   Step 5     │◀────│   Step 4     │
│ Write Config │     │   Init       │     │    Test      │
│              │     │  Schema      │     │  Connection  │
└──────────────┘     └──────────────┘     └──────────────┘
```

### Step 1: Detect Environment

Run detection probes and report findings:

```bash
# Detection script (conceptual)
detect_environment() {
    results=()

    # Check surreal binary
    if command -v surreal &>/dev/null; then
        version=$(surreal version 2>/dev/null)
        results+=("surreal_binary: installed ($version)")
    else
        results+=("surreal_binary: not found")
    fi

    # Check Docker
    if command -v docker &>/dev/null && docker info &>/dev/null; then
        results+=("docker: available")
    else
        results+=("docker: not available")
    fi

    # Check for running SurrealDB instances
    running=$(pgrep -f "surreal start" 2>/dev/null)
    if [ -n "$running" ]; then
        results+=("running_instance: yes (PID: $running)")
    fi

    # Check for Docker container
    if docker ps --format '{{.Names}}' 2>/dev/null | grep -q surrealdb; then
        results+=("docker_container: running")
    fi

    # Check for existing config
    if [ -f ".claude/engram.local.md" ]; then
        results+=("existing_config: found")
    fi

    # Check for existing data
    if [ -d ".claude/engram/data" ]; then
        results+=("existing_data: found")
    fi
}
```

**Output example:**

```
Environment Detection Results:
  surreal binary:   installed (v2.2.1)
  Docker:           available (Docker Desktop 4.37)
  Running instance: none detected
  Existing config:  not found
  Existing data:    not found
```

### Step 2: Recommend Mode

Decision logic:

```
Has existing config?
  └─ yes → Offer to keep current mode or reconfigure
  └─ no  →
      Has running SurrealDB instance?
        └─ yes → Recommend "installed" mode (connect to it)
        └─ no  →
            Is surreal binary available?
              └─ yes → Recommend "local-file" mode
              └─ no  →
                  Is Docker available?
                    └─ yes → Recommend "docker" mode
                    └─ no  → Recommend "in-memory" with install instructions
```

**Output example:**

```
Recommended: local-file mode
  SurrealDB v2.2.1 is installed and no instance is running.
  This mode gives you persistent storage with zero external dependencies.

Other options:
  [1] in-memory    — No persistence, fastest startup
  [2] local-file   — Persistent, recommended  ←
  [3] docker       — Isolated container
  [4] installed    — Connect to your own instance
  [5] remote       — SurrealDB Cloud or self-hosted

Select mode [2]:
```

### Step 3: Configure Selected Mode

Each mode has its own configuration prompts:

**In-memory:**
- Port (default: 8000)
- Snapshot on exit? (default: yes)

**Local-file:**
- Data path (default: `.claude/engram/data`)
- Engine: rocksdb or surrealkv (default: rocksdb)
- Port (default: 8000)
- Auto-start on session? (default: yes)
- Auto-stop on session end? (default: yes)

**Docker:**
- Container name (default: `engram`)
- Image (default: `surrealdb/surrealdb:latest`)
- Port (default: 8000)
- Data path for volume mount (default: `.claude/engram/docker-data`)

**Installed:**
- Connection URL (default: `ws://localhost:8000`)
- Username (default: `root`)
- Password (prompted, not echoed)

**Remote:**
- Connection URL (no default, must provide)
- Username (prompted)
- Password (prompted, not echoed)
- Namespace (default: `memory`)
- Database (default: machine hostname or username)

### Step 4: Test Connection

```
Testing connection to ws://localhost:8000...
  Connect:    OK (12ms)
  Auth:       OK (root/root)
  Namespace:  OK (memory)
  Database:   OK (default)
  Query:      OK (SELECT 1 → 1)

Connection verified successfully.
```

If test fails, show diagnostics and offer to retry or reconfigure.

### Step 5: Initialize Schema

```
Initializing SurrealDB schema...
  Table: memory_node     OK (created)
  Table: memory_edge     OK (created)
  Table: session_log     OK (created)
  Index: memory_node_ft  OK (full-text search)
  Index: memory_edge_rel OK (relationship lookup)
  Event: decay_trigger   OK (registered)

Schema initialized (6 objects created).
```

See [[SurrealDB Schema]] for the full schema definition.

### Step 6: Write Config

Write configuration to `.claude/engram.local.md` (see [[#3. Configuration File]]).

```
Configuration written to .claude/engram.local.md

Setup complete. The memory plugin is ready.
Run /memory-status to verify, or start using memory naturally in conversation.
```

---

## 3. Configuration File

**Location:** `.claude/engram.local.md`

This is an Obsidian-compatible markdown file with YAML frontmatter. The `.local.md`
suffix signals it should be in `.gitignore` (contains credentials and machine-specific paths).

### Full Schema

```yaml
---
# SurrealDB Memory Plugin Configuration
# Generated by /memory-setup on 2026-02-23
# Docs: [[Multi-Deployment Architecture]]

# Deployment mode
mode: local-file  # in-memory | local-file | docker | installed | remote

# Connection settings (all modes)
connection:
  url: ws://localhost:8000
  username: root
  password: root
  namespace: memory
  database: default

# Local process management (in-memory and local-file modes)
local:
  data_path: .claude/engram/data
  engine: rocksdb       # rocksdb | surrealkv (local-file only)
  port: 8000
  auto_start: true      # start SurrealDB on MCP server startup
  auto_stop: true       # stop SurrealDB on MCP server shutdown
  pid_file: .claude/engram/surreal.pid
  log_level: info       # error | warn | info | debug | trace
  startup_timeout_ms: 5000

# Docker settings (docker mode)
docker:
  container_name: engram
  image: surrealdb/surrealdb:latest
  port: 8000
  data_path: .claude/engram/docker-data
  auto_start: true
  auto_stop: false      # keep container running between sessions
  restart_policy: unless-stopped

# Persistence settings
persistence:
  snapshot_on_stop: true             # export data when session ends
  snapshot_path: .claude/engram/snapshots
  export_format: surql               # surql | json
  max_snapshots: 5                   # keep last N snapshots
  auto_backup_interval_hours: 0      # 0 = disabled

# Memory behavior tuning
memory:
  session_token_budget: 2000         # max tokens for memory context per query
  consolidation_threshold: 3         # consolidate after N related memories
  decay_half_life_days: 7            # memory relevance half-life
  max_recall_results: 10             # max memories returned per recall
  embedding_model: none              # none | local | remote (future)

# Connection resilience
resilience:
  health_check_interval_ms: 30000    # 30 seconds
  reconnect_max_retries: 5
  reconnect_base_delay_ms: 1000      # doubles each retry (exponential backoff)
  reconnect_max_delay_ms: 30000
  write_queue_max_size: 100          # max queued writes during outage
  fallback_to_file: true             # queue writes to file if DB unreachable
---

# SurrealDB Memory Plugin — Local Configuration

This file was generated by `/memory-setup`. Edit the YAML frontmatter above
to change settings. Run `/memory-setup` again to reconfigure interactively.

## Mode: local-file

Using RocksDB-backed local storage at `.claude/engram/data`.
SurrealDB will auto-start when Claude Code opens and auto-stop on exit.

## Notes

- This file should NOT be committed to version control (add to .gitignore)
- Credentials above are local-only defaults; change for remote mode
- See [[Multi-Deployment Architecture]] for mode details
```

### Config Resolution Order

Configuration values resolve in this order (later overrides earlier):

1. **Built-in defaults** — hardcoded in the MCP server
2. **Config file** — `.claude/engram.local.md` frontmatter
3. **Environment variables** — `SURREALDB_MEMORY_*` prefix
4. **`${VAR}` expansion** — config values containing `${ENV_VAR}` are expanded

Environment variable mapping:

| Config Path | Environment Variable |
|-------------|---------------------|
| `connection.url` | `SURREALDB_MEMORY_URL` |
| `connection.username` | `SURREALDB_MEMORY_USER` |
| `connection.password` | `SURREALDB_MEMORY_PASS` |
| `connection.namespace` | `SURREALDB_MEMORY_NS` |
| `connection.database` | `SURREALDB_MEMORY_DB` |
| `mode` | `SURREALDB_MEMORY_MODE` |

---

## 4. Connection Lifecycle Management

### Lifecycle State Machine

```
                    ┌──────────┐
         ┌─────────│  INIT    │
         │         └────┬─────┘
         │              │ read config
         │              ▼
         │         ┌──────────┐
         │    ┌────│ STARTING │◀────────────────┐
         │    │    └────┬─────┘                  │
         │    │         │ process ready           │ reconnect
         │    │         ▼                         │
         │    │    ┌──────────┐    health fail   ┌┴─────────┐
         │    │    │CONNECTING│───────────────▶│RECONNECTING│
         │    │    └────┬─────┘                └┬──────────┘
         │    │         │ auth OK                │ max retries
         │    │         ▼                        │
         │    │    ┌──────────┐                  │
         │    │    │ HEALTHY  │──health fail──▶──┘
         │    │    └────┬─────┘
         │    │         │ shutdown signal
         │    │         ▼
         │    │    ┌──────────┐
         │    └──▶│ STOPPING │
         │        └────┬─────┘
         │             │ export done / process exited
         │             ▼
         │        ┌──────────┐
         └───────▶│ STOPPED  │
                  └──────────┘
```

### Startup Sequence (by mode)

**In-Memory / Local-File:**

```
1. Read config
2. Check PID file → if alive process exists, skip to step 5
3. Select available port (configured port, or next available)
4. Spawn: surreal start {engine}://{path} --bind 0.0.0.0:{port}
5. Write PID file
6. Wait for ready (poll /health endpoint, up to startup_timeout_ms)
7. Connect WebSocket: ws://localhost:{port}
8. Authenticate: SIGNIN { user, pass }
9. USE NS {namespace} DB {database}
10. If in-memory + snapshot exists: IMPORT snapshot
11. Verify schema (run migrations if needed)
12. Start health check loop
13. State → HEALTHY
```

**Docker:**

```
1. Read config
2. Check if container exists and is running
3. If not running: docker start {name} OR docker run (create new)
4. Wait for health check (docker exec surreal isready)
5. Connect WebSocket
6. Authenticate + USE
7. Verify schema
8. Start health check loop
9. State → HEALTHY
```

**Installed / Remote:**

```
1. Read config
2. Connect WebSocket to configured URL
3. Authenticate
4. USE NS/DB
5. Verify schema
6. Start health check loop
7. State → HEALTHY
```

### Health Check Loop

```
Every {health_check_interval_ms}:
  1. Send: SELECT 1
  2. If response within 5s → healthy
  3. If timeout or error:
     a. Increment failure counter
     b. If failures >= 3 → State → RECONNECTING
     c. Begin reconnection sequence
```

### Reconnection with Exponential Backoff

```
reconnect(attempt = 0):
  if attempt >= reconnect_max_retries:
    State → DEGRADED (fallback mode)
    return

  delay = min(
    reconnect_base_delay_ms * (2 ^ attempt),
    reconnect_max_delay_ms
  )

  wait(delay)

  try:
    connect()
    authenticate()
    State → HEALTHY
    replay_queued_writes()
  catch:
    reconnect(attempt + 1)
```

**Backoff schedule (with defaults):**

| Attempt | Delay |
|---------|-------|
| 0 | 1s |
| 1 | 2s |
| 2 | 4s |
| 3 | 8s |
| 4 | 16s |
| 5 | 30s (capped) |

### Graceful Shutdown

```
shutdown():
  State → STOPPING

  1. Stop health check loop
  2. Flush any pending writes
  3. If snapshot_on_stop AND (mode == in-memory):
     EXPORT to {snapshot_path}/{timestamp}.surql
     Update "latest" symlink
     Prune old snapshots (keep max_snapshots)
  4. Close WebSocket connection
  5. If auto_stop AND (mode == in-memory OR mode == local-file):
     Send SIGTERM to surreal process
     Wait up to 5s for exit
     If still alive: SIGKILL
     Remove PID file
  6. If auto_stop AND mode == docker AND docker.auto_stop:
     docker stop {container_name}

  State → STOPPED
```

---

## 5. Data Migration (`/memory-migrate`)

### Export from Any Mode

All modes support `surreal export`, which produces a portable `.surql` file
containing all data as SurrealQL statements.

```
/memory-migrate export

Exporting memory data...
  Source: local-file (ws://localhost:8000)
  Tables: memory_node (142 records), memory_edge (87 records), session_log (23 records)

  Exported to: .claude/engram/exports/2026-02-23T120000.surql (48 KB)
```

### Import to Any Mode

```
/memory-migrate import .claude/engram/exports/2026-02-23T120000.surql

Importing memory data...
  Target: docker (ws://localhost:8000)

  Clearing existing data...  OK
  Importing records...       OK (252 records)
  Verifying integrity...     OK

  Import complete.
```

### Guided Mode Migration

```
/memory-migrate

Current mode: local-file
Data: 142 memories, 87 relationships

What would you like to do?
  [1] Export data (backup)
  [2] Switch to a different mode
  [3] Import data from file

Select [1]:
```

**If switching modes (option 2):**

```
Switch deployment mode

Current: local-file → Target: docker

Migration plan:
  1. Export current data to .surql file
  2. Run /memory-setup for docker mode
  3. Start Docker container
  4. Import data into new instance
  5. Verify record counts match
  6. Update config to docker mode
  7. (Optional) Clean up old local-file data

Proceed? [y/N]:
```

### Migration Matrix

| From \ To | In-Memory | Local-File | Docker | Installed | Remote |
|-----------|-----------|------------|--------|-----------|--------|
| In-Memory | -- | export/import | export/import | export/import | export/import |
| Local-File | export/import | -- | export/import | export/import | export/import |
| Docker | export/import | export/import | -- | export/import | export/import |
| Installed | export/import | export/import | export/import | -- | export/import |
| Remote | export/import | export/import | export/import | export/import | -- |

All migrations use the same export/import path. SurrealQL export format is
universal across all SurrealDB deployment types.

---

## 6. Fallback Strategy

### Design Principle

> The memory system must **never** block Claude's primary operation. Memory is an
> enhancement, not a prerequisite. If SurrealDB is unavailable, Claude continues
> working — just without memory augmentation.

### Degraded Mode

When SurrealDB becomes unreachable after exhausting reconnection attempts:

```
State Machine:
  HEALTHY → RECONNECTING → DEGRADED
                              │
                              ├── Writes: queued to local file
                              ├── Reads: return empty (no cached data)
                              └── Status: user notified once
```

### Write Queue

When in DEGRADED mode, write operations are queued to a local append-only file:

```
.claude/engram/write-queue.jsonl
```

Each line is a JSON object:

```json
{"ts":"2026-02-23T12:00:00Z","op":"CREATE","table":"memory_node","data":{...}}
{"ts":"2026-02-23T12:00:01Z","op":"RELATE","from":"memory_node:abc","edge":"relates_to","to":"memory_node:def","data":{...}}
```

**Queue constraints:**
- Max `write_queue_max_size` entries (default 100).
- If queue is full, oldest entries are dropped (log warning).
- Queue file is truncated after successful replay.

### Replay on Reconnection

When connection is restored:

```
replay_queued_writes():
  1. Read write-queue.jsonl
  2. For each entry (in order):
     a. Execute the operation against SurrealDB
     b. If conflict (duplicate key): skip (idempotent)
     c. If error: log and continue
  3. Truncate write-queue.jsonl
  4. Log: "Replayed N queued writes (M skipped, K errors)"
```

### User Notification

On entering DEGRADED mode:

```
[Memory] SurrealDB is unreachable after 5 retries.
Memory writes are being queued locally. Reads will return empty.
Claude will continue working normally without memory augmentation.
Run /memory-status for details.
```

On recovery:

```
[Memory] SurrealDB connection restored.
Replayed 12 queued writes successfully.
Memory is fully operational.
```

### Failure Scenarios and Responses

| Scenario | Detection | Response |
|----------|-----------|----------|
| SurrealDB process crashed | Health check fails | Restart process (in-memory/local-file) or reconnect |
| Docker container stopped | Health check fails | `docker start` (if auto_start) or notify user |
| Network partition (remote) | WebSocket close/timeout | Reconnect with backoff → DEGRADED |
| Disk full (local-file) | Write error | Notify user, continue reads, queue writes to memory |
| Port conflict on startup | Bind error | Try next port (up to 3) |
| Corrupt data file | Startup crash | Restore from latest snapshot, notify user |
| Auth failure | 401/403 response | Notify user, do not retry (credentials issue) |
| Schema mismatch | Version check on connect | Run migration, notify user |

---

## 7. Mode Comparison Summary

| Feature | In-Memory | Local-File | Docker | Installed | Remote |
|---------|-----------|------------|--------|-----------|--------|
| Setup complexity | Minimal | Low | Medium | None | Medium |
| Persistence | Snapshot | Continuous | Continuous | User-managed | Server-side |
| Dependencies | surreal binary | surreal binary | Docker | Running instance | Network |
| Process management | Plugin | Plugin | Plugin/Docker | User | None |
| Multi-machine | No | No | No | No | Yes |
| Team sharing | No | No | No | Possible | Yes |
| Crash recovery | Snapshot only | WAL | WAL + Docker restart | User-managed | Server-side |
| Performance | Fastest | Fast | Fast (slight overhead) | Depends | Network-bound |
| Recommended for | Evaluation, CI | Daily individual use | Team, isolation | Power users | Teams, multi-machine |

---

## Related Documents

- [[SurrealDB Schema]] — table definitions, indexes, events
- [[Plugin Architecture Overview]] — MCP server structure and tool definitions
- [[Memory Lifecycle]] — store, recall, consolidate, decay flows
- [[Claude Code Hooks Integration]] — SessionStart, Stop, and notification hooks
