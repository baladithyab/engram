# Existing Memory Plugins and Systems

Research into the current landscape of persistent memory solutions for AI coding assistants, with focus on Claude Code, Cursor, Windsurf, GitHub Copilot, and the broader MCP memory ecosystem.

> **Date:** 2026-02-23
> **Purpose:** Identify the gap a SurrealDB-backed memory plugin for Claude Code would fill.
> **Related:** [[SurrealDB Memory Plugin]]

---

## Table of Contents

- [[#1. Claude Code Built-in Memory]]
- [[#2. Claude Code Plugins — Dedicated Memory Systems]]
- [[#3. MCP Memory Servers — Generic]]
- [[#4. Memory-as-a-Service Platforms]]
- [[#5. Competitor IDE Memory Systems]]
- [[#6. Agent Memory Frameworks]]
- [[#7. Hook-Based Memory Patterns for Claude Code]]
- [[#8. Comparison Table]]
- [[#9. Gap Analysis — Where SurrealDB Fits]]

---

## 1. Claude Code Built-in Memory

### 1a. CLAUDE.md — Static Project Memory

Claude Code reads `CLAUDE.md` files at session start from the project root and parent directories. These are user-authored markdown files containing instructions, conventions, and rules.

| Attribute | Detail |
|-----------|--------|
| **Storage** | Plain markdown files on disk |
| **Scope** | Per-project (`CLAUDE.md`), per-user (`~/.claude/CLAUDE.md`), per-directory (child `CLAUDE.md`) |
| **Persistence** | Permanent — survives across sessions |
| **Retrieval** | Full file loaded into context at session start |
| **Authoring** | Manual — user writes and maintains |
| **Multi-project** | Yes — different `CLAUDE.md` per project root |

**Strengths:**
- Zero dependencies — works out of the box
- Version-controllable (checked into git)
- User has full control over content
- Hierarchical scoping (global > project > directory)

**Weaknesses:**
- Static — must be manually updated
- No semantic search or selective retrieval
- Entire file loaded into context (wastes tokens if large)
- No temporal awareness (doesn't know when things were decided)
- No automatic capture of decisions or learnings
- Limited to ~200 lines for auto-memory `MEMORY.md`

### 1b. Auto Memory (MEMORY.md)

Claude Code's newer auto-memory feature lets Claude write notes for itself in a `~/.claude/projects/<hash>/memory/` directory.

| Attribute | Detail |
|-----------|--------|
| **Storage** | Markdown files in `~/.claude/projects/<hash>/memory/` |
| **Scope** | Per-project (keyed by project path hash) |
| **Persistence** | Permanent on disk |
| **Retrieval** | First 200 lines of `MEMORY.md` loaded at session start; other files read on demand |
| **Authoring** | Automatic — Claude writes during sessions |
| **Multi-project** | Yes — separate memory directories per project |

**Strengths:**
- Automatic — Claude decides what to record
- Organized into topic files (debugging.md, api-conventions.md, etc.)
- `MEMORY.md` acts as an index to the memory directory
- No external dependencies

**Weaknesses:**
- Only first 200 lines of index loaded automatically
- Topic files require Claude to actively read them (consumes tool calls)
- No semantic search — relies on Claude's judgment to find relevant files
- No cross-project memory sharing
- No temporal metadata (when was this learned?)
- Can grow stale without pruning

### 1c. Compaction (/compact)

When a conversation approaches the context window limit, Claude Code automatically compacts (summarizes) the conversation and starts a new context with the summary pre-loaded.

| Attribute | Detail |
|-----------|--------|
| **Mechanism** | AI-generated summary of conversation history |
| **Trigger** | Automatic when context fills (~64% threshold) or manual via `/compact` |
| **Persistence** | Within session only — summary is the new context start |
| **Cross-session** | No — summary is lost when session ends |

**Strengths:**
- Prevents context overflow during long sessions
- Intelligent retention of file states, decisions, current task
- Completion buffer gives tasks room to finish before compacting

**Weaknesses:**
- Lossy — nuanced context can be lost during compaction
- "Amnesia" mid-session if important details dropped
- Not persistent across sessions
- No user control over what gets retained
- Can disrupt multi-step reasoning if triggered at wrong time

### 1d. Session Memory / Conversation History

Claude Code stores conversation data in `~/.claude/projects/<hash>/` as JSONL files. These contain full message history.

| Attribute | Detail |
|-----------|--------|
| **Storage** | JSONL files on disk |
| **Persistence** | Permanent but not auto-loaded |
| **Retrieval** | Not natively searchable; requires custom tooling |
| **Cross-session** | Data exists but not automatically surfaced |

**Strengths:**
- Full fidelity conversation record
- Can be mined by custom tools/skills

**Weaknesses:**
- Not natively searchable or surfaced to new sessions
- No semantic indexing
- Raw data (not summarized or structured)

---

## 2. Claude Code Plugins — Dedicated Memory Systems

### 2a. Claude-Mem (by thedotmack)

The most mature Claude Code memory plugin. Uses lifecycle hooks to capture, compress, and inject memory.

| Attribute | Detail |
|-----------|--------|
| **Storage** | SQLite with FTS5 full-text search |
| **Architecture** | 4 lifecycle hooks + background worker service (Bun on port 37777) |
| **Memory types** | Observations (tool usage), session summaries, semantic summaries |
| **Retrieval** | Progressive disclosure — layered retrieval with token cost visibility |
| **Persistence** | Permanent — local SQLite database |
| **Multi-project** | Per-project databases (keyed by working directory) |
| **Install** | `/plugin marketplace add thedotmack/claude-mem` |

**Hook Architecture:**
1. **SessionStart** — Injects context from last 10 sessions + recent observations
2. **UserPromptSubmit** — New session detection
3. **PostToolUse** — Captures tool usage observations (fire-and-forget)
4. **Stop** — Generates session summary
5. **SessionEnd** — Cleanup

**Strengths:**
- Fully automatic — no manual intervention needed
- Progressive disclosure reduces token waste
- MCP search tools for querying history
- Web viewer UI for real-time observation stream
- Privacy controls (`<private>` tags)
- Beta "Endless Mode" for biomimetic memory
- Context configuration (fine-grained control)
- Multilingual support (28 languages)
- Citation system with observation IDs

**Weaknesses:**
- SQLite only — no distributed/multi-machine support
- No graph relationships between memories
- No vector/semantic search (FTS5 is keyword-based)
- No cross-project memory (each project is isolated)
- Background worker adds complexity (Bun process management)
- Community feedback: "more like fast search over past sessions than a background brain"
- Still requires explicit priming for retrieval

### 2b. MeMesh (by PCIRCLE-AI)

Persistent memory plugin focused on architecture decisions and coding patterns.

| Attribute | Detail |
|-----------|--------|
| **Storage** | Local database (details not fully documented) |
| **Focus** | Architecture decisions, coding patterns, project context |
| **Install** | Claude Code plugin |

**Strengths:**
- Purpose-built for development decision tracking
- Remembers architecture decisions, coding patterns

**Weaknesses:**
- Smaller community (64 stars)
- Less mature than Claude-Mem
- Limited documentation

### 2c. Supermemory (claude-supermemory)

Cloud-based memory plugin by Supermemory.ai. Requires paid Pro plan.

| Attribute | Detail |
|-----------|--------|
| **Storage** | Cloud (Supermemory API) |
| **Architecture** | Context injection on session start + auto-capture on session end |
| **Memory types** | User preferences, project knowledge, past interactions, team memory |
| **Retrieval** | Semantic search via cloud API |
| **Persistence** | Cloud-persistent |
| **Multi-project** | Yes — per-repo settings with container tags |
| **Install** | `/plugin marketplace add supermemoryai/claude-supermemory` |

**Strengths:**
- Team memory — shared across team members
- Semantic search (cloud-powered)
- Cross-project memory
- Per-repo configuration

**Weaknesses:**
- Requires paid Supermemory Pro plan
- Data leaves your machine (cloud storage)
- Vendor lock-in to Supermemory.ai
- API key dependency

### 2d. Memory Store Plugin (by Julep AI)

Comprehensive plugin with OAuth authentication and automatic development tracking.

| Attribute | Detail |
|-----------|--------|
| **Storage** | Cloud (Julep service with OAuth) |
| **Features** | Auto session context capture, smart memory filtering, knowledge graph, semantic search |
| **Install** | Plugin marketplace with OAuth browser auth |

**Strengths:**
- Knowledge graph with memory associations
- Git commit analysis
- Team knowledge tracking
- Smart filtering (skips trivial changes)

**Weaknesses:**
- Cloud-dependent (OAuth required)
- External service dependency

### 2e. AutoMem (by Very Good Plugins)

Plugin marketplace entry with MCP server backend.

| Attribute | Detail |
|-----------|--------|
| **Storage** | AutoMem cloud service |
| **Commands** | `/memory-store`, `/memory-recall`, `/memory-health` |
| **Features** | Automatic session capture via hooks, knowledge graph, semantic search |

### 2f. claude-memory-mcp (by WhenMoon-afk / Substratia)

Lightweight local memory using SQLite + FTS5.

| Attribute | Detail |
|-----------|--------|
| **Storage** | SQLite + FTS5 locally |
| **Install** | `claude plugin install github:whenmoon-afk/claude-memory-mcp` |
| **Approach** | Two-tier: CLAUDE.md for always-loaded context + database for searchable archive |

**Key insight:** Uses CLAUDE.md as the "hot" memory tier and database as the "cold" tier. Hooks capture knowledge, CLAUDE.md delivers it. No custom protocols needed.

### 2g. claude-tandem (by jonny981)

Pure bash companion plugin — persistent memory, session handover, input cleanup, commit enrichment, and developer learning via native hooks.

---

## 3. MCP Memory Servers — Generic

These are standalone MCP servers that provide memory to any MCP-compatible client (Claude Desktop, Cursor, Windsurf, etc.).

### 3a. Official Memory Server (@modelcontextprotocol/server-memory)

Anthropic's reference implementation using a knowledge graph.

| Attribute | Detail |
|-----------|--------|
| **Storage** | JSONL file (local) |
| **Data model** | Knowledge graph — entities, relations, observations |
| **Tools** | `create_entities`, `create_relations`, `add_observations`, `search_nodes`, `open_nodes`, `delete_*` |
| **Install** | `npx -y @modelcontextprotocol/server-memory` |

**Strengths:**
- Official Anthropic reference implementation
- Simple knowledge graph model
- Local-only (privacy)
- Works with any MCP client

**Weaknesses:**
- JSONL file storage — not scalable
- No vector/semantic search
- No temporal awareness
- Basic graph model (no typing, no versioning)
- Manual memory management (agent must decide to store)

### 3b. Neo4j Memory MCP Server

Graph database-backed memory with advanced analytics.

| Attribute | Detail |
|-----------|--------|
| **Storage** | Neo4j graph database |
| **Data model** | Knowledge graph with Cypher queries |
| **Features** | Shared memory across teams, advanced graph analytics |
| **Install** | `uvx mcp-neo4j-memory` |

**Strengths:**
- True graph database — rich relationship modeling
- Shared memory across users/teams (if hosted)
- Graph analytics capabilities
- Mature database technology

**Weaknesses:**
- Requires Neo4j instance (operational overhead)
- No vector search natively (needs separate embedding)
- Complex setup

### 3c. Graphiti MCP Server (by Zep)

Temporal knowledge graph — the most sophisticated memory MCP available.

| Attribute | Detail |
|-----------|--------|
| **Storage** | Neo4j or FalkorDB (graph) + embeddings |
| **Data model** | Temporal knowledge graph with bi-temporal model (event time + ingestion time) |
| **Architecture** | Three-tier subgraph: episodic, semantic entity, community |
| **Tools** | Episode management, entity/relationship handling, hybrid search |
| **Performance** | 94.8% on DMR benchmark (vs MemGPT 93.4%), 90% latency reduction |

**Strengths:**
- State-of-the-art retrieval accuracy
- Temporal awareness — tracks how information evolves
- Bi-temporal model (event time + ingestion time)
- Cross-client memory (works across Claude Desktop, Cursor, Raycast)
- Multi-LLM provider support
- Production-ready (v1.0)
- 22.8k GitHub stars

**Weaknesses:**
- Requires graph database (Neo4j or FalkorDB)
- Complex infrastructure (not single-binary)
- LLM dependency for entity extraction
- Not specifically optimized for coding workflows

### 3d. MCP Persistent Memory (by dirkenglund)

Graph memory with automatic disk storage.

| Attribute | Detail |
|-----------|--------|
| **Storage** | JSON files on disk |
| **Data model** | Graph with entities, relations, observations |
| **Features** | Automatic disk persistence, HTTP and stdio modes |

### 3e. Hierarchical Memory MCP (anthropics-memory-mcp-server)

Three-tier memory with semantic search.

| Attribute | Detail |
|-----------|--------|
| **Storage** | Vector store (configurable: in-memory, external) |
| **Tiers** | Working (minutes, in-memory), Short-term (days/weeks, vector+TTL), Long-term (months, permanent) |
| **Features** | Semantic similarity search, automatic lifecycle management, TTL-based decay |

**Strengths:**
- Biomimetic three-tier architecture
- Automatic promotion/demotion between tiers
- Semantic search via embeddings
- Importance scoring and access pattern tracking

**Weaknesses:**
- Requires embedding provider (OpenAI API key)
- Complex configuration
- No graph relationships

### 3f. cbuntingde Memory Server

Three-tiered memory with sentiment analysis.

| Attribute | Detail |
|-----------|--------|
| **Tiers** | Short-term (in-memory, 30min TTL), Long-term (disk, permanent), Episodic (disk, permanent) |
| **Features** | Sentiment analysis, tagging, searchable event history |

### 3g. MCP Memory Keeper (by mkreyman)

Purpose-built for Claude Code context management during compaction.

| Attribute | Detail |
|-----------|--------|
| **Storage** | SQLite in `~/mcp-data/memory-keeper/` |
| **Focus** | Preventing context loss during compaction |
| **Features** | Token limit configuration, auto-update |

### 3h. mcp-memory-libsql (by spences10)

High-performance memory using libSQL for vector search.

| Attribute | Detail |
|-----------|--------|
| **Storage** | libSQL (SQLite fork with vector extensions) |
| **Features** | Vector search, semantic knowledge storage, knowledge graph |

### 3i. Advanced AI Memory & Reasoning MCP

Hierarchical memory with Tree-of-Thought reasoning.

| Attribute | Detail |
|-----------|--------|
| **Tiers** | Core (15 slots, permanent), Working (75 slots, session), Archival (2000 slots, forgetting curves) |
| **Features** | Tree-of-Thought reasoning, importance scoring, automatic cleanup |
| **Storage** | SQLite + Python |

---

## 4. Memory-as-a-Service Platforms

### 4a. Mem0

The most prominent AI memory platform. Raised $24M in funding.

| Attribute | Detail |
|-----------|--------|
| **Architecture** | Hybrid: vector store (semantic search) + key-value (fast retrieval) + optional graph (Neo4j for relationships) |
| **Embedding** | Configurable: OpenAI, Ollama (local), OpenRouter |
| **Vector store** | Qdrant (self-hosted or cloud), Supabase, or others |
| **MCP Server** | Official `mem0-mcp` — 11 tools (add, search, get, update, delete, entities, graph) |
| **Self-hosted** | Yes — with Qdrant + Ollama + optional Neo4j |
| **Cloud** | Mem0 Platform (paid) |
| **Stars** | 46,000+ GitHub stars |

**Tools exposed via MCP:**
- `add_memory` — Store facts, preferences, conversations
- `search_memories` — Semantic search (meaning-based, not keyword)
- `get_memories` — Browse and filter stored memories
- `update_memory` / `delete_memory` — Modify or remove
- `list_entities` — See stored users/agents/runs
- `search_graph` / `get_entity` — Query knowledge graph (Neo4j)

**OpenMemory MCP Server:**
- Local-first memory infrastructure
- Docker + Postgres + Qdrant
- Built-in UI for observability
- Audit logs for reads/writes
- App-level access control

**Strengths:**
- Most mature memory platform (+26% accuracy over OpenAI's memory on LOCOMO benchmark)
- Hybrid architecture (vector + KV + graph)
- Self-hostable with fully local stack
- Rich MCP integration
- Entity extraction and knowledge graph
- UI dashboard for memory management
- Multi-backend support (FAISS local, OpenSearch, Mem0 Platform)

**Weaknesses:**
- Complex self-hosted setup (Qdrant + Ollama + Neo4j)
- Cloud version sends data externally
- Requires embedding model (LLM dependency for extraction)
- Not specifically designed for coding workflows
- Multiple moving parts for self-hosted

### 4b. Zep / Graphiti

See Section 3c above. Zep is both a platform and open-source framework.

| Attribute | Detail |
|-----------|--------|
| **Architecture** | Temporal knowledge graph engine (Graphiti) |
| **Paper** | "Zep: A Temporal Knowledge Graph Architecture for Agent Memory" (arXiv:2501.13956) |
| **Performance** | 94.8% DMR, up to 18.5% accuracy improvement, 90% latency reduction |
| **Funding** | YC W24 backed |

### 4c. Supermemory

Cloud memory API. Raised $2.6M.

| Attribute | Detail |
|-----------|--------|
| **Focus** | Universal memory API — extracts structured insights from unstructured data |
| **Claude Code** | Plugin available (Pro plan required) |

### 4d. Letta (formerly MemGPT)

Stateful agent framework with self-editing memory. Raised $10M.

| Attribute | Detail |
|-----------|--------|
| **Architecture** | LLM-as-Operating-System paradigm — agent manages its own memory |
| **Memory tiers** | Core Memory (always visible, editable blocks), Recall Memory (conversation history, searchable), Archival Memory (long-term, vector-searchable) |
| **Self-editing** | Agent autonomously decides what to store, update, forget, and move between tiers |
| **Storage** | SQLite default; DB-backed for production |
| **API** | Full REST API — all state queryable and addressable |
| **Coding agent** | Letta Code — memory-first coding agent (Terminal-Bench #1 model-agnostic agent) |

**Key innovation:** The LLM itself manages memory through tool calls (`core_memory_append`, `core_memory_replace`, `archival_memory_insert`, `archival_memory_search`, `conversation_search`). No external orchestration needed.

**Strengths:**
- Most sophisticated self-managing memory architecture
- Agent autonomy over memory operations
- Multi-agent shared memory
- Production-grade (REST API, DB persistence)
- Research-backed (MemGPT paper)
- Letta Code for coding tasks

**Weaknesses:**
- Full framework (not a lightweight plugin)
- Complex architecture
- Requires understanding MemGPT paradigm
- Not a drop-in for Claude Code (separate platform)

---

## 5. Competitor IDE Memory Systems

### 5a. Cursor

Cursor approaches memory through multiple mechanisms:

**Codebase Indexing (RAG Pipeline):**
| Attribute | Detail |
|-----------|--------|
| **Mechanism** | Chunks code along meaningful boundaries, computes embeddings, stores in Turbopuffer (vector DB) |
| **Indexing** | Merkle trees for efficient change detection; auto-indexes on workspace open |
| **Retrieval** | Semantic similarity search via `@Codebase` or Cmd+Enter |
| **Updates** | Incremental — new/modified/deleted files tracked automatically |

**Project Rules (.cursor/rules/):**
| Attribute | Detail |
|-----------|--------|
| **Storage** | Markdown files in `.cursor/rules/` |
| **Scope** | Version-controlled, path-pattern scoped, manually or auto-applied |
| **Purpose** | Domain knowledge, workflow automation, style/architecture decisions |

**Memory Bank Pattern (Community):**
| Attribute | Detail |
|-----------|--------|
| **Origin** | Adapted from Cline's memory bank concept |
| **Structure** | `.cursor/memory/` or `.memory/` directory with structured docs: `projectbrief.md`, `productContext.md`, `systemPatterns.md`, `techContext.md`, `activeContext.md`, `progress.md` |
| **Usage** | AI reads memory bank before each task; updates after completing work |

**MCP Integration:**
- Cursor supports MCP servers via `~/.cursor/mcp.json`
- Any memory MCP (Mem0, Neo4j, Graphiti, etc.) can be plugged in

**Strengths:**
- Best-in-class codebase indexing (semantic search over entire repo)
- Embedding-powered context retrieval
- Rich rule system with path scoping
- MCP compatibility for external memory

**Weaknesses:**
- No built-in persistent memory across sessions (relies on rules/memory bank)
- Memory Bank is a community pattern, not native
- Codebase indexing is read-only (doesn't capture decisions or learnings)
- `.cursorrules` deprecated in favor of `.cursor/rules/`

### 5b. Windsurf (Codeium)

Windsurf has the most mature built-in memory system among coding IDEs.

**Cascade Memories:**
| Attribute | Detail |
|-----------|--------|
| **Storage** | `~/.codeium/windsurf/memories/` |
| **Types** | Automatic (generated by Cascade) and User-created (manual) |
| **Scope** | Workspace-specific (automatic) or global (user-created) |
| **Cost** | Automatic memories don't consume credits |
| **Persistence** | Across conversations within workspace |

**Rules System:**
| Attribute | Detail |
|-----------|--------|
| **Levels** | Global, Workspace, System (Enterprise) |
| **Storage** | `.windsurfrules`, `AGENTS.md`, global settings |
| **Features** | Rules discovery, activation modes, path scoping |

**Context Awareness:**
- Fast Context (real-time codebase awareness)
- Knowledge Base (Beta) — team knowledge from Google Docs
- Context Pinning — persistent reference to specific files/directories
- Windsurf Ignore — exclude files from context

**Strengths:**
- Native auto-generated memories (no plugin needed)
- Memories persist across conversations
- Workspace-specific isolation
- Enterprise system-level rules
- No credit cost for automatic memories
- Team knowledge base (Beta)

**Weaknesses:**
- Memories tied to workspace (not cross-project)
- Limited control over what gets auto-remembered
- No semantic search over memories
- No temporal metadata
- No graph relationships
- Proprietary — not extensible

### 5c. GitHub Copilot

GitHub recently launched "Agentic Memory" — repository-scoped persistent memory.

**Copilot Memory:**
| Attribute | Detail |
|-----------|--------|
| **Storage** | GitHub-hosted (repository-scoped) |
| **Creation** | "Just-in-time verification" — Copilot deduces memories from activity, validates before use |
| **Scope** | Repository-specific (not user-scoped) |
| **Access** | All users with Copilot Memory enabled for that repo |
| **Management** | Repo Settings > Copilot > Memory |
| **Plans** | Pro, Pro+, Organization, Enterprise |

**Where it's used:**
- Copilot Coding Agent
- Copilot Code Review
- Copilot CLI

**Strengths:**
- Native integration — no setup required
- Repository-scoped (prevents cross-project leakage)
- Just-in-time validation (stale memories auto-expire if code changes)
- Available to all repo collaborators
- Reduces need for custom instructions files

**Weaknesses:**
- Repository-scoped only (no personal/global memory)
- Opt-in (must be enabled per org/user)
- No user control over what gets memorized
- Limited transparency (hard to see what Copilot retains)
- Early access — still maturing
- Tied to GitHub platform

### 5d. Continue.dev

Open-source AI code assistant with MCP integration but no native memory system.

| Attribute | Detail |
|-----------|--------|
| **Memory approach** | MCP integration — uses external memory servers |
| **Codebase context** | `@Codebase` context provider with local embeddings (nomic-embed-text via Ollama + LanceDB) |
| **Configuration** | `config.yaml` with context providers and MCP blocks |
| **Memory MCP** | Docker `mcp/memory` block available on Continue Hub |

**Strengths:**
- Fully open-source
- Model-agnostic
- MCP-compatible (can use any memory server)
- Local embeddings possible (privacy)
- Hub for sharing configurations

**Weaknesses:**
- No native memory system
- Relies on external MCP servers for persistence
- More complex setup than commercial alternatives
- Limited out-of-box context management

---

## 6. Agent Memory Frameworks

### 6a. LangMem (LangChain)

SDK for agent long-term memory, designed to work with LangGraph.

| Attribute | Detail |
|-----------|--------|
| **Memory types** | Semantic (facts/knowledge), Episodic (past experiences), Procedural (system behavior/rules) |
| **Storage** | Storage-agnostic — InMemoryStore, AsyncPostgresStore, or any backend |
| **Tools** | `create_manage_memory_tool`, `create_search_memory_tool` |
| **Update modes** | "Hot path" (agent decides in-conversation) or "Background" (async post-conversation) |
| **Integration** | Native with LangGraph; works with MongoDB, Pinecone, Weaviate, etc. |

**Strengths:**
- Well-designed memory taxonomy (semantic/episodic/procedural)
- Background memory consolidation
- Storage flexibility
- Production-ready with PostgresStore
- Deep LangChain/LangGraph integration

**Weaknesses:**
- Tied to LangChain ecosystem
- Not directly usable in Claude Code
- Requires separate agent framework

### 6b. Cognee

Graph-based structured memory layer for agents.

### 6c. Memobase

User-centric memory framework with templates for memory schemas.

---

## 7. Hook-Based Memory Patterns for Claude Code

Claude Code's hook system enables building custom memory solutions without plugins or MCP servers.

### Available Hook Events

| Event | Purpose for Memory |
|-------|-------------------|
| `SessionStart` | Inject relevant memories into context |
| `UserPromptSubmit` | Add context before Claude processes prompt |
| `PreToolUse` | Validate against remembered patterns |
| `PostToolUse` | Capture tool usage as memory |
| `Stop` | Summarize and store session learnings |
| `PreCompact` | Save context before compaction (prevent amnesia) |
| `SubagentStart/Stop` | Track parallel work context |

### Pattern: CLAUDE.md + Hooks (Two-Tier Memory)

The most common DIY pattern:

```
Session Start Hook:
  1. Read memory database
  2. Generate relevant context summary
  3. Inject via additionalContext or write to CLAUDE.md

Post Tool Use Hook:
  1. Capture tool usage observation
  2. Fire-and-forget to background worker
  3. Worker stores in database

Stop Hook:
  1. Summarize session decisions/learnings
  2. Store summary in database
  3. Optionally update CLAUDE.md
```

**Known Issues (as of Feb 2026):**
- `additionalContext` injection is buggy across multiple hook types (#19643, #19432, #18534, #16538)
- `systemMessage` in UserPromptSubmit not reliably injected
- No `AssistantResponse` hook yet (Feature Request #17865)
- Context injection placement not specified (impacts prompt caching)

### Pattern: memory-mcp (CLAUDE.md as Hot Path)

Uses hooks to capture → database stores → periodically writes "hot" memories to `CLAUDE.md`.

```
Hooks capture knowledge → Database stores all memories
                       → Most important memories → CLAUDE.md (auto-loaded)
                       → Everything else → searchable via MCP tools
```

---

## 8. Comparison Table

| System | Storage | Semantic Search | Graph | Temporal | Auto-Capture | Cross-Project | Local-First | Coding-Specific | Setup Complexity |
|--------|---------|----------------|-------|----------|-------------|--------------|------------|----------------|-----------------|
| **CLAUDE.md** | Markdown files | No | No | No | No (manual) | Partially | Yes | No | Trivial |
| **Auto Memory** | Markdown files | No | No | No | Yes | No | Yes | Yes | Trivial |
| **Claude-Mem** | SQLite+FTS5 | No (keyword) | No | No | Yes (hooks) | No | Yes | Yes | Low |
| **Supermemory** | Cloud | Yes | No | No | Yes | Yes | No | No | Low |
| **Mem0 (cloud)** | Cloud (Qdrant) | Yes | Optional | No | Via MCP | Yes | No | No | Low |
| **Mem0 (self-hosted)** | Qdrant+Neo4j | Yes | Yes | No | Via MCP | Yes | Yes | No | High |
| **Graphiti/Zep** | Neo4j/FalkorDB | Yes | Yes | **Yes** | Via MCP | Yes | Yes | No | High |
| **Official Memory MCP** | JSONL | No | Basic | No | No (manual) | No | Yes | No | Low |
| **Neo4j Memory MCP** | Neo4j | No | Yes | No | No (manual) | Yes (hosted) | Optional | No | Medium |
| **Letta/MemGPT** | SQLite/DB | Yes | No | No | **Self-managing** | Via API | Yes | Via Letta Code | High |
| **Cursor (indexing)** | Turbopuffer | Yes | No | No | Yes | Per workspace | No | Yes | Trivial |
| **Windsurf Memories** | Local files | No | No | No | Yes (Cascade) | No | Yes | Yes | Trivial |
| **Copilot Memory** | GitHub-hosted | Unknown | No | No | Yes | Per repo | No | Yes | Trivial |
| **LangMem** | Configurable | Yes | No | No | Agent-driven | Yes | Optional | No | Medium |
| **SurrealDB (proposed)** | SurrealDB | **Yes (native)** | **Yes (native)** | **Yes** | **Yes (hooks)** | **Yes** | **Yes** | **Yes** | **Low-Medium** |

---

## 9. Gap Analysis — Where SurrealDB Fits

### What Exists Today

The current landscape breaks into clear tiers:

1. **Trivial but Limited:** CLAUDE.md, Auto Memory, Windsurf Memories — easy to use but no semantic search, no graph, no temporal awareness
2. **Plugin-Based (Claude Code):** Claude-Mem dominates — good auto-capture via hooks but only keyword search (FTS5), no graph relationships, no cross-project memory
3. **MCP Servers (Generic):** Mem0 and Graphiti are powerful but require complex multi-service infrastructure (Qdrant + Neo4j + Ollama). Not optimized for coding workflows.
4. **IDE-Native:** Cursor and Copilot have strong indexing/memory but are platform-locked and not extensible

### The Gap

No existing solution delivers ALL of:

1. **Unified multi-model database** — Document + Graph + Vector in one engine (SurrealDB's core value proposition)
2. **Single binary / low-ops** — Mem0 self-hosted needs Qdrant + Ollama + Neo4j + Postgres. SurrealDB runs as a single binary with in-memory, file, or distributed modes.
3. **Native graph relationships** — Claude-Mem (the leading Claude Code plugin) has zero graph capability. Decisions, patterns, and dependencies aren't connected.
4. **Native vector search** — Claude-Mem uses FTS5 (keyword only). SurrealDB 3.0 has native vector indexing and search.
5. **Temporal awareness** — Only Graphiti/Zep tracks when facts were learned and how they evolve. SurrealDB's multi-model nature supports this natively.
6. **Hierarchical memory (user > project > session)** — Most systems are flat or single-project. No existing solution has a clean three-level hierarchy that shares user preferences across projects while keeping project decisions isolated.
7. **Self-evolving memory** — Only Letta/MemGPT has true self-editing memory. Combining SurrealDB's graph + vector with Claude Code hooks could enable memory that reorganizes, consolidates, and prunes itself.
8. **Coding-workflow optimization** — Mem0 and Graphiti are general-purpose. A SurrealDB plugin can be purpose-built for development patterns: file decisions, dependency choices, debugging insights, test strategies, architecture records.
9. **Multi-deployment flexibility** — In-memory (ephemeral/testing), file-backed (single developer), server (team), cloud (enterprise). Most solutions are single-mode.
10. **SurrealQL power** — One query language across documents, graphs, vectors, and relations. No need for separate Cypher + SQL + vector search APIs.

### What a SurrealDB Plugin Would Uniquely Offer

```
                    SurrealDB Memory Plugin
                    =======================

    Hooks Layer              MCP Layer              Storage Layer
    (Auto-capture)           (Query/Search)         (SurrealDB)
    +-----------+            +-----------+          +-----------+
    |SessionStart|           |store_memory|         | Documents |
    |PostToolUse |  -------> |search_mem  | <-----> | + Graphs  |
    |Stop        |           |get_context |         | + Vectors |
    |PreCompact  |           |evolve_mem  |         | + Time    |
    +-----------+            +-----------+          +-----------+
         |                        |                      |
         v                        v                      v
    Auto-capture             Rich queries           Single binary
    decisions &              across all              In-mem / file /
    patterns                 memory types            server / cloud
```

**Key differentiators:**
- **One database, all memory types** — No Qdrant + Neo4j + Postgres stack
- **Graph-native decisions** — "We chose JWT auth *because of* microservice architecture *which requires* token refresh *which we implemented in* auth-service"
- **Vector-native recall** — "Find memories similar to 'authentication timeout issues'" without separate embedding infrastructure
- **Temporal-native evolution** — "What did we decide about caching *before* we scaled to 10k users vs *after*?"
- **Single binary deployment** — `surreal start memory` for development, `surreal start file://data.db` for persistence, `surreal start tikv://cluster` for teams
- **Hierarchical scoping** — User preferences flow down, project decisions stay isolated, session context is ephemeral

---

## Sources

- [Claude Code Memory Docs](https://code.claude.com/docs/en/memory)
- [Claude-Mem Documentation](https://docs.claude-mem.ai/introduction)
- [thedotmack/claude-mem GitHub](https://github.com/thedotmack/claude-mem)
- [Mem0 MCP Documentation](https://docs.mem0.ai/platform/mem0-mcp)
- [Mem0 Blog: Claude Code Memory](https://mem0.ai/blog/claude-code-memory)
- [Zep Graphiti MCP](https://www.getzep.com/product/knowledge-graph-mcp/)
- [Zep Paper (arXiv:2501.13956)](https://arxiv.org/abs/2501.13956)
- [Letta/MemGPT Core Concepts](https://docs.letta.com/core-concepts/)
- [Windsurf Cascade Memories](https://docs.windsurf.com/windsurf/cascade/memories)
- [GitHub Copilot Memory](https://docs.github.com/copilot/concepts/agents/copilot-memory)
- [Cursor Rules Documentation](https://cursor.com/docs/context/rules)
- [Claude Code Hooks Guide](https://code.claude.com/docs/en/hooks-guide)
- [LangMem SDK](https://langchain-ai.github.io/langmem/)
- [SurrealDB MCP (Official)](https://surrealdb.com/mcp)
- [SurrealDB 3.0 Announcement](https://surrealdb.com/blog/introducing-surrealdb-3-0--the-future-of-ai-agent-memory)
- [awesome-mcp-servers Memory Category](https://github.com/TensorBlock/awesome-mcp-servers/blob/main/docs/knowledge-management--memory.md)
