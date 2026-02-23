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
├── commands/                     ← Slash commands (/remember, /recall, /forget, /memory-status)
├── skills/                       ← Skills (memory-query)
├── agents/                       ← Agents (memory-consolidator)
├── hooks/                        ← Hooks (SessionStart, Stop, PreCompact)
│   ├── hooks.json
│   └── scripts/
└── mcp/                          ← MCP server (Bun + TypeScript)
    ├── package.json
    ├── tsconfig.json
    └── src/
        ├── index.ts              ← Server entry point
        ├── surrealdb-client.ts   ← SurrealDB connection wrapper
        ├── tools.ts              ← MCP tool definitions
        └── resources.ts          ← MCP resource definitions
```

### Key Design Decisions

- **Runtime:** Bun + TypeScript for the MCP server
- **Database:** SurrealDB 3.0 via `surrealdb` npm package
- **Default mode:** Embedded SurrealKV (`surrealkv://` path) — zero config, persistent
- **Search:** BM25 full-text search (MVP), HNSW vector search (Phase 2)
- **Embeddings:** Deferred to Phase 2 (local all-MiniLM-L6-v2 via @xenova/transformers)

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

### MCP Tools

| Tool | Purpose |
|------|---------|
| `store_memory` | Create a memory with content, type, scope, tags, importance |
| `recall_memories` | BM25 full-text search across memories |
| `forget_memory` | Soft-delete (archive) a memory |
| `get_memory_status` | Connection status and memory counts |
| `promote_memory` | Move memory to higher scope |

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

### Phase 1: MVP (Current)
- [x] Plugin scaffold (manifest, directories)
- [x] MCP server skeleton (Bun + TS)
- [x] SurrealDB client with embedded SurrealKV
- [x] Core tools: store_memory, recall_memories, forget_memory, get_memory_status, promote_memory
- [x] BM25 full-text search on memory content
- [x] Commands: /remember, /recall, /forget, /memory-status
- [x] Stop hook for session-end consolidation
- [ ] Install dependencies and verify MCP server starts
- [ ] Test end-to-end: store → recall → forget cycle
- [ ] Verify plugin loads in Claude Code

### Phase 2: Vector Search + Knowledge Graph
- [ ] Add HNSW vector index on memory embeddings
- [ ] Local embedding generation (@xenova/transformers, all-MiniLM-L6-v2)
- [ ] Hybrid search (BM25 + HNSW via search::rrf)
- [ ] Entity extraction and knowledge graph (entity + relates_to tables)
- [ ] search_knowledge_graph MCP tool
- [ ] SessionStart hook: load project memories into context

### Phase 3: Self-Evolution
- [ ] Memory lifecycle state machine (active → consolidated → archived → forgotten)
- [ ] Exponential decay with access-based strengthening
- [ ] Consolidation pipeline (episodic → semantic summarization)
- [ ] Retrieval feedback tracking and strategy adaptation
- [ ] memory-consolidator agent (full implementation)

### Phase 4: Multi-Deployment + Polish
- [ ] Local server mode (surreal start rocksdb://)
- [ ] Docker mode with auto-management
- [ ] Remote/cloud connection
- [ ] /memory-setup wizard command
- [ ] Data migration between modes
- [ ] Fallback strategy (write queue during outages)

## Architecture Research

Extensive architecture documentation is in the Obsidian vault:

```
ADMINISTRIVIA/Research Rabbitholes/
├── SurrealDB 3.0/                    ← 10 docs on SurrealDB features
├── SurrealDB Agentic Memory/         ← 10 docs on memory theory + SurrealDB mapping
└── SurrealDB Memory Plugin/          ← 9 docs on plugin architecture
```

Key architecture docs:
- **Plugin Structure and Components** — full component design
- **Hierarchical Memory Model Design** — session/project/user scopes
- **Hooks System for Automatic Memory** — all hook event types
- **MCP Server Design** — tool schemas and server architecture
- **Self-Evolving Memory Design** — lifecycle, decay, consolidation
- **Multi-Deployment Architecture** — deployment modes and setup wizard

## SurrealDB Schema

The core schema is defined in `mcp/src/surrealdb-client.ts` `initSchema()`:

- `memory` — main memory table (SCHEMAFULL, BM25 indexed)
- `entity` — knowledge graph nodes
- `relates_to` — knowledge graph edges (TYPE RELATION)
- `memory_analyzer` — BM25 tokenizer for full-text search

## Conventions

- TypeScript strict mode, ESNext target
- Bun as runtime and package manager
- All MCP tools return `{ content: [{ type: "text", text: ... }] }` format
- Errors return `isError: true` with descriptive message
- Hook scripts use `set -uo pipefail` and exit 0 on non-critical failures
- Commands are markdown files with YAML frontmatter
- Skills follow progressive disclosure (SKILL.md lean, details in references/)

## Git

- **No co-author lines, bylines, or attribution in commits.** Never add `Co-Authored-By`,
  `Signed-off-by`, or any other trailer/attribution to commit messages. Just the commit
  message itself, nothing else.
