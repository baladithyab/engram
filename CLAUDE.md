# engram — Claude Code Memory Plugin

Persistent, hierarchical, self-evolving memory for Claude Code powered by SurrealDB.
Single database replaces the typical Postgres+Neo4j+Qdrant+Redis stack.

## Quick Reference

```bash
cd mcp && bun install          # install deps
cd mcp && bun run dev          # run MCP server locally
cd mcp && bun run typecheck    # type check
claude --plugin-dir .          # test plugin in Claude Code
rr push                        # push via Road Runner (bypasses Code Defender)
```

## Architecture

@docs/architecture/overview.md
@docs/architecture/memevolve-integration.md

### Plugin Structure

```
engram/
├── .claude-plugin/plugin.json    ← Plugin manifest
├── .mcp.json                     ← MCP server config (embedded SurrealKV default)
├── .rr.yaml                      ← Road Runner remote sync/push config
├── commands/                     ← /remember, /recall, /forget, /memory-status, /memory-setup, /memory-config
├── skills/                       ← memory-query, memory-admin, surrealql, surrealql-reference
├── agents/                       ← memory-consolidator (context: fork, memory: project)
├── hooks/                        ← 10 hook events (Setup through PermissionRequest)
│   ├── hooks.json
│   └── scripts/                  ← config.sh, session-start.sh, pre-compact.sh, post-*.sh, setup.sh, auto-approve-memory.sh
├── docs/                         ← 35 docs (22 research + 6 architecture + 5 guides + 2 plans)
└── mcp/src/                      ← Bun + TypeScript MCP server (17 files)
    ├── index.ts                  ← Entry point (all 6 tool modules registered, embedder init)
    ├── schema.ts                 ← All SurrealQL DDL (6 tables, indexes, events, evolution seeds)
    ├── surrealdb-client.ts       ← Connection wrapper, scope isolation, config reader, hybrid search
    ├── tools.ts                  ← 9 core MCP tools
    ├── tools-codemode.ts         ← engram_explore, engram_execute (Code Mode)
    ├── tools-skills.ts           ← recall_skill, mark_retrieval_useful (Skills-as-Memories)
    ├── tools-recursive.ts        ← memory_peek, memory_partition, memory_aggregate (Recursive)
    ├── tools-evolution.ts        ← evolve_memory_system (MemEvolve)
    ├── resources.ts              ← memory://status resource
    ├── embeddings/
    │   ├── provider.ts           ← EmbeddingProvider interface
    │   ├── local.ts              ← @xenova/transformers (all-MiniLM-L6-v2, 384-dim)
    │   ├── api.ts                ← OpenAI-compatible REST provider
    │   └── index.ts              ← Factory (local default, API opt-in)
    ├── security/
    │   └── surql-validator.ts    ← SurrealQL AST allowlist/blocklist for Code Mode
    ├── aggregation/
    │   └── rrf.ts                ← Reciprocal Rank Fusion for multi-source merging
    └── evolution/
        ├── analyze.ts            ← Strategy/scope effectiveness analysis
        └── propose.ts            ← Bounded parameter update proposals
```

### Key Decisions

- **Runtime:** Bun + TypeScript
- **Database:** SurrealDB 3.0 embedded via `@surrealdb/node` (SurrealKV backend)
- **Search:** Hybrid BM25 full-text + HNSW vector (384-dim, all-MiniLM-L6-v2 local, API opt-in)
- **Config:** `.claude/engram.local.md` YAML frontmatter, overridable by `.env` or env vars
- **Embeddings:** Local by default (@xenova/transformers), API opt-in (OpenAI-compatible)
- **Safety:** SurrealQL AST validator blocks DDL in Code Mode, write-gating via allow_writes
- **Evolution:** Retrieval weights and scope weights read from evolution_state at query time
- **No co-author lines, bylines, or attribution in commits.** Ever.

## Memory Model — Hierarchical Scoping

@docs/architecture/memory-model.md

Each scope maps to its own SurrealDB database within namespace `memory`:

| Scope | Database ID | Persists | Retrieval Weight |
|-------|------------|----------|-----------------|
| **Session** | `s_{CLAUDE_SESSION_ID}` | Current conversation | 1.5x (evolvable) |
| **Project** | `p_{sha256(project_path)[:12]}` | Across sessions | 1.0x (evolvable) |
| **User** | `u_{sha256(HOME)[:12]}` | Across all projects | 0.7x (evolvable) |

Scope weights are read from `evolution_state` at query time. The MemEvolve feedback
loop adjusts them based on retrieval effectiveness data in `retrieval_log`.

Promotion: session → project (importance ≥ 0.5, access ≥ 2) → user (accessed in 3+ sessions).

Four types with different decay half-lives:

| Type | Half-Life | Examples |
|------|-----------|---------|
| working | 1 hour | Task context, scratchpad |
| episodic | 1 day | Bug fixes, error resolutions |
| semantic | 7 days | Architecture decisions, conventions |
| procedural | 30 days | Patterns, how-tos, SurrealQL skills |

## Hook Pipeline (MemEvolve EURM)

@docs/architecture/hooks-and-lifecycle.md

| Hook | EURM | What It Does |
|------|------|-------------|
| Setup | — | Auto-detect environment, create config, init DB |
| SessionStart | **R**etrieve | Inject memory context + recall instruction into system prompt |
| PostToolUse (Write/Edit) | **E**ncode | Log file changes (Stop hook does batch storage) |
| PostToolUse (Bash error) | **E**ncode | Log errors (Stop hook does batch storage) |
| SubagentStart | **R**etrieve | Brief subagents with project memory |
| TaskCompleted | **E**ncode | Capture subagent discoveries |
| PreCompact | **E**ncode | Save critical context before compaction |
| Stop | **E**+**U**+**M** | Store learnings, strengthen accessed, consolidate |
| TeammateIdle | **M**anage | Assign memory maintenance |
| PermissionRequest | — | Auto-approve all 18 memory MCP tools |

## MCP Tools (18 total)

### Core Tools (9)

| Tool | Purpose |
|------|---------|
| `store_memory` | Create memory with auto-embedding generation |
| `recall_memories` | Hybrid BM25+HNSW cross-scope search with evolved weights |
| `search_knowledge_graph` | Entity search + graph traversal (1-3 hops) |
| `reflect_and_consolidate` | Promote, archive stale memories, deduplicate |
| `promote_memory` | Move memory to higher scope |
| `update_memory` | Update content/tags/importance |
| `tag_memory` | Add tags (additive) |
| `forget_memory` | Soft-delete |
| `get_memory_status` | Per-scope counts and connection info |

### Code Mode Tools (4) — Phase 3

| Tool | Purpose |
|------|---------|
| `engram_explore` | Progressive manifest discovery (depth 0-3: counts → stats → schema → samples) |
| `engram_execute` | Arbitrary SurrealQL with AST validation (read-only default, write opt-in) |
| `recall_skill` | Find and execute stored #surql-skill procedural memories |
| `mark_retrieval_useful` | Explicit feedback signal for evolution loop |

### Recursive Tools (3) — Phase 4

| Tool | Purpose |
|------|---------|
| `memory_peek` | Statistical sampling (type/status counts, tag frequency, date range, samples) |
| `memory_partition` | Split by tag/date/type/scope/importance_band (descriptors, not full records) |
| `memory_aggregate` | Reciprocal Rank Fusion across partition query results |

### Evolution Tools (1) — Phase 5

| Tool | Purpose |
|------|---------|
| `evolve_memory_system` | Analyze retrieval_log, propose bounded updates to scope weights/decay/strategy |

### Retrieval Ranking

Recall uses a composite score with evolved weights (default if no evolution data):
- **Hybrid mode** (embedding available): `BM25 * 0.3 + vector_similarity * 0.3 + memory_strength * 0.4`
- **BM25-only mode** (no embedding): `BM25 * 0.6 + memory_strength * 0.4`

Weights are read from `evolution_state.retrieval_weights` at query time.
Scope weights are read from `evolution_state.scope_weights`.

## SurrealDB Schema

@docs/architecture/knowledge-graph.md

Schema defined in `mcp/src/schema.ts`:

| Table | Purpose |
|-------|---------|
| `memory` | Main records (BM25 + HNSW indexed, computed memory_strength) |
| `entity` | Knowledge graph nodes (HNSW indexed) |
| `relates_to` | Graph edges (TYPE RELATION entity→entity) |
| `consolidation_queue` | Pending consolidation work |
| `retrieval_log` | Search tracking for feedback + evolution |
| `evolution_state` | System tuning parameters (seeded on init) |

## Embedding Pipeline

| Provider | Model | Dimensions | Config |
|----------|-------|-----------|--------|
| **Local** (default) | `Xenova/all-MiniLM-L6-v2` | 384 | No config needed |
| **API** (opt-in) | Any OpenAI-compatible | 384 (configurable) | `embedding_provider: api` in engram.local.md |

Config keys for API provider: `embedding_provider`, `embedding_url`, `embedding_model`,
`embedding_api_key`, `embedding_dimensions`.

## Deployment Modes

@docs/architecture/deployment-modes.md

| Mode | Endpoint | Default |
|------|----------|---------|
| `embedded` | `surrealkv://{data_path}` | Yes |
| `memory` | `mem://` | No (testing) |
| `local` | `ws://localhost:8000` | No |
| `remote` | `wss://...` | No |

Config resolution: `env vars` > `.claude/engram.local.md` > `.mcp.json env` > defaults.

Legacy data path fallback: if `~/.claude/engram/data` doesn't exist but
`~/.claude/surrealdb-memory/data` does, the legacy path is used automatically.

## Implementation Status

@docs/guides/developing.md

### Done
- Plugin scaffold, MCP server, 18 tools, 10 hooks, 6 commands, 4 skills, 1 agent
- Hierarchical scope isolation (3 SurrealDB databases per session)
- MemEvolve EURM pipeline across all hooks
- Exponential decay with type-specific half-lives and access strengthening
- Knowledge graph schema (entity + relates_to)
- Multi-deployment mode support (embedded, memory, local, remote)
- Auto-config Setup hook + interactive /memory-setup wizard
- PermissionRequest auto-approval for all 18 memory tools
- Embedding pipeline (local @xenova/transformers + API provider)
- Hybrid BM25+HNSW search with evolved weights
- Code Mode interface (engram_explore, engram_execute with AST validator)
- Skills-as-Memories (recall_skill, mark_retrieval_useful)
- Recursive memory processing (peek, partition, aggregate with RRF)
- MemEvolve meta-evolution (evolve_memory_system with bounded proposals)
- Retrieval logging to retrieval_log for evolution feedback
- Consolidation archives stale memories and promotes worthy ones
- Evolution_state seeded with defaults on init
- SurrealQL reference skills (concise + comprehensive 683-line version)
- Legacy data path migration fallback

### Remaining
- [ ] Full consolidation pipeline (episodic → semantic summarization via LLM)
- [ ] Entity extraction pipeline (auto-populate knowledge graph from conversations)
- [ ] Docker mode with auto-management
- [ ] Data migration between deployment modes
- [ ] Fallback write queue during outages
- [ ] End-to-end integration testing
- [ ] Retrieval weight evolution for hybrid search tuning

## Conventions

- TypeScript strict mode, ESNext target, Bun runtime
- MCP tools return `{ content: [{ type: "text", text: ... }] }`, errors set `isError: true`
- Hook scripts source `config.sh`, use `set -uo pipefail`, exit 0 on non-critical failures
- Schema DDL lives in `mcp/src/schema.ts`, not inline in client code
- Commands/skills are markdown with YAML frontmatter, skills use third-person descriptions
- SurrealQL uses `UPSERT ... WHERE` for idempotent inserts (NOT `ON DUPLICATE KEY UPDATE`)
- SCHEMAFULL tables reject undeclared fields — always verify fields exist in schema.ts
- **No co-author lines, bylines, or attribution in commits.** Just the message.

## Documentation

```
docs/
├── research/       22 docs — SurrealDB 3.0, agentic memory, MemEvolve, Graphiti, LightRAG
├── architecture/   6 docs — overview, memory model, MemEvolve, hooks, knowledge graph, deployment
├── guides/         5 docs — getting started, configuration, deployment, developing, best practices
└── plans/          2 docs — engram evolution design + implementation plan
```

For deep dives, read the @-imported docs above or browse `docs/` directly.
