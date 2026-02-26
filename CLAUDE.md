# engram — Claude Code Memory Plugin

Persistent, hierarchical, self-evolving memory for Claude Code powered by SurrealDB.
Single database replaces the typical Postgres+Neo4j+Qdrant+Redis stack.

## Quick Reference

```bash
cd mcp && bun install          # install deps
cd mcp && bun run dev          # run MCP server locally
cd mcp && bun run typecheck    # type check
claude --plugin-dir .          # test plugin in Claude Code
```

## Architecture

@docs/architecture/overview.md
@docs/architecture/memevolve-integration.md

### Plugin Structure

```
engram/
├── .claude-plugin/plugin.json    ← Plugin manifest
├── .mcp.json                     ← MCP server config (embedded SurrealKV default)
├── commands/                     ← /remember, /recall, /forget, /memory-status, /memory-setup, /memory-config
├── skills/                       ← memory-query, memory-admin
├── agents/                       ← memory-consolidator (context: fork, memory: project)
├── hooks/                        ← 10 hook events (Setup through PermissionRequest)
│   ├── hooks.json
│   └── scripts/                  ← config.sh, session-start.sh, pre-compact.sh, post-*.sh, setup.sh, auto-approve-memory.sh
├── docs/                         ← 33 docs (22 research + 6 architecture + 5 guides)
└── mcp/src/                      ← Bun + TypeScript MCP server
    ├── index.ts                  ← Entry point (scope ID generation, graceful shutdown)
    ├── schema.ts                 ← All SurrealQL DDL (6 tables, indexes, events)
    ├── surrealdb-client.ts       ← Connection wrapper, scope isolation, config reader
    ├── tools.ts                  ← 9 MCP tools
    └── resources.ts              ← memory://status resource
```

### Key Decisions

- **Runtime:** Bun + TypeScript
- **Database:** SurrealDB 3.0 embedded via `@surrealdb/node` (SurrealKV backend)
- **Search:** BM25 full-text + HNSW vector indexes (embeddings generation in Phase 2)
- **Config:** `.claude/engram.local.md` YAML frontmatter, overridable by `.env` or env vars
- **No co-author lines, bylines, or attribution in commits.** Ever.

## Memory Model — Hierarchical Scoping

@docs/architecture/memory-model.md

Each scope maps to its own SurrealDB database within namespace `memory`:

| Scope | Database ID | Persists | Retrieval Weight |
|-------|------------|----------|-----------------|
| **Session** | `s_{CLAUDE_SESSION_ID}` | Current conversation | 1.5x (highest) |
| **Project** | `p_{sha256(project_path)[:12]}` | Across sessions | 1.0x |
| **User** | `u_{sha256(HOME)[:12]}` | Across all projects | 0.7x |

Promotion: session → project (importance ≥ 0.5, access ≥ 2) → user (accessed in 3+ sessions).

Four types with different decay half-lives:

| Type | Half-Life | Examples |
|------|-----------|---------|
| working | 1 hour | Task context, scratchpad |
| episodic | 1 day | Bug fixes, error resolutions |
| semantic | 7 days | Architecture decisions, conventions |
| procedural | 30 days | Patterns, how-tos, tool expertise |

## Hook Pipeline (MemEvolve EURM)

@docs/architecture/hooks-and-lifecycle.md

| Hook | EURM | What It Does |
|------|------|-------------|
| Setup | — | Auto-detect environment, create config, init DB |
| SessionStart | **R**etrieve | Inject memory context into system prompt |
| PostToolUse (Write/Edit) | **E**ncode | Log file changes |
| PostToolUse (Bash error) | **E**ncode | Log errors for debugging memory |
| SubagentStart | **R**etrieve | Brief subagents with project memory |
| TaskCompleted | **E**ncode | Capture subagent discoveries |
| PreCompact | **E**ncode | Save critical context before compaction |
| Stop | **E**+**U**+**M** | Store learnings, strengthen accessed, consolidate |
| TeammateIdle | **M**anage | Assign memory maintenance |
| PermissionRequest | — | Auto-approve memory MCP tools |

## MCP Tools

| Tool | Purpose |
|------|---------|
| `store_memory` | Create memory (routes to scope database) |
| `recall_memories` | Cross-scope BM25 search with weighted merge |
| `search_knowledge_graph` | Entity search + graph traversal (1-3 hops) |
| `reflect_and_consolidate` | Promote, archive, deduplicate |
| `promote_memory` | Move memory to higher scope |
| `update_memory` | Update content/tags/importance |
| `tag_memory` | Add tags (additive) |
| `forget_memory` | Soft-delete |
| `get_memory_status` | Per-scope counts and connection info |

## SurrealDB Schema

@docs/architecture/knowledge-graph.md

Schema defined in `mcp/src/schema.ts`:

| Table | Purpose |
|-------|---------|
| `memory` | Main records (BM25 + HNSW indexed) |
| `entity` | Knowledge graph nodes (HNSW indexed) |
| `relates_to` | Graph edges (TYPE RELATION entity→entity) |
| `consolidation_queue` | Pending consolidation work |
| `retrieval_log` | Search tracking for feedback |
| `evolution_state` | System tuning parameters |

## Deployment Modes

@docs/architecture/deployment-modes.md

| Mode | Endpoint | Default |
|------|----------|---------|
| `embedded` | `surrealkv://{data_path}` | Yes |
| `memory` | `mem://` | No (testing) |
| `local` | `ws://localhost:8000` | No |
| `remote` | `wss://...` | No |

Config resolution: `env vars` > `.claude/engram.local.md` > `.mcp.json env` > defaults.

## Implementation Status

@docs/guides/developing.md

### Done
- Plugin scaffold, MCP server, 9 tools, 10 hooks, 6 commands, 2 skills, 1 agent
- Hierarchical scope isolation (3 SurrealDB databases per session)
- MemEvolve EURM pipeline across all hooks
- Exponential decay with type-specific half-lives and access strengthening
- Knowledge graph schema (entity + relates_to)
- Multi-deployment mode support (embedded, memory, local, remote)
- Auto-config Setup hook + interactive /memory-setup wizard
- PermissionRequest auto-approval for all memory tools

### Remaining
- [ ] Local embedding generation (@xenova/transformers, all-MiniLM-L6-v2)
- [ ] Hybrid search (BM25 + HNSW via search::rrf)
- [ ] Full consolidation pipeline (episodic → semantic summarization)
- [ ] Retrieval feedback tracking and strategy adaptation
- [ ] Docker mode with auto-management
- [ ] Data migration between modes
- [ ] Fallback write queue during outages
- [ ] End-to-end integration testing

## Conventions

- TypeScript strict mode, ESNext target, Bun runtime
- MCP tools return `{ content: [{ type: "text", text: ... }] }`, errors set `isError: true`
- Hook scripts source `config.sh`, use `set -uo pipefail`, exit 0 on non-critical failures
- Schema DDL lives in `mcp/src/schema.ts`, not inline in client code
- Commands/skills are markdown with YAML frontmatter, skills use third-person descriptions
- **No co-author lines, bylines, or attribution in commits.** Just the message.

## Documentation

```
docs/
├── research/       22 docs — SurrealDB 3.0, agentic memory, MemEvolve, Graphiti, LightRAG
├── architecture/   6 docs — overview, memory model, MemEvolve, hooks, knowledge graph, deployment
└── guides/         5 docs — getting started, configuration, deployment, developing, best practices
```

For deep dives, read the @-imported docs above or browse `docs/` directly.
