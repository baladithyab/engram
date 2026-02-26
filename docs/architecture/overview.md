# Architecture Overview

> **Status:** Living document
> **Date:** 2026-02-23
> **See also:** [Memory Model](memory-model.md) | [Deployment Modes](deployment-modes.md) | [Hooks and Lifecycle](hooks-and-lifecycle.md) | [Knowledge Graph](knowledge-graph.md)

---

## What This Plugin Does

`engram` is a Claude Code plugin that gives Claude persistent, hierarchical,
self-evolving memory powered by SurrealDB. Instead of starting every conversation from
scratch, Claude retains knowledge across sessions -- codebase architecture, past decisions,
error patterns, coding conventions, and personal preferences.

The key insight: a single SurrealDB instance replaces the multi-database stack
(Postgres + Neo4j + Qdrant + Redis) that other agentic memory systems require.
SurrealDB natively combines document storage, graph relations, vector search (HNSW),
full-text search (BM25), computed fields, events, and real-time subscriptions in one
engine.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Claude Code                                │
│                                                                     │
│  ┌───────────┐  ┌───────────┐  ┌──────────┐  ┌──────────────────┐ │
│  │ /remember │  │  /recall   │  │ /forget  │  │ /memory-status   │ │
│  │ /commands │  │            │  │          │  │                  │ │
│  └─────┬─────┘  └─────┬─────┘  └────┬─────┘  └────────┬─────────┘ │
│        │              │              │                  │           │
│  ┌─────┴──────────────┴──────────────┴──────────────────┴─────┐    │
│  │                    Skills + Agents                          │    │
│  │  memory-query skill  │  memory-consolidator agent          │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                      Hooks Layer                            │    │
│  │  SessionStart │ Stop │ PreCompact │ PostToolUse             │    │
│  └───────┬─────────────┬──────────────┬────────────────────────┘    │
│          │             │              │                              │
└──────────┼─────────────┼──────────────┼─────────────────────────────┘
           │             │              │
           ▼             ▼              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    MCP Server (Bun + TypeScript)                     │
│                    Transport: stdio                                  │
│                                                                     │
│  ┌─────────────────────────┐    ┌────────────────────────────────┐ │
│  │       MCP Tools         │    │       MCP Resources            │ │
│  │  store_memory           │    │  memory://status               │ │
│  │  recall_memories        │    │                                │ │
│  │  forget_memory          │    │                                │ │
│  │  promote_memory         │    │                                │ │
│  │  get_memory_status      │    │                                │ │
│  └───────────┬─────────────┘    └────────────────────────────────┘ │
│              │                                                      │
│  ┌───────────▼─────────────────────────────────────────────────┐   │
│  │              SurrealDB Client (surrealdb npm)               │   │
│  │  connect() → initSchema() → query() → storeMemory() → ... │   │
│  └───────────┬──────────────────┬──────────────────┬───────────┘   │
│              │                  │                   │               │
└──────────────┼──────────────────┼───────────────────┼───────────────┘
               │                  │                   │
    ┌──────────▼───┐   ┌─────────▼────┐   ┌──────────▼──────┐
    │  Embedded    │   │  Local        │   │  Remote          │
    │  SurrealKV   │   │  Server       │   │  SurrealDB Cloud │
    │  (default)   │   │  (ws://)      │   │  (wss://)        │
    │              │   │              │   │                   │
    │  ~/.claude/  │   │  rocksdb://  │   │  Namespace        │
    │  surrealdb-  │   │  or          │   │  isolation for    │
    │  memory/data │   │  surrealkv://│   │  team sharing     │
    └──────────────┘   └──────────────┘   └──────────────────┘
```

---

## Key Design Principles

### 1. Single database replaces multi-DB stack

Other agentic memory systems (Mem0, MemGPT/Letta, Zep/Graphiti) require separate
databases for documents, vectors, graphs, and caching. SurrealDB provides all of these
natively:

| Capability | Traditional Stack | SurrealDB |
|-----------|------------------|-----------|
| Document storage | PostgreSQL | `SCHEMAFULL` / `SCHEMALESS` tables |
| Vector search | Qdrant / pgvector | `DEFINE INDEX ... HNSW` |
| Full-text search | Elasticsearch | `DEFINE ANALYZER` + `BM25` |
| Graph relations | Neo4j | `RELATE` + `TYPE RELATION` tables |
| Computed scores | Application code | `COMPUTED` fields |
| Event triggers | Application code | `DEFINE EVENT` |
| Real-time updates | Redis pub/sub | `LIVE SELECT` |

### 2. Zero-config default

The plugin ships with embedded SurrealKV as the default backend. No external database
to install, no Docker, no configuration. Data persists at `~/.claude/engram/data`.
Advanced users can switch to local server, Docker, or remote deployments via
configuration. See [Deployment Modes](deployment-modes.md).

### 3. Automatic memory via hooks

The user never needs to explicitly say "remember this." Hook events fire at key lifecycle
moments -- session start, session end, context compaction, tool use -- to automatically
capture, retrieve, and consolidate memories. Explicit commands (`/remember`, `/recall`,
`/forget`) exist for manual control but are not required. See [Hooks and Lifecycle](hooks-and-lifecycle.md).

### 4. Hierarchical scopes with promotion

Memories exist at three levels: **session** (ephemeral), **project** (persists across
sessions for one codebase), and **user** (persists across all projects). Memories start
at session scope and get promoted upward based on importance and access patterns. This
prevents unbounded growth while preserving valuable knowledge. See [Memory Model](memory-model.md).

### 5. Inspired by cognitive science and recent research

The memory model draws from:
- **MemEvolve EURM framework** -- Encode, Update/Store, Retrieve, Manage decomposition
  (see [docs/research/memevolve-paper-analysis.md](../research/memevolve-paper-analysis.md))
- **Graphiti** -- temporal knowledge graph with entity deduplication and edge invalidation
  (see [docs/research/graphiti-surrealdb-mapping.md](../research/graphiti-surrealdb-mapping.md))
- **LightRAG** -- dual-level retrieval combining entity-specific and thematic search
  (see [docs/research/lightrag-surrealdb-mapping.md](../research/lightrag-surrealdb-mapping.md))

---

## Component Map

### Commands (user-facing slash commands)

| Command | File | Purpose |
|---------|------|---------|
| `/remember` | `commands/remember.md` | Manually store a memory |
| `/recall` | `commands/recall.md` | Search and retrieve memories |
| `/forget` | `commands/forget.md` | Soft-delete a memory |
| `/memory-status` | `commands/memory-status.md` | Show connection status and counts |

### Skills (context for Claude)

| Skill | File | Purpose |
|-------|------|---------|
| `memory-query` | `skills/memory-query/SKILL.md` | Patterns for querying memories effectively |

### Agents (autonomous sub-agents)

| Agent | File | Purpose |
|-------|------|---------|
| `memory-consolidator` | `agents/memory-consolidator.md` | Review, merge, promote, and prune memories |

### Hooks (automatic lifecycle events)

| Hook Event | Type | Purpose |
|------------|------|---------|
| `SessionStart` | command | Load project + user memories into context |
| `Stop` | prompt | Consolidate session learnings before exit |
| `PreCompact` | command | Save context before compaction discards it |

### MCP Server

| File | Purpose |
|------|---------|
| `mcp/src/index.ts` | Server entry point, connects to SurrealDB |
| `mcp/src/surrealdb-client.ts` | Connection wrapper, schema init, query methods |
| `mcp/src/tools.ts` | MCP tool definitions (store, recall, forget, promote, status) |
| `mcp/src/resources.ts` | MCP resource definitions (memory://status) |

---

## Memory Model Summary

Three scopes crossed with four types:

| | Session | Project | User |
|---|---------|---------|------|
| **Episodic** (events) | Current task events | Past session summaries | Cross-project experiences |
| **Semantic** (facts) | Discovered facts | Codebase knowledge | Universal knowledge |
| **Procedural** (patterns) | Current workflows | Build/deploy/test patterns | Personal tool expertise |
| **Working** (scratch) | Active task state | -- | -- |

Detailed specification in [Memory Model](memory-model.md).

---

## Why SurrealDB

SurrealDB 3.0 is uniquely suited for agentic memory because it collapses the typical
multi-database architecture into a single engine:

1. **Document + Graph + Vector + FTS in one process.** No data synchronization between
   separate databases. A single `memory` table supports document fields, BM25 full-text
   search, HNSW vector indexes, and graph traversal via `RELATE`.

2. **Embedded mode eliminates infrastructure.** The `surrealdb` npm package includes
   SurrealKV, an embedded persistent engine. No server process, no Docker, no network
   hops. Data lives at a local file path.

3. **Namespace/database hierarchy maps to memory scopes.** SurrealDB's native
   namespace > database > table hierarchy maps directly to user > project > session
   memory scopes, providing hard isolation at the engine level.

4. **Computed fields and events enable self-evolution.** `DEFINE FIELD ... COMPUTED`
   calculates memory strength with exponential decay in real time. `DEFINE EVENT`
   triggers lifecycle transitions (active -> consolidated -> archived) automatically.

5. **Graph relations with `RELATE`.** Entity-to-entity relationships are first-class
   via `TYPE RELATION` tables, supporting the knowledge graph without a separate graph
   database. Temporal edges carry `valid_at` / `invalid_at` timestamps inspired by
   Graphiti.

6. **Hybrid search with reciprocal rank fusion.** `search::rrf()` combines BM25
   full-text scores with HNSW vector similarity scores in a single query, matching
   the dual-retrieval approach of LightRAG.

For the full feature-by-feature mapping, see
[docs/research/surrealdb-feature-mapping.md](../research/surrealdb-feature-mapping.md).
