# surrealdb-memory

Persistent, hierarchical, self-evolving memory for [Claude Code](https://claude.com/claude-code), powered by [SurrealDB](https://surrealdb.com).

## Why

Every Claude Code session starts from scratch. CLAUDE.md helps, but it's static and hand-maintained. This plugin gives Claude **actual memory** — it learns from your sessions, remembers across projects, and gets smarter over time.

**What makes this different from other memory plugins:**

Most memory systems (Mem0, Zep, etc.) bolt together 3-4 databases — Postgres for structure, Neo4j for graphs, Qdrant for vectors, Redis for cache. This plugin uses a single SurrealDB instance that natively handles all four: documents, graphs, vectors (HNSW), and full-text search (BM25) in one query language.

## Quick Start

```bash
# Clone
git clone https://github.com/baladithyab/surrealdb-memory.git
cd surrealdb-memory

# Install MCP server dependencies
cd mcp && bun install && cd ..

# Load the plugin in Claude Code
claude --plugin-dir /path/to/surrealdb-memory
```

That's it. The plugin auto-configures on first run:
- Creates `.claude/surrealdb-memory.local.md` with default settings
- Uses embedded SurrealDB (no separate process needed)
- Persists data at `~/.claude/surrealdb-memory/data/`

## How It Works

### Memory Hierarchy

```
┌─────────────────────────────────────────────────┐
│  User Memory (u_{hash})                         │
│  Cross-project: preferences, patterns, expertise │
│  Half-life: 30 days (procedural)                │
├─────────────────────────────────────────────────┤
│  Project Memory (p_{hash})                      │
│  Per-codebase: architecture, conventions, errors │
│  Half-life: 7 days (semantic)                   │
├─────────────────────────────────────────────────┤
│  Session Memory (s_{session_id})                │
│  Current conversation: working memory, scratch  │
│  Half-life: 1 hour (working)                    │
└─────────────────────────────────────────────────┘
```

Each scope lives in its own SurrealDB database. Memories promote upward based on importance and access frequency.

### Automatic Memory via Hooks

You don't have to do anything — hooks handle memory automatically:

| When | What Happens |
|------|-------------|
| Session starts | Claude gets briefed on available memory tools and hierarchy |
| You write/edit files | File changes logged to memory |
| A command fails | Error context stored for future debugging |
| Subagents spawn | They get briefed with relevant project memory |
| Subagents finish | Their discoveries are captured |
| Context gets compacted | Critical state saved before compaction |
| Session ends | Learnings consolidated, valuable memories promoted to project scope |

### Commands

| Command | What It Does |
|---------|-------------|
| `/remember <text>` | Store a memory (interactive type/scope selection) |
| `/recall <query>` | Search across all memory scopes |
| `/forget <query>` | Soft-delete a memory |
| `/memory-status` | Show connection, counts, config |
| `/memory-setup` | Interactive configuration wizard |
| `/memory-config` | Quick config view/edit |

### MCP Tools

Claude uses these tools directly (auto-approved, no permission prompts):

| Tool | Purpose |
|------|---------|
| `store_memory` | Create a memory with content, type, scope, tags |
| `recall_memories` | Cross-scope search (session 1.5x, project 1.0x, user 0.7x) |
| `search_knowledge_graph` | Traverse entity relationships |
| `reflect_and_consolidate` | Promote, archive, deduplicate |
| `promote_memory` | Move memory to a higher scope |
| `update_memory` | Update existing memory |
| `tag_memory` | Add tags to a memory |
| `forget_memory` | Soft-delete |
| `get_memory_status` | Connection and count stats |

## Deployment Modes

| Mode | Command | Best For |
|------|---------|----------|
| **Embedded** (default) | `surrealkv://~/.claude/...` | Individual use, zero config |
| **In-Memory** | `mem://` | Testing, CI (snapshots on close) |
| **Local Server** | `ws://localhost:8000` | Shared dev, Surrealist GUI |
| **Remote** | `wss://cloud.surrealdb.com` | Teams, multi-machine |

Configure via `/memory-setup`, `.env` file, or `.claude/surrealdb-memory.local.md`.

## Architecture

Built on the [MemEvolve](https://arxiv.org/abs/2512.18746) EURM framework:

- **Encode** — Stop/PostToolUse/PreCompact hooks transform experience into structured memories
- **Update/Store** — `store_memory` routes to the correct scope database
- **Retrieve** — `recall_memories` searches all scopes with weighted priority
- **Manage** — `reflect_and_consolidate` handles promotion, decay, and archival

Memory strength decays exponentially (working: 1hr, episodic: 1d, semantic: 7d, procedural: 30d), with access-based reinforcement extending the half-life by 20% per recall.

## Documentation

```
docs/
├── research/          22 research docs (SurrealDB 3.0, agentic memory theory)
├── architecture/      6 design docs (overview, memory model, MemEvolve, hooks, KG, deployment)
└── guides/            5 guides (getting started, config, deployment, developing, best practices)
```

Key docs:
- [Architecture Overview](docs/architecture/overview.md)
- [Memory Model](docs/architecture/memory-model.md)
- [MemEvolve Integration](docs/architecture/memevolve-integration.md)
- [Getting Started](docs/guides/getting-started.md)
- [Configuration](docs/guides/configuration.md)
- [Developer Guide](docs/guides/developing.md)

## Contributing

```bash
# Setup
cd mcp && bun install

# Type check
bun run typecheck

# Test with plugin
claude --plugin-dir /path/to/surrealdb-memory
```

See [Developer Guide](docs/guides/developing.md) for how to add tools, hooks, and commands.

## Tech Stack

- **Runtime:** [Bun](https://bun.sh) + TypeScript
- **Database:** [SurrealDB 3.0](https://surrealdb.com) (embedded via `@surrealdb/node`)
- **Protocol:** [MCP](https://modelcontextprotocol.io) (Model Context Protocol)
- **Search:** BM25 full-text + HNSW vector indexes
- **Embeddings:** Phase 2 (local all-MiniLM-L6-v2 via @xenova/transformers)

## License

MIT
