# surrealdb-memory — Claude Code Memory Plugin

A Claude Code plugin that provides persistent, hierarchical, self-evolving memory
powered by SurrealDB. Single database replaces the typical Postgres+Neo4j+Qdrant+Redis
stack used by other memory systems.

## Architecture

### Plugin Structure

```
surrealdb-memory/
├── .claude-plugin/plugin.json    ← Plugin manifest
├── .mcp.json                     ← MCP server config
├── commands/                     ← Slash commands (/remember, /recall, /forget, /memory-status, /memory-setup)
├── skills/                       ← Skills (memory-query, memory-admin)
├── agents/                       ← Agents (memory-consolidator)
├── hooks/                        ← Hooks (Setup, SessionStart, Stop, PreCompact, PostToolUse, SubagentStart, TaskCompleted, TeammateIdle, PermissionRequest)
│   ├── hooks.json
│   └── scripts/
│       ├── config.sh             ← Shared env config for hook scripts
│       ├── session-start.sh      ← Load project memories on session start
│       ├── pre-compact.sh        ← Preserve context before compaction
│       ├── post-file-change.sh   ← Log file changes (Write/Edit)
│       └── post-bash-error.sh    ← Log bash errors for memory
├── docs/                         ← Documentation (32 docs total)
│   ├── research/                 ← 22 research docs (SurrealDB features, memory theory, plugin design)
│   ├── architecture/             ← 5 design docs (overview, memory model, knowledge graph, hooks, deployment)
│   └── guides/                   ← 5 user guides (getting started, configuration, deployment, dev, best practices)
└── mcp/                          ← MCP server (Bun + TypeScript)
    ├── package.json
    ├── tsconfig.json
    └── src/
        ├── index.ts              ← Server entry point
        ├── schema.ts             ← SurrealQL schema definitions (all tables, indexes, events)
        ├── surrealdb-client.ts   ← SurrealDB connection wrapper + config reader
        ├── tools.ts              ← MCP tool definitions
        └── resources.ts          ← MCP resource definitions
```

### Key Design Decisions

- **Runtime:** Bun + TypeScript for the MCP server
- **Database:** SurrealDB 3.0 via `surrealdb` npm package
- **Default mode:** Embedded SurrealKV (`surrealkv://` path) — zero config, persistent
- **Schema:** All SurrealQL DDL lives in `mcp/src/schema.ts` as exported constants
- **Search:** BM25 full-text search + HNSW vector indexes defined (embeddings deferred)
- **Embeddings:** Phase 2 (local all-MiniLM-L6-v2 via @xenova/transformers)
- **Config:** Per-project overrides via `.claude/surrealdb-memory.local.md` YAML frontmatter

### Deployment Modes

| Mode | Endpoint | Persistence | Use Case |
|------|----------|-------------|----------|
| `embedded` | `surrealkv://{data_path}` | Persistent file-based | Default, single machine |
| `memory` | `mem://` | Ephemeral (snapshot on close) | Testing, CI |
| `local` | `ws://localhost:8000` | Server-managed | Shared dev, RocksDB backend |
| `remote` | `wss://...` | Cloud-managed | Team use, production |

Mode is set via `SURREAL_MODE` env var, `.mcp.json`, or `.claude/surrealdb-memory.local.md`.
Use `/memory-setup` to configure interactively.

### Memory Model

Three scopes with promotion:
- **Session** — ephemeral, dies when conversation ends unless promoted
- **Project** — persists across sessions for this codebase
- **User** — persists across all projects

Four types:
- **Episodic** — events, conversations, experiences
- **Semantic** — facts, knowledge, concepts
- **Procedural** — skills, patterns, how-tos
- **Working** — temporary task context

### Memory Lifecycle

Memories follow a state machine: `active` -> `consolidated` -> `archived` -> `forgotten`

- **Active** — default state, searchable, decays over time
- **Consolidated** — merged or summarized from multiple memories
- **Archived** — low-importance or stale, excluded from default search
- **Forgotten** — soft-deleted, retained for audit but not searchable

Strength decays exponentially based on type (working decays fastest, procedural slowest).
Access-based reinforcement: each recall bumps importance by 0.02 (capped at 1.0).
The `reflect_and_consolidate` tool automates promotion, decay queuing, and duplicate detection.

### MCP Tools

| Tool | Purpose |
|------|---------|
| `store_memory` | Create a memory with content, type, scope, tags, importance |
| `recall_memories` | BM25 full-text search across memories |
| `forget_memory` | Soft-delete (archive) a memory |
| `get_memory_status` | Connection status and memory counts |
| `promote_memory` | Move memory to higher scope |
| `update_memory` | Update content, tags, importance, or metadata |
| `tag_memory` | Add tags to a memory (additive, no replacement) |
| `search_knowledge_graph` | Entity search + relationship traversal (1-3 hops) |
| `reflect_and_consolidate` | Consolidation pipeline: promote, decay, deduplicate |

## Plugin Feature Coverage

### Hook Events Used
| Event | Type | Purpose |
|-------|------|---------|
| Setup | command | Initialize memory database and default config on first run |
| SessionStart | command | Load project/user memories into context |
| Stop | prompt | Consolidate session learnings, promote memories |
| PreCompact | command | Save context before compaction |
| PostToolUse (Write/Edit) | command | Log file changes to memory |
| PostToolUse (Bash error) | command | Log errors for debugging memory |
| SubagentStart | prompt | Brief subagents with relevant memory context |
| TaskCompleted | prompt | Capture subagent discoveries into memory |
| TeammateIdle | prompt | Assign memory maintenance to idle agents |
| PermissionRequest | command | Auto-approve memory MCP tool permissions |

### Agent Features Used
| Feature | Value | Purpose |
|---------|-------|---------|
| memory | project | Persistent project-scoped memory for consolidator |
| hooks | Stop | Agent-scoped cleanup hook |
| context | fork | Isolated execution context |
| tools | restricted | Least-privilege tool access |

### Command Features Used
| Feature | Purpose |
|---------|---------|
| allowed-tools | Restrict each command to relevant MCP tools only |
| argument-hint | Show argument hints in command palette |

### Skill Features Used
| Feature | Purpose |
|---------|---------|
| Third-person descriptions | Maximize semantic trigger matching |
| Specific trigger phrases | Surface skills on exact user queries |
| Progressive disclosure | Metadata always loaded, body on trigger, references on demand |
| version field | Track skill evolution |

### SurrealDB Schema

Schema is defined in `mcp/src/schema.ts` and executed by `surrealdb-client.ts` `initSchema()`:

| Table | Type | Purpose |
|-------|------|---------|
| `memory` | SCHEMAFULL | Main memory records (BM25 + HNSW indexed) |
| `entity` | SCHEMAFULL | Knowledge graph nodes (HNSW indexed) |
| `relates_to` | RELATION | Knowledge graph edges (entity -> entity) |
| `consolidation_queue` | SCHEMAFULL | Pending consolidation work items |
| `retrieval_log` | SCHEMAFULL | Search access tracking for feedback |
| `evolution_state` | SCHEMAFULL | System-wide tuning parameters |
| `memory_analyzer` | ANALYZER | BM25 tokenizer (blank + class, snowball English) |

Events: `memory_lifecycle` logs status transitions to retrieval_log; `memory_decay_check` auto-queues stale memories for consolidation.
Computed field: `memory_strength` — exponential decay weighted by memory_type (procedural slowest, working fastest).

## Development

### Prerequisites

- Bun 1.3+ (`brew install bun` or `curl -fsSL https://bun.sh/install | bash`)
- SurrealDB is NOT needed separately — embedded mode bundles it

### Setup

```bash
cd mcp && bun install
```

### Run MCP server locally (for testing)

```bash
cd mcp && bun run dev
```

### Test the plugin in Claude Code

```bash
claude --plugin-dir /Users/baladita/Documents/DevBox/surrealdb-memory
```

### Type checking

```bash
cd mcp && bun run typecheck
```

## Implementation Phases

### Phase 1: MVP
- [x] Plugin scaffold (manifest, directories)
- [x] MCP server skeleton (Bun + TS)
- [x] SurrealDB client with embedded SurrealKV
- [x] Core tools: store_memory, recall_memories, forget_memory, get_memory_status, promote_memory
- [x] BM25 full-text search on memory content
- [x] Commands: /remember, /recall, /forget, /memory-status
- [x] Stop hook for session-end consolidation
- [ ] Install dependencies and verify MCP server starts
- [ ] Test end-to-end: store -> recall -> forget cycle
- [ ] Verify plugin loads in Claude Code

### Phase 2: Knowledge Graph + Extended Tools
- [x] Schema extracted to `mcp/src/schema.ts` with all table definitions
- [x] HNSW vector indexes defined on memory and entity tables
- [x] Entity and relationship tables (entity + relates_to)
- [x] search_knowledge_graph MCP tool
- [x] update_memory and tag_memory MCP tools
- [x] reflect_and_consolidate MCP tool
- [x] Consolidation queue, retrieval log, evolution state tables
- [x] Memory lifecycle events (decay check)
- [x] Per-project config via `.claude/surrealdb-memory.local.md`
- [x] Memory mode (`mem://`) for testing
- [x] PostToolUse hooks (file changes, bash errors)
- [x] /memory-setup wizard command
- [x] memory-admin skill
- [x] SubagentStart hook for memory briefing
- [ ] Local embedding generation (@xenova/transformers, all-MiniLM-L6-v2)
- [ ] Hybrid search (BM25 + HNSW via search::rrf)
- [ ] SessionStart hook: load project memories into context

### Phase 3: Self-Evolution
- [x] Memory lifecycle state machine (active -> consolidated -> archived -> forgotten)
- [x] Computed memory_strength with exponential decay
- [x] Access-based reinforcement (importance bump on recall)
- [x] TeammateIdle hook for maintenance
- [x] TaskCompleted hook for capture
- [ ] Full consolidation pipeline (episodic -> semantic summarization)
- [ ] Retrieval feedback tracking and strategy adaptation
- [ ] memory-consolidator agent (full implementation)

### Phase 4: Multi-Deployment + Polish
- [x] Memory mode (`mem://`)
- [x] Per-project config file support
- [x] /memory-setup wizard command
- [ ] Docker mode with auto-management
- [ ] Data migration between modes
- [ ] Fallback strategy (write queue during outages)

## Architecture Research

### In-Repo Documentation (docs/)

```
docs/
├── research/          ← 22 research docs (SurrealDB, memory theory, plugin design)
├── architecture/      ← 5 design docs (overview, memory-model, knowledge-graph, hooks, deployment)
└── guides/            ← 5 user guides (getting-started, configuration, deployment-modes, developing, best-practices)
```

### Obsidian Vault (external reference)

```
ADMINISTRIVIA/Research Rabbitholes/
├── SurrealDB 3.0/                    <- 10 docs on SurrealDB features
├── SurrealDB Agentic Memory/         <- 10 docs on memory theory + SurrealDB mapping
└── SurrealDB Memory Plugin/          <- 9 docs on plugin architecture
```

Key architecture docs:
- **Plugin Structure and Components** — full component design
- **Hierarchical Memory Model Design** — session/project/user scopes
- **Hooks System for Automatic Memory** — all hook event types
- **MCP Server Design** — tool schemas and server architecture
- **Self-Evolving Memory Design** — lifecycle, decay, consolidation
- **Multi-Deployment Architecture** — deployment modes and setup wizard

## Conventions

- TypeScript strict mode, ESNext target
- Bun as runtime and package manager
- All MCP tools return `{ content: [{ type: "text", text: ... }] }` format
- Errors return `isError: true` with descriptive message
- Hook scripts source `config.sh` for shared env, use `set -uo pipefail`, exit 0 on non-critical failures
- Commands are markdown files with YAML frontmatter
- Skills follow progressive disclosure (SKILL.md lean, details in references/)
- Schema DDL lives in `mcp/src/schema.ts`, not inline in client code

## Git

- **No co-author lines, bylines, or attribution in commits.** Never add `Co-Authored-By`,
  `Signed-off-by`, or any other trailer/attribution to commit messages. Just the commit
  message itself, nothing else.
