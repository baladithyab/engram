# SurrealDB MCP Server

> Research compiled 2026-02-23. Covers the **official SurrealMCP** (Rust, by SurrealDB Ltd) and two prominent **community MCP servers** (Node.js and Python).

---

## What Is It?

SurrealMCP is a **Model Context Protocol (MCP)** server that lets AI assistants, agents, IDEs, and chatbots interact directly with SurrealDB databases. MCP -- open-sourced by Anthropic -- standardizes how LLMs discover and use external tools, acting as a "USB-C port for AI." SurrealMCP turns SurrealDB into persistent, permission-aware, real-time memory for AI agents.

Because SurrealDB is a **multi-model** database (documents, graphs, vectors, relational data, time-series), SurrealMCP gives agents access to all of those data models through a single query language (SurrealQL) over a single connection.

**Key value propositions:**

- **Agent memory** -- store conversations as vectors with graph-linked context and time-travel queries
- **Business intelligence** -- natural language to optimized SurrealQL, respecting access policies
- **Operational automation** -- schema creation, namespace management, data seeding without dashboards
- **RAG and semantic search** -- native HNSW vector indexes accessible directly through MCP tools

---

## Available Implementations

There are three notable SurrealDB MCP server implementations:

| | Official SurrealMCP | Community Node.js | Community Python |
|---|---|---|---|
| **Repo** | [surrealdb/surrealmcp](https://github.com/surrealdb/surrealmcp) | [nsxdavid/surrealdb-mcp-server](https://github.com/nsxdavid/surrealdb-mcp-server) | [lfnovo/surreal-mcp](https://github.com/lfnovo/surreal-mcp) |
| **Language** | Rust | TypeScript/Node.js | Python |
| **Stars** | ~81 | ~33 | newer |
| **Install** | Docker, `cargo install` | `npx`, `npm install -g` | `uvx`, `pip` |
| **License** | BSL 1.1 | MIT | MIT |
| **Status** | Preview (official) | Stable | Stable |
| **Transport** | stdio, HTTP, Unix socket | stdio | stdio |
| **Auth** | JWT/Bearer, JWKS, cloud auth | Basic (user/pass) | Basic (user/pass) |
| **Rate limiting** | Yes (configurable) | No | No |
| **OpenTelemetry** | Yes | No | No |
| **Embedded DB** | Yes (in-memory/on-disk) | No | No |
| **Connection pooling** | Yes | No | Yes |
| **Best for** | Production, edge, enterprise | JS full-stack, n8n | Python AI/ML, LangChain |

---

## MCP Tools Exposed

All three implementations expose the same **10 core tools**, mapping directly to SurrealDB's data API:

| Tool | Description | Example |
|------|-------------|---------|
| `query` | Execute raw SurrealQL queries | `query("SELECT * FROM user WHERE age > 25 AND ->knows->person")` |
| `select` | Retrieve all records from a table, or a specific record by ID | `select("user", "john")` |
| `create` | Insert a new record with auto-generated ID | `create("user", {"name": "Alice", "interests": ["AI"]})` |
| `update` | Replace entire record content (preserves ID) | `update("user:alice", {"name": "Alice V2"})` |
| `delete` | Permanently remove a record | `delete("user:alice")` |
| `merge` | Partial update -- only specified fields change | `merge("user:john", {"last_login": "2026-02-23T10:00:00Z"})` |
| `patch` | Apply JSON Patch (RFC 6902) operations | `patch("user:john", [{"op": "add", "path": "/tags/-", "value": "vip"}])` |
| `upsert` | Create or update a record | `upsert("settings:global", {"theme": "dark"})` |
| `insert` | Bulk insert multiple records | `insert("product", [{"name": "Laptop"}, {"name": "Mouse"}])` |
| `relate` | Create graph edges between records | `relate("user:john", "purchased", "product:laptop", {"date": "2026-02-23"})` |

The `query` tool is the most powerful -- it can run any arbitrary SurrealQL, including graph traversals, vector searches, aggregations, `DEFINE TABLE`, `DEFINE INDEX`, `LIVE SELECT`, and multi-statement transactions.

---

## Installation and Setup

### Option 1: Official SurrealMCP via Docker (Recommended)

The simplest way to get started. No local toolchain needed.

```bash
# Pull and run (ephemeral in-memory database)
docker run --rm -i --pull always surrealdb/surrealmcp:latest start

# Connect to an existing SurrealDB instance
docker run --rm -i --pull always surrealdb/surrealmcp:latest start \
  --endpoint ws://host.docker.internal:8000/rpc \
  --ns myapp --db production \
  --user root --pass root
```

> **Note:** Use `host.docker.internal` instead of `localhost` when connecting from Docker Desktop to a SurrealDB instance running on the host.

### Option 2: Official SurrealMCP from Source (Rust)

```bash
git clone https://github.com/surrealdb/surrealmcp.git
cd surrealmcp
cargo install --path .

# Run
surrealmcp start
```

### Option 3: Community Node.js Server via npx

```bash
# No installation needed -- npx downloads and runs it
npx -y surrealdb-mcp-server

# Or install globally
npm install -g surrealdb-mcp-server
```

Requires Node.js >= 18.0.0.

### Option 4: Community Python Server via uvx

```bash
# Run directly (no install)
uvx surreal-mcp

# Or from GitHub
uvx --from git+https://github.com/lfnovo/surreal-mcp.git surreal-mcp
```

Requires Python 3.10+ and FastMCP 2.11+.

---

## Configuration for Claude Code (`~/.claude.json`)

### Official SurrealMCP (Docker)

```json
{
  "mcpServers": {
    "surrealdb": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i", "--pull", "always",
        "surrealdb/surrealmcp:latest", "start"
      ]
    }
  }
}
```

### Official SurrealMCP with Existing Database

```json
{
  "mcpServers": {
    "surrealdb": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i", "--pull", "always",
        "surrealdb/surrealmcp:latest", "start",
        "--endpoint", "ws://host.docker.internal:8000/rpc",
        "--ns", "myapp",
        "--db", "production",
        "--user", "root",
        "--pass", "root"
      ]
    }
  }
}
```

### Official SurrealMCP Binary (if installed via cargo)

```json
{
  "mcpServers": {
    "surrealdb": {
      "command": "surrealmcp",
      "args": ["start"],
      "env": {
        "SURREALDB_URL": "ws://localhost:8000/rpc",
        "SURREALDB_NS": "myapp",
        "SURREALDB_DB": "production",
        "SURREALDB_USER": "root",
        "SURREALDB_PASS": "root"
      }
    }
  }
}
```

### Community Node.js Server (npx)

```json
{
  "mcpServers": {
    "surrealdb": {
      "command": "npx",
      "args": ["-y", "surrealdb-mcp-server"],
      "env": {
        "SURREALDB_URL": "ws://localhost:8000",
        "SURREALDB_NS": "myapp",
        "SURREALDB_DB": "production",
        "SURREALDB_USER": "root",
        "SURREALDB_PASS": "root"
      }
    }
  }
}
```

### Community Python Server (uvx)

```json
{
  "mcpServers": {
    "surrealdb": {
      "command": "uvx",
      "args": ["surreal-mcp"],
      "env": {
        "SURREAL_URL": "ws://localhost:8000/rpc",
        "SURREAL_USER": "root",
        "SURREAL_PASSWORD": "root",
        "SURREAL_NAMESPACE": "myapp",
        "SURREAL_DATABASE": "production"
      }
    }
  }
}
```

> **Note:** The Python server uses different env var names (`SURREAL_*` vs `SURREALDB_*`).

---

## Environment Variables

### Official SurrealMCP

| Variable | Description | Example |
|----------|-------------|---------|
| `SURREALDB_URL` | Database connection URL | `ws://localhost:8000/rpc` |
| `SURREALDB_NS` | Namespace | `myapp` |
| `SURREALDB_DB` | Database | `production` |
| `SURREALDB_USER` | Username | `root` |
| `SURREALDB_PASS` | Password | `root` |

### Community Node.js Server

Same variable names as the official server (`SURREALDB_*`).

### Community Python Server

| Variable | Description | Example |
|----------|-------------|---------|
| `SURREAL_URL` | Database connection URL | `ws://localhost:8000/rpc` |
| `SURREAL_USER` | Username | `root` |
| `SURREAL_PASSWORD` | Password | `root` |
| `SURREAL_NAMESPACE` | Namespace (optional, can override per tool call) | `myapp` |
| `SURREAL_DATABASE` | Database (optional, can override per tool call) | `production` |

---

## CLI Flags (Official SurrealMCP)

### Database Connection

| Flag | Description |
|------|-------------|
| `--endpoint <URL>` | WebSocket URL (e.g., `ws://localhost:8000/rpc`) |
| `--ns <NAMESPACE>` | Target namespace |
| `--db <DATABASE>` | Target database |
| `--user <USERNAME>` | Authentication username |
| `--pass <PASSWORD>` | Authentication password |

### Server Configuration

| Flag | Description |
|------|-------------|
| `--bind-address <ADDR>` | HTTP server bind address (e.g., `127.0.0.1:8000`) |
| `--server-url <URL>` | Public server URL |
| `--socket-path <PATH>` | Unix socket path |
| `--auth-disabled` | Disable authentication (dev only) |
| `--cloud-auth-server <URL>` | Cloud authentication server URL |
| `--expected-audience <URL>` | Custom JWT audience for enterprise |
| `--rate-limit-rps <N>` | Requests per second limit |
| `--rate-limit-burst <N>` | Burst capacity |

---

## Transport Modes (Official SurrealMCP)

### stdio (Default)

Standard input/output -- ideal for IDE integration (Claude Code, Cursor, VSCode, Zed).

```bash
surrealmcp start
```

### HTTP Server

RESTful JSON endpoints for remote or multi-client access.

```bash
surrealmcp start --bind-address 127.0.0.1:8000 --server-url http://localhost:8000
```

### Unix Socket

Secure local communication for containerized environments.

```bash
surrealmcp start --socket-path /tmp/surrealmcp.sock
```

---

## Authentication Options

### Basic Auth (All Servers)

Username/password via environment variables or CLI flags. Supports Root, Namespace, Database, or Scope-level SurrealDB users.

### Bearer Token / JWT (Official Only)

For SurrealDB Cloud and enterprise deployments:

```bash
surrealmcp start --cloud-auth-server https://auth.surrealdb.com
```

- JWKS token validation
- Custom audience configuration (`--expected-audience`)
- Per-request token validation

### Development Mode (Official Only)

Disable auth entirely for local development:

```bash
surrealmcp start --auth-disabled
```

---

## Example Usage Patterns

### Creating and Querying Data

```
User: "Create a users table and add some sample data"
Agent calls: query("DEFINE TABLE user SCHEMAFULL")
Agent calls: query("DEFINE FIELD name ON user TYPE string")
Agent calls: query("DEFINE FIELD email ON user TYPE string")
Agent calls: insert("user", [
  {"name": "Alice", "email": "alice@example.com"},
  {"name": "Bob", "email": "bob@example.com"}
])
Agent calls: select("user")
```

### Graph Relationships

```
User: "Track that Alice follows Bob"
Agent calls: relate("user:alice", "follows", "user:bob", {"since": "2026-02-23"})

User: "Who does Alice follow?"
Agent calls: query("SELECT ->follows->user.name FROM user:alice")
```

### Vector Search (via query tool)

```
User: "Find products similar to this description"
Agent calls: query("SELECT * FROM product WHERE embedding <|5|> [0.12, 0.34, ...]")
```

### Upsert for Idempotent Operations

```
User: "Update the global settings, or create them if they don't exist"
Agent calls: upsert("settings:global", {
  "theme": "dark",
  "language": "en",
  "notifications": true
})
```

### JSON Patch for Surgical Updates

```
User: "Add a 'premium' tag to user john"
Agent calls: patch("user:john", [
  {"op": "add", "path": "/tags/-", "value": "premium"}
])
```

---

## Deployment Architectures

### Local Development (Ephemeral)

The official SurrealMCP can spin up an **in-memory SurrealDB instance** internally -- no separate database server needed. Data is lost when the MCP server stops.

```json
{
  "command": "docker",
  "args": ["run", "--rm", "-i", "surrealdb/surrealmcp:latest", "start"]
}
```

### Local Development (Persistent)

Connect to a SurrealDB instance running locally:

```bash
# Start SurrealDB
surreal start file:mydata.db

# Configure MCP to connect to it
surrealmcp start --endpoint ws://localhost:8000/rpc --user root --pass root
```

### Production / SurrealDB Cloud

```bash
surrealmcp start \
  --endpoint wss://cloud.surrealdb.com/rpc \
  --cloud-auth-server https://auth.surrealdb.com \
  --expected-audience https://my-app.surrealdb.com/ \
  --rate-limit-rps 100 \
  --rate-limit-burst 200
```

### Edge / Embedded

SurrealMCP + embedded SurrealDB runs on edge devices, laptops, and constrained environments -- ideal for local AI agents that need persistent memory without network dependencies.

---

## Comparison with Other Database MCP Servers

| Feature | SurrealDB MCP | PostgreSQL MCP | SQLite MCP | Neo4j MCP |
|---------|---------------|----------------|------------|-----------|
| **Data models** | Document + Graph + Vector + Relational | Relational (+ pgvector extension) | Relational | Graph |
| **Query language** | SurrealQL | SQL | SQL | Cypher |
| **Vector search** | Native HNSW | Via pgvector extension | Not native | Not native |
| **Graph traversal** | Native (record links, `->` syntax) | Via recursive CTEs | Not supported | Native |
| **Schema flexibility** | Schemaless or schemafull per table | Schema required | Flexible types | Schema optional |
| **Embedded mode** | Yes (in-memory, on-disk) | No (server required) | Yes (file-based) | No (server required) |
| **Auth in MCP** | JWT, Bearer, user/pass | Typically user/pass | None (file access) | User/pass |
| **MCP tools count** | 10 (CRUD + graph + bulk) | Varies (usually query + schema) | Varies (query + schema) | Query + node ops |
| **Official support** | Yes (SurrealDB Ltd) | Community only | Community only | Community only |

**SurrealDB's advantage:** A single MCP server gives agents access to documents, graphs, vectors, and relational data -- replacing what would otherwise require separate PostgreSQL, Neo4j, and Pinecone/Qdrant MCP servers.

---

## Other SurrealDB AI/LLM Integrations

Beyond MCP, SurrealDB integrates with a broad ecosystem of AI frameworks:

| Framework | Integration Type |
|-----------|-----------------|
| **LangChain** | Vector store, document store, chat history |
| **Llama Index** | HNSW vector index as backing store for RAG |
| **Agno** | Multi-agent shared memory and knowledge |
| **CrewAI** | Entity memory and short-term memory for agents |
| **Pydantic AI** | Production-grade GenAI workflow backend |
| **Camel** | Multi-agent LLM systems with vector storage |
| **Dynamiq** | Multi-agent systems with vector storage |
| **Google Agent** | Vector storage for RAG in Google Cloud agents |
| **Smol Agents** | HNSW vector index for code-generating agents |
| **Feast** | Feature store with vector search for ML pipelines |
| **Dagster** | Data orchestration with vector search for ML |
| **DeepEval** | RAG pipeline quality evaluation via vectors |

SurrealDB 3.0's **Surrealism** extension system also enables direct integration with AI models (local and remote) from within SurrealQL queries -- running inference, embeddings, classification, and more as part of database operations.

---

## Limitations and Caveats

- **Official server is in "preview" status** -- the API may change before GA
- **BSL 1.1 license** on the official server (not MIT/Apache) -- review terms for commercial use
- **Docker pull on every start** with `--pull always` adds latency to cold starts
- **Community servers lack enterprise features** -- no JWT auth, rate limiting, or OpenTelemetry
- **No MCP resource exposure** -- current implementations only expose tools, not MCP resources or prompts
- **WebSocket requirement** -- all servers connect to SurrealDB via WebSocket (`ws://` or `wss://`), not HTTP
- **SurrealDB must be running** for the Node.js and Python servers (they don't embed the database)

---

## Links and References

- **Official SurrealMCP page:** https://surrealdb.com/mcp
- **Official GitHub repo:** https://github.com/surrealdb/surrealmcp
- **Official blog post:** https://surrealdb.com/blog/introducing-surrealmcp
- **Community Node.js server:** https://github.com/nsxdavid/surrealdb-mcp-server (npm: `surrealdb-mcp-server`)
- **Community Python server:** https://github.com/lfnovo/surreal-mcp
- **SurrealDB framework integrations:** https://surrealdb.com/docs/integrations/frameworks
- **SurrealDB 3.0 release:** https://surrealdb.com/blog/introducing-surrealdb-3-0--the-future-of-ai-agent-memory
- **Multi-tool agent tutorial (SurrealMCP + Agno):** https://surrealdb.com/blog/multi-tool-agent-with-surrealmcp-and-agno
- **Docker Hub image:** `surrealdb/surrealmcp:latest`
- **npm package:** https://www.npmjs.com/package/surrealdb-mcp-server

---

## See Also

- [[Core Features and Whats New]]
- [[Data Model and Multi-Model Architecture]]
- [[Advanced Features Functions Indexes Analyzers]]
- [[SDKs Deployment and Ecosystem]]
- [[Real-Time Live Queries and Changefeeds]]
