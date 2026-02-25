# Engram Evolution Design

> Rename engram to Engram and implement Phases 1-5: EURM gap closure,
> embedding pipeline, Code Mode interface, recursive memory processing, and
> MemEvolve meta-evolution.
>
> **Date:** 2026-02-25
> **Status:** Approved
> **Branch:** `feature/engram-evolution`

---

## 1. Rename: engram → Engram

An engram is the physical trace of a memory in the brain — the substrate that stores
learned experience. The name is short, memorable, and precisely describes what the
plugin does: it is the physical substrate of Claude's persistent memory.

### What Changes

| Component | Old | New |
|-----------|-----|-----|
| Plugin name (plugin.json) | `engram` | `engram` |
| MCP server name (.mcp.json) | `engram` | `engram` |
| Config file | `.claude/engram.local.md` | `.claude/engram.local.md` |
| Default data path | `~/.claude/engram/data` | `~/.claude/engram/data` |
| Package name (package.json) | `engram-mcp` | `engram-mcp` |
| Hook scripts | References to `engram` | References to `engram` |
| Documentation | All `engram` references | All `engram` references |

### What Does NOT Change

- Git remote / GitHub repo name (deferred until after PR merge)
- npm registry name (if ever published, separate decision)
- SurrealDB namespace (`memory`) — this is a domain concept, not a brand name

### Migration

The Setup hook detects old data paths (`~/.claude/engram/`) and reads them
as fallback. The config reader checks both `.claude/engram.local.md` and
`.claude/engram.local.md`, preferring the new name. No data migration needed — the
SurrealDB files are path-agnostic.

---

## 2. Phase 1 — Close the EURM Loop

Five fixes to make the MemEvolve Encode-Update-Retrieve-Manage cycle actually
functional. Currently, Encode and Retrieve are stubs, and Manage identifies work
but doesn't execute it.

### Fix 1: Wire PostToolUse Hooks (Encode)

**Files:** `hooks/scripts/post-file-change.sh`, `hooks/scripts/post-bash-error.sh`

Replace logging stubs with lightweight Bun scripts that call `store_memory` via
the MCP server. Each stores an episodic memory at session scope.

**post-file-change.sh** stores:
- Content: "Modified {file_path}: {summary of change}"
- Type: `episodic`
- Scope: `session`
- Tags: `[file_path, "file-change"]`
- Importance: `0.3` (routine changes), `0.6` (new files)

**post-bash-error.sh** stores:
- Content: "Command failed: {command} → {error output}"
- Type: `episodic`
- Scope: `session`
- Tags: `["error", "debugging", command_name]`
- Importance: `0.5` (errors are valuable debugging memory)

### Fix 2: SessionStart Queries Real Memories (Retrieve)

**File:** `hooks/scripts/session-start.sh`

Replace the static JSON documentation output with a Bun script that:
1. Connects to SurrealDB (project + user scopes)
2. Queries top 10 active memories ordered by `memory_strength DESC`
3. Formats results within a 2000-token budget
4. Includes scope weights from `evolution_state` (if available)
5. Outputs as `additionalContext` JSON for system prompt injection

### Fix 3: Use memory_strength in Retrieval

**File:** `mcp/src/tools.ts` → `recall_memories` tool

Update the recall query from raw BM25 ordering to a composite score:

```surql
SELECT *, search::score(1) AS bm25_score
FROM memory
WHERE content @1@ $query AND status = 'active'
ORDER BY (search::score(1) * 0.6 + memory_strength * 0.4) DESC
LIMIT $limit
```

This operationalizes the exponential decay model that's defined in schema but
currently unused.

### Fix 4: Write to retrieval_log

**File:** `mcp/src/surrealdb-client.ts`

Every `recallMemories()` call logs to `retrieval_log`:

```surql
CREATE retrieval_log SET
  query = $query,
  strategy = 'bm25',
  results_count = $count,
  memory_ids = $ids,
  session_id = $session_id,
  created_at = time::now()
```

This starts accumulating the data that Phase 5's evolution loop needs.

### Fix 5: Make Consolidation Actually Consolidate

**File:** `mcp/src/tools.ts` → `reflect_and_consolidate` tool

Wire the actions that the tool currently only identifies:
- **Archive:** `UPDATE memory SET status = 'archived' WHERE memory_strength < 0.1 AND access_count < 2`
- **Promote:** Move session memories with importance >= 0.5 and access_count >= 2 to project scope
- **Deduplicate:** For memories with BM25 content overlap > 0.8, merge by keeping the higher-strength one and incrementing its access_count

---

## 3. Phase 2 — Embedding Pipeline

Provider-agnostic embedding generation with local fallback.

### Architecture

```
EmbeddingProvider (interface)
  ├── LocalProvider
  │   └── @xenova/transformers → all-MiniLM-L6-v2 (384-dim, ONNX)
  └── ApiProvider
      └── OpenAI-compatible REST (configurable endpoint + model + key)
```

### Local Provider (Default)

- Package: `@xenova/transformers` (runs ONNX models in Bun/Node)
- Model: `Xenova/all-MiniLM-L6-v2` (384 dimensions)
- Model cache: `~/.claude/engram/models/`
- Performance: ~50ms per embedding on CPU
- No API key, no network, no external dependency

### API Provider (Opt-In)

Configurable via `engram.local.md` frontmatter:

```yaml
---
embedding_provider: api
embedding_url: https://api.openai.com/v1/embeddings
embedding_model: text-embedding-3-small
embedding_api_key: ${OPENAI_API_KEY}
embedding_dimensions: 384
---
```

Compatible with any provider following the OpenAI embeddings REST contract:
- OpenAI (text-embedding-3-small, text-embedding-3-large)
- Cohere (via OpenAI-compatible proxy)
- Voyage AI
- Mistral (mistral-embed)
- Local Ollama (nomic-embed-text via localhost)

### Dimension Handling

- HNSW index is defined at 384 dimensions (matching local model)
- API providers with different native dimensions use the `dimensions` parameter
  in the REST request to request 384-dim output (OpenAI supports this natively)
- If a provider doesn't support dimension reduction, truncate to 384

### Integration Points

| Component | Change |
|-----------|--------|
| `store_memory` | Generate embedding before INSERT |
| `recall_memories` | Hybrid BM25 + HNSW via `search::rrf()` when embedding available |
| `search_knowledge_graph` | Embed entity names/descriptions on creation |
| `engram_execute` | Vector functions available in SurrealQL |

### New Files

- `mcp/src/embeddings/provider.ts` — `EmbeddingProvider` interface
- `mcp/src/embeddings/local.ts` — `LocalProvider` implementation
- `mcp/src/embeddings/api.ts` — `ApiProvider` implementation
- `mcp/src/embeddings/index.ts` — Factory: reads config, returns correct provider

---

## 4. Phase 3 — Code Mode Interface

Inspired by Forgemax's two-tool pattern and Anthropic's Programmatic Tool Calling.
Instead of rigid JSON tool schemas, give Claude the ability to write expressive
SurrealQL queries against the memory database.

### Tool: engram_explore

Progressive manifest discovery — Claude learns about the memory store incrementally
rather than loading all schema upfront.

```typescript
server.tool("engram_explore", "...", {
  depth: z.number().min(0).max(3).optional(),
  scope: z.enum(["session", "project", "user", "all"]).optional(),
  table: z.string().optional(),
  sample_size: z.number().optional(),
});
```

**Layer 0** (depth=0): Scope names + memory counts per scope (~50 tokens)
**Layer 1** (depth=1): Table names + column stats per scope (~200 tokens)
**Layer 2** (depth=2): Full schema + index info for a table (~500 tokens)
**Layer 3** (depth=3): Sample records from a specific table (~variable)

### Tool: engram_execute

Run arbitrary SurrealQL with safety controls.

```typescript
server.tool("engram_execute", "...", {
  surql: z.string(),
  scope: z.enum(["session", "project", "user"]).optional(),
  allow_writes: z.boolean().optional(),
});
```

**AST Validator:**
- Allowlist: `SELECT`, `INSERT`, `UPDATE`, `CREATE`, `UPSERT`, `RELATE`,
  `LET`, `RETURN`, `IF/ELSE`, all built-in functions
- Blocklist: `DROP`, `DEFINE`, `REMOVE`, `KILL`, `USE NS`, `USE DB`, `INFO FOR`
- Write gating: INSERT/UPDATE/CREATE/RELATE require `allow_writes: true`
- Implementation: Regex-based keyword scanner on normalized query (SurrealQL's
  DDL surface is small enough that a full parser isn't needed)

**Execution:** Routes to the specified scope database, executes, returns results
with timing stats (query_time_ms, rows_returned, scope_used).

### Tool: recall_skill

Find and optionally execute stored SurrealQL query patterns.

```typescript
server.tool("recall_skill", "...", {
  task_description: z.string(),
  execute: z.boolean().optional(),
  scope: z.enum(["session", "project", "user"]).optional(),
});
```

- Searches procedural memories tagged `#surql-skill` via BM25
- Returns the SurrealQL template with adaptation notes
- If `execute: true`, runs the query and updates `metadata.execution_count`
- Skills used 10+ times are flagged for promotion to user scope

### Tool: mark_retrieval_useful

Explicit feedback signal for the evolution loop.

```typescript
server.tool("mark_retrieval_useful", "...", {
  query: z.string(),
  was_useful: z.boolean(),
  reason: z.string().optional(),
});
```

Updates the most recent matching `retrieval_log` entry with `was_useful` and
optional reason.

### Relationship to Existing Tools

The 9 existing tools stay. They are simpler, more predictable, and appropriate for
basic store/recall/forget workflows. `engram_execute` is the power tool for when
Claude needs expressive queries — complex filters, multi-scope joins, graph
traversals with conditions, aggregations.

Think of it as: existing tools = GUI buttons, `engram_execute` = SQL console.

### New Files

- `mcp/src/tools-codemode.ts` — `engram_explore`, `engram_execute`
- `mcp/src/tools-skills.ts` — `recall_skill`, `mark_retrieval_useful`
- `mcp/src/security/surql-validator.ts` — AST validation for SurrealQL safety

---

## 5. Phase 4 — Recursive Memory Processing

Three tools that prevent context rot when the memory store grows large. Based on
the MIT Recursive Language Models paper.

### Tool: memory_peek

Statistical sampling without loading full records.

```typescript
server.tool("memory_peek", "...", {
  scope: z.enum(["session", "project", "user", "all"]).optional(),
  sample_n: z.number().optional(),
  focus: z.string().optional(),
});
```

Returns:
- Count by type (episodic/semantic/procedural/working)
- Count by status (active/consolidated/archived)
- Tag frequency distribution (top 20 tags)
- Date range (oldest → newest memory)
- N representative samples (spread across types and dates)
- If `focus` provided: N samples near that topic via BM25

### Tool: memory_partition

Split memory store into processable chunks.

```typescript
server.tool("memory_partition", "...", {
  partition_by: z.enum(["tag", "date", "type", "scope", "importance_band"]),
  scope: z.enum(["session", "project", "user", "all"]).optional(),
  max_partitions: z.number().optional(),
});
```

Returns partition descriptors — NOT full records:
```json
[
  { "key": "auth", "count": 47, "date_range": ["2026-01-15", "2026-02-25"], "avg_importance": 0.6 },
  { "key": "database", "count": 23, "date_range": ["2026-02-01", "2026-02-24"], "avg_importance": 0.5 }
]
```

Claude then queries each partition independently via `recall_memories` or
`engram_execute`.

### Tool: memory_aggregate

Reciprocal Rank Fusion across partition query results.

```typescript
server.tool("memory_aggregate", "...", {
  results: z.array(z.object({
    source: z.string(),
    memories: z.array(z.unknown()),
    local_score: z.number().optional(),
  })),
  final_limit: z.number().optional(),
  dedup_threshold: z.number().optional(),
});
```

- RRF formula: `score(d) = Σ 1/(k + rank_i(d))` with k=60
- Content-hash deduplication for near-duplicates (BM25 similarity > threshold)
- Returns unified ranked list with provenance (which partition each result came from)

### The Recursive Pattern

```
1. memory_peek(focus="authentication")
   → "3 partitions: auth(47), jwt(12), middleware(8)"

2. For each partition:
   engram_execute("SELECT content, memory_strength FROM memory
     WHERE tags CONTAINS 'auth' ORDER BY memory_strength DESC LIMIT 5")

3. memory_aggregate([results_auth, results_jwt, results_middleware])
   → Unified top 10 without context rot
```

### New Files

- `mcp/src/tools-recursive.ts` — `memory_peek`, `memory_partition`, `memory_aggregate`
- `mcp/src/aggregation/rrf.ts` — Reciprocal Rank Fusion implementation

---

## 6. Phase 5 — MemEvolve Meta-Evolution

The self-tuning feedback loop. The memory system observes its own performance and
adapts its parameters over time.

### Tool: evolve_memory_system

```typescript
server.tool("evolve_memory_system", "...", {
  dry_run: z.boolean().optional(),
  lookback_days: z.number().optional(),
});
```

**Analysis pipeline:**

1. Read `retrieval_log` for the lookback window
2. Compute per-strategy effectiveness (BM25 vs hybrid vs graph)
3. Analyze per-scope utility (which scope's memories were useful?)
4. Compute per-type utility (episodic vs semantic vs procedural)
5. Compare current `evolution_state` parameters against empirical data
6. Propose parameter updates with bounded changes (max ±0.2 per cycle)

**Evolvable parameters** (stored in `evolution_state`):

| Key | Default | What It Controls |
|-----|---------|-----------------|
| `scope_weights` | `{session: 1.5, project: 1.0, user: 0.7}` | Cross-scope retrieval weighting |
| `decay_half_lives` | `{working: 0.042, episodic: 1.0, semantic: 7.0, procedural: 30.0}` | Memory strength decay rates |
| `promotion_thresholds` | `{importance: 0.5, access_count: 2}` | When to promote session → project |
| `retrieval_strategy` | `"bm25"` | Default search approach |
| `evolution_history` | `[]` | Append-only log of parameter changes |

**Safety rails:**
- Parameter changes bounded: scope weights ±0.2, half-lives ×0.5-2.0 per cycle
- Evolution history is append-only (full audit trail)
- `dry_run` mode previews changes without applying
- Manual config in `engram.local.md` always overrides evolved parameters
- Minimum data threshold: needs 50+ retrieval_log entries before proposing changes

### Hook Integration

| Hook | Evolution Role |
|------|---------------|
| **Setup** | Seed `evolution_state` with defaults |
| **SessionStart** | Read `evolution_state` → apply current scope weights and strategy |
| **Stop** | Lightweight single-session analysis, micro-adjustments |
| **TeammateIdle** | Full `evolve_memory_system` with multi-day lookback |

### New Files

- `mcp/src/tools-evolution.ts` — `evolve_memory_system`
- `mcp/src/evolution/analyze.ts` — Strategy effectiveness analysis
- `mcp/src/evolution/propose.ts` — Bounded parameter update proposals

---

## 7. Agent Team Structure

Four agents working on isolated git worktrees, coordinated by a team lead.

### Dependency Graph

```
Agent 1: Foundation (rename + Phase 1)
    │
    ├──→ Agent 2: Embeddings (Phase 2)     ← parallel after Agent 1
    ├──→ Agent 3: Code Mode (Phase 3)      ← parallel after Agent 1
    └──→ Agent 4: Recursive + Evolution (Phase 4+5)  ← parallel after Agent 1
                                                       ← needs Agent 3's validator
```

### Agent 1 — Foundation (Blocker)

**Scope:** Rename everything to Engram + close all 5 Phase 1 EURM gaps.

**Files touched:**
- `plugin.json`, `.mcp.json`, `mcp/package.json` (rename)
- All `hooks/scripts/*.sh` (rename references + wire stubs)
- `mcp/src/surrealdb-client.ts` (retrieval_log writes, config paths)
- `mcp/src/tools.ts` (memory_strength ordering, consolidation actions)
- `mcp/src/schema.ts` (evolution_state seed defaults)
- `CLAUDE.md`, all `docs/**/*.md` (rename references)
- All `commands/*.md`, `skills/*/SKILL.md`, `agents/*.md` (rename references)

**Completion signal:** All files compile (`bun run typecheck`), old references
grep-clean, hook scripts executable.

### Agent 2 — Embeddings (Phase 2)

**Scope:** Full embedding pipeline — local + API providers, hybrid search.

**Files created:**
- `mcp/src/embeddings/provider.ts`
- `mcp/src/embeddings/local.ts`
- `mcp/src/embeddings/api.ts`
- `mcp/src/embeddings/index.ts`

**Files modified:**
- `mcp/package.json` (add `@xenova/transformers`)
- `mcp/src/surrealdb-client.ts` (embed on store, hybrid recall)
- `mcp/src/tools.ts` (pass embeddings through store_memory, hybrid search in recall)

**Depends on:** Agent 1 (paths must be renamed first)

### Agent 3 — Code Mode (Phase 3)

**Scope:** `engram_explore`, `engram_execute`, `recall_skill`, `mark_retrieval_useful`,
AST validator.

**Files created:**
- `mcp/src/tools-codemode.ts`
- `mcp/src/tools-skills.ts`
- `mcp/src/security/surql-validator.ts`

**Files modified:**
- `mcp/src/index.ts` (register new tool modules)

**Depends on:** Agent 1 (paths must be renamed first)

### Agent 4 — Recursive + Evolution (Phase 4+5)

**Scope:** `memory_peek`, `memory_partition`, `memory_aggregate`, `evolve_memory_system`,
RRF implementation, evolution analysis.

**Files created:**
- `mcp/src/tools-recursive.ts`
- `mcp/src/tools-evolution.ts`
- `mcp/src/aggregation/rrf.ts`
- `mcp/src/evolution/analyze.ts`
- `mcp/src/evolution/propose.ts`

**Files modified:**
- `mcp/src/index.ts` (register new tool modules)

**Depends on:** Agent 1 (paths must be renamed). Uses Agent 3's validator
concept but builds independently (the RRF and evolution modules are self-contained).

### Execution Order

1. Agent 1 runs on the feature branch (not a worktree — it's the base)
2. Once Agent 1 completes, Agents 2-4 spawn on isolated worktrees
3. Each agent works independently, produces commits
4. Team lead merges worktree branches back into the feature branch
5. Final typecheck + integration verification
6. PR to main

---

## 8. Branch Strategy

All work happens on `feature/engram-evolution` branched from `main`.

```
main
  └── feature/engram-evolution  (Agent 1 works here directly)
        ├── worktree/embeddings   (Agent 2)
        ├── worktree/codemode     (Agent 3)
        └── worktree/recursive    (Agent 4)
```

After all agents complete, worktree branches merge into
`feature/engram-evolution`, which becomes the PR to `main`.

Git remote rename (GitHub repo name) is deferred until after the PR merges.
