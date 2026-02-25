# Memory Model

> Detailed specification of the engram hierarchical memory system:
> scopes, types, lifecycle states, promotion pipeline, scoring, decay, and
> the complete SurrealQL schema.
>
> **See also:** [Overview](overview.md) | [Hooks and Lifecycle](hooks-and-lifecycle.md)

---

## 1. Three Memory Scopes

Every memory belongs to exactly one scope. Scopes form a hierarchy from ephemeral
(session) to permanent (user), with promotion as the mechanism for moving knowledge
upward.

### 1a. Session Scope

**Lifetime:** Single Claude Code conversation (session start to session end).

**Content:** Working context, tool outcomes, current task state, intermediate
reasoning, errors encountered, decisions made during this conversation.

**Storage:** In-memory SurrealDB (`mem://`) -- fastest possible read/write, destroyed
when the session ends unless promoted.

**SurrealDB mapping:**
- Namespace: `session`
- Database: `s_{session_id}` (ULID generated at session start)
- Connection: in-process embedded (no network hop)

**Behavior:**
- Memories are created continuously as Claude works
- On session end (Stop hook), memories are evaluated for promotion
- Unpromoted session memories are destroyed with the in-memory database
- Working-type memories are never promoted (they are scratch space)

### 1b. Project Scope

**Lifetime:** Persists across all sessions within a single project directory.

**Content:** Codebase architecture knowledge, file patterns and conventions,
build/test/deploy recipes, dependency information, past decisions and rationale,
common errors and their fixes, team conventions.

**Storage:** Persistent on disk via SurrealKV or RocksDB. Data stored in
`.claude/engram/` within the project root (recommended `.gitignore` entry
since memory is personal, not shared via git).

**SurrealDB mapping:**
- Namespace: `project`
- Database: `p_{sha256(canonical_project_path)[:12]}`
- Connection: file-backed embedded SurrealDB

**Behavior:**
- Grows across sessions as knowledge accumulates
- Consolidated periodically -- duplicates merged, weak memories decay
- Memories with cross-project relevance can promote to user scope
- Moderate decay rate (7-day half-life for semantic, 30-day for procedural)

### 1c. User Scope

**Lifetime:** Persists across all projects and all sessions for this user.

**Content:** Personal coding preferences, tool expertise, framework knowledge,
cross-project patterns, environment knowledge, general workflow intelligence.

**Storage:** Persistent at `~/.claude/engram/`. Survives across all projects.

**SurrealDB mapping:**
- Namespace: `user`
- Database: `default`
- Connection: file-backed embedded SurrealDB

**Behavior:**
- The longest-lived memory store
- Aggressively consolidated -- fewest but highest-quality memories
- Slow decay (30-day half-life)
- Never deleted unless the user explicitly resets

### Scope Comparison

| Property | Session | Project | User |
|----------|---------|---------|------|
| Lifetime | Single conversation | Across sessions in one project | Across all projects |
| Storage | In-memory | Disk (project root) | Disk (home dir) |
| Decay rate | Instant on end (unless promoted) | Moderate (7-day half-life) | Slow (30-day half-life) |
| Max memories | Unbounded during session | ~10,000 per project | ~5,000 global |
| SurrealDB namespace | `session` | `project` | `user` |
| SurrealDB database | `s_{session_id}` | `p_{path_hash}` | `default` |

---

## 2. Four Memory Types

Each memory has a type that classifies what kind of knowledge it represents. Types
are inspired by cognitive science: human memory is not monolithic but consists of
distinct systems with different characteristics.

### 2a. Episodic Memory

**Cognitive analog:** Personal experiences and events.

**Content:** Things that happened -- tool calls and their results, errors encountered,
conversations, decisions made, debugging sessions.

**Characteristics:**
- Time-stamped events with full context
- High initial importance, fast decay (1-day half-life)
- Most likely to be consolidated into semantic memories
- Source material for pattern extraction

**Examples:**
- "Fixed auth bug by adding token refresh to the middleware"
- "User requested migration from Jest to Vitest, completed in session"
- "Build failed due to missing OPENAI_API_KEY env var"

### 2b. Semantic Memory

**Cognitive analog:** Facts, knowledge, concepts.

**Content:** Factual knowledge about the codebase, technologies, patterns, and
conventions. Timeless truths (or at least long-lived facts) extracted from experience.

**Characteristics:**
- Facts and knowledge, not events
- Moderate decay (7-day half-life)
- Often created by consolidating multiple episodic memories
- High value for cross-session context

**Examples:**
- "This project uses PostgreSQL 16 with pgvector extension"
- "The auth module is in src/middleware/auth.ts and uses JWT tokens"
- "Dependency resolution requires running `bun install` from the mcp/ directory"

### 2c. Procedural Memory

**Cognitive analog:** Skills, habits, how-tos.

**Content:** Patterns, recipes, and procedures for accomplishing tasks. Not what
happened (episodic) or what is true (semantic) but how to do things.

**Characteristics:**
- Most durable memory type (30-day half-life)
- High promotion likelihood (procedures are often cross-project)
- Gained through repeated execution of similar tasks
- Type bonus in importance scoring (+0.1)

**Examples:**
- "To deploy, run `cdk deploy --all` from the infra/ directory"
- "When fixing TypeScript errors, check tsconfig.json paths first"
- "Pattern: error handling in this codebase uses Result<T, E> types, not throw"

### 2d. Working Memory

**Cognitive analog:** Scratchpad / short-term RAM.

**Content:** Temporary task context that exists only for the current task. Partial
results, intermediate reasoning, scratchpad entries.

**Characteristics:**
- Extremely fast decay (~1 hour half-life)
- Never promoted beyond session scope
- Actively written and read during task execution
- Cleared or archived at task completion

**Examples:**
- "Currently investigating the CORS issue on /api/users"
- "Files examined so far: auth.ts, middleware.ts, config.ts"
- "Hypothesis: the timeout is caused by the database connection pool"

### Type Comparison

| Type | Decay Half-Life | Promotion Likelihood | Importance Bonus | Consolidation Target |
|------|----------------|---------------------|-----------------|---------------------|
| Episodic | 1 day | Medium | +0.0 | Summarized into semantic |
| Semantic | 7 days | High | +0.05 | Merged with similar facts |
| Procedural | 30 days | Highest | +0.1 | Refined and generalized |
| Working | ~1 hour | Never | +0.0 | Discarded at task end |

---

## 3. The 3x4 Memory Matrix

Scopes and types combine to create a classification space:

| | Session | Project | User |
|---|---------|---------|------|
| **Episodic** | Current task events, tool outcomes | Past session summaries, debugging stories | Cross-project experiences |
| **Semantic** | Discovered facts about current task | Codebase architecture, conventions, dependencies | Universal tech knowledge |
| **Procedural** | Current task workflows | Build/deploy/test recipes | Personal tool expertise, framework patterns |
| **Working** | Active task state, scratchpad | -- | -- |

Working memories are exclusively session-scoped. The other nine cells are all valid
combinations, with some more common than others. Project-scoped semantic and procedural
memories represent the highest-value steady state.

---

## 4. Lifecycle States

Every memory follows a deterministic lifecycle. State transitions are driven by
time-based decay, access patterns, and consolidation operations.

```
                    ┌──────────────────────────┐
                    │                          │
                    v                          │ (retrieved -- strengthened)
┌─────────┐   ┌─────────┐   ┌──────────────┐  │   ┌────────────┐   ┌────────────┐
│ CREATED │──>│ ACTIVE  │──>│ CONSOLIDATED │──┘──>│  ARCHIVED  │──>│  FORGOTTEN │
└─────────┘   └─────────┘   └──────────────┘      └────────────┘   └────────────┘
     │              │               │                     │
     │         (importance          │                (importance
     │          stays high)    (merged into             < 0.01)
     │              │           summary)
     └──── (importance < 0.1 ──┘
            within 24h -- skip
            to ARCHIVED)
```

### State Definitions

| State | Meaning | Queryable? | Heavy Fields? |
|-------|---------|-----------|--------------|
| `created` | Just stored, not yet accessed | Yes | Full |
| `active` | In regular use, being retrieved | Yes | Full |
| `consolidated` | Merged into a higher-level summary | Yes (low priority) | Full |
| `archived` | Decayed below usefulness threshold | No (by default) | Full |
| `forgotten` | Effectively deleted | No | Cleared (content = `[forgotten]`, embedding = NONE) |

### Transition Rules

**created -> active:** After first retrieval, or automatically after 1 hour.

**active -> consolidated:** When `memory_strength` drops below 0.3 AND the memory has
been accessed at least twice. Queued for consolidation rather than immediately
transitioned -- the consolidation pipeline merges similar memories into summaries.

**active -> archived:** When `memory_strength` drops below 0.1 AND `access_count` < 2.
These are low-value memories that were barely used -- not worth consolidating.

**consolidated -> archived:** After the consolidation pipeline has merged the memory
into a summary. The original memory is kept for audit but deprioritized.

**archived -> forgotten:** When `memory_strength` drops below 0.01. Heavy fields
(content, embedding) are cleared to reclaim storage. The record skeleton remains for
referential integrity.

**Any state -> active (reverse):** If an archived or consolidated memory is retrieved,
its `access_count` increments and `last_accessed_at` updates, which boosts
`memory_strength` through the access-based strengthening formula. If strength
rises above the threshold, the memory returns to active state.

### SurrealQL Lifecycle Events

```surql
-- CREATED -> ACTIVE: after first retrieval
DEFINE EVENT IF NOT EXISTS activate_memory ON TABLE memory
  WHEN $before.status = 'created' AND $after.access_count > 0
THEN {
  UPDATE $after.id SET
    status = 'active',
    status_changed_at = time::now()
  ;
};

-- ACTIVE -> CONSOLIDATED: strength decayed, but memory was used enough to consolidate
DEFINE EVENT IF NOT EXISTS consolidate_memory ON TABLE memory
  WHEN $before.status = 'active'
    AND $after.memory_strength < 0.3
    AND $after.access_count >= 2
THEN {
  CREATE consolidation_queue SET
    memory_id = $after.id,
    reason = 'strength_decay',
    priority = 1.0 - $after.importance,
    created_at = time::now()
  ;
};

-- ACTIVE -> ARCHIVED: low-value memories that were barely used
DEFINE EVENT IF NOT EXISTS archive_weak_memory ON TABLE memory
  WHEN $before.status = 'active'
    AND $after.memory_strength < 0.1
    AND $after.access_count < 2
THEN {
  UPDATE $after.id SET
    status = 'archived',
    status_changed_at = time::now()
  ;
};

-- ARCHIVED -> FORGOTTEN: after extended period with no access
DEFINE EVENT IF NOT EXISTS forget_memory ON TABLE memory
  WHEN $before.status = 'archived'
    AND $after.memory_strength < 0.01
THEN {
  UPDATE $after.id SET
    status = 'forgotten',
    status_changed_at = time::now(),
    content = '[forgotten]',
    embedding = NONE
  ;
};
```

---

## 5. Memory Promotion Pipeline

Promotion moves memories from a lower scope to a higher one: session -> project ->
user. It is the mechanism by which ephemeral session knowledge becomes persistent
project knowledge, and project-specific patterns become universal user knowledge.

### Promotion Criteria

**Session -> Project promotion** (evaluated at session end via Stop hook):

| Criterion | Threshold | Rationale |
|-----------|-----------|-----------|
| Importance | >= 0.5 | Only above-average memories are worth persisting |
| Access count | >= 2 | Must have been retrieved at least twice |
| Memory type | Not `working` | Working memories are scratch space |
| Content uniqueness | No near-duplicate in project scope | Avoid redundancy |

**Project -> User promotion** (evaluated by consolidation agent):

| Criterion | Threshold | Rationale |
|-----------|-----------|-----------|
| Importance | >= 0.7 | Higher bar for cross-project knowledge |
| Access count | >= 5 | Must have consistent value over time |
| Cross-project signal | Seen in 2+ projects | Pattern must recur |
| Memory type | `semantic` or `procedural` | Episodic events rarely generalize |

### Promotion SurrealQL

```surql
-- Promote a memory from session to project scope
DEFINE FUNCTION IF NOT EXISTS fn::promote_to_project(
  $memory_id: record<memory>,
  $project_db: string
) {
  LET $m = (SELECT * FROM ONLY $memory_id);

  -- Check promotion criteria
  IF $m.importance < 0.5 OR $m.access_count < 2 OR $m.memory_type = 'working' {
    RETURN { promoted: false, reason: 'criteria_not_met' };
  };

  -- Create in project scope (cross-database insert would use HTTP API)
  -- In practice, the MCP server handles the cross-database write
  UPDATE $memory_id SET
    scope = 'project',
    metadata.promoted_at = time::now(),
    metadata.promoted_from = 'session',
    updated_at = time::now()
  ;

  RETURN { promoted: true, memory_id: $memory_id };
};
```

### Deduplication During Promotion

Before inserting a promoted memory into the target scope, the system checks for
near-duplicates:

```surql
-- Check for existing similar memory in target scope
LET $candidates = (
  SELECT id, content, tags
  FROM memory
  WHERE scope = $target_scope
    AND status = 'active'
    AND content @1@ $content
    AND search::score(1) > 0.8
  ORDER BY search::score(1) DESC
  LIMIT 3
);

-- If high-similarity match exists, merge instead of creating duplicate
IF array::len($candidates) > 0 {
  -- Merge: update existing memory with new information
  UPDATE $candidates[0].id SET
    access_count += $source.access_count,
    importance = math::max(importance, $source.importance),
    tags = array::union(tags, $source.tags),
    updated_at = time::now(),
    metadata.merged_from += [$source.id]
  ;
} ELSE {
  -- No duplicate: create new memory in target scope
  CREATE memory SET
    content = $source.content,
    memory_type = $source.memory_type,
    scope = $target_scope,
    tags = $source.tags,
    importance = $source.importance,
    created_at = time::now(),
    updated_at = time::now(),
    metadata.promoted_from = $source.scope,
    metadata.promoted_at = time::now()
  ;
};
```

---

## 6. Memory Quality Scoring

### 6.1 Composite Importance Score

Importance is a weighted combination of multiple signals:

```surql
DEFINE FUNCTION IF NOT EXISTS fn::calculate_importance(
  $memory_id: record<memory>
) {
  LET $m = (SELECT * FROM ONLY $memory_id);

  LET $recency = math::exp(-0.1 * duration::days(time::now() - $m.updated_at));
  LET $frequency = math::min(1.0, $m.access_count / 10.0);

  -- Weighted combination
  LET $score = (
    $recency             * 0.25 +
    $frequency           * 0.20 +
    $m.relevance_score   * 0.20 +
    $m.confidence        * 0.15 +
    $m.outcome_impact    * 0.10 +
    $m.user_feedback     * 0.10
  );

  -- Type bonus: procedural memories are more durable
  LET $type_bonus = IF $m.memory_type = 'procedural' { 0.1 }
    ELSE IF $m.memory_type = 'semantic' { 0.05 }
    ELSE { 0.0 };

  RETURN math::min(1.0, $score + $type_bonus);
};
```

### Signal Definitions

| Signal | Range | Source | Weight |
|--------|-------|--------|--------|
| **Recency** | 0-1 | Computed from `updated_at` via exponential decay | 0.25 |
| **Frequency** | 0-1 | `access_count / 10`, capped at 1.0 | 0.20 |
| **Relevance** | 0-1 | Set by retrieval feedback (how useful was this result?) | 0.20 |
| **Confidence** | 0-1 | Initial confidence in the memory's accuracy | 0.15 |
| **Outcome impact** | 0-1 | Did acting on this memory lead to success? | 0.10 |
| **User feedback** | 0-1 | Explicit user signal (rarely used, defaults to 0) | 0.10 |

### 6.2 Exponential Decay with Type-Specific Half-Lives

Memory strength decays exponentially from the last access time, with each memory type
having a different half-life. This models the natural forgetting curve while allowing
different knowledge types to persist at different rates.

```surql
DEFINE FIELD IF NOT EXISTS memory_strength ON memory COMPUTED {
  LET $base = importance;
  LET $half_life = MATCH memory_type {
    'episodic'   => 1.0,     -- 1-day half-life
    'semantic'   => 7.0,     -- 7-day half-life
    'procedural' => 30.0,    -- 30-day half-life
    'working'    => 0.042,   -- ~1 hour half-life
    _ => 3.0                 -- default 3 days
  };

  -- Each access extends effective half-life by 20%
  LET $effective_half_life = $half_life * (1.0 + access_count * 0.2);
  LET $days_elapsed = duration::days(time::now() - last_accessed_at);
  LET $decay = math::exp(-0.693 * $days_elapsed / $effective_half_life);

  RETURN $base * $decay;
};
```

### Decay Curve Examples

For a semantic memory with initial importance 0.8:

| Days Since Access | Access Count = 0 | Access Count = 5 | Access Count = 10 |
|-------------------|-----------------|-----------------|-------------------|
| 0 | 0.80 | 0.80 | 0.80 |
| 7 | 0.40 | 0.57 | 0.64 |
| 14 | 0.20 | 0.41 | 0.51 |
| 30 | 0.06 | 0.21 | 0.32 |
| 60 | 0.005 | 0.06 | 0.13 |

Key insight: each access extends the effective half-life by 20%, so frequently
accessed memories decay much slower. A semantic memory accessed 10 times has an
effective half-life of 21 days instead of 7.

### 6.3 Access-Based Strengthening

When a memory is retrieved, it gets stronger:

```surql
DEFINE FUNCTION IF NOT EXISTS fn::strengthen_on_access(
  $memory_id: record<memory>
) {
  UPDATE $memory_id SET
    access_count += 1,
    last_accessed_at = time::now(),
    updated_at = time::now(),
    -- Boost relevance score slightly (capped at 1.0)
    relevance_score = math::min(1.0, relevance_score + 0.05)
  ;
};
```

This creates a virtuous cycle: useful memories get retrieved more, which strengthens
them, which makes them rank higher in future retrievals, which leads to more access.
Conversely, unused memories decay and eventually archive or forget.

---

## 7. SurrealDB Namespace Mapping

The three scopes map to SurrealDB's native namespace > database hierarchy:

```
SurrealDB Instance (single embedded process)
 |
 +-- Namespace: session
 |    +-- Database: s_01JMXK7A9B...    (current session -- in-memory)
 |
 +-- Namespace: project
 |    +-- Database: p_a1b2c3d4e5f6      (Project A -- persistent)
 |    +-- Database: p_f7g8h9i0j1k2      (Project B -- persistent)
 |
 +-- Namespace: user
      +-- Database: default              (global -- persistent)
```

Each database contains the same table schema (memory, entity, relates_to, etc.) but
with scope-appropriate data. Namespace isolation is enforced at the engine level --
a query in the `session` namespace cannot accidentally read `project` data.

### Cross-Scope Retrieval

When Claude needs context, the system queries all three scopes and merges results
with scope-weighted priority:

```surql
-- Query session scope (highest weight)
LET $session_results = (
  SELECT *, search::score(1) AS relevance, 1.0 AS scope_weight
  FROM memory
  WHERE content @1@ $query AND status = 'active'
  ORDER BY relevance DESC
  LIMIT 5
);

-- Query project scope
LET $project_results = (
  SELECT *, search::score(1) AS relevance, 0.8 AS scope_weight
  FROM memory
  WHERE content @1@ $query AND status = 'active'
  ORDER BY relevance DESC
  LIMIT 5
);

-- Query user scope (lowest weight)
LET $user_results = (
  SELECT *, search::score(1) AS relevance, 0.5 AS scope_weight
  FROM memory
  WHERE content @1@ $query AND status = 'active'
  ORDER BY relevance DESC
  LIMIT 3
);

-- Merge and re-rank by weighted relevance
LET $combined = array::union(
  $session_results,
  array::union($project_results, $user_results)
);

-- In practice, the MCP server handles cross-namespace queries
-- by connecting to each database in sequence
SELECT * FROM $combined ORDER BY (relevance * scope_weight) DESC LIMIT 10;
```

---

## 8. Complete SurrealQL Schema

The following schema is defined in `mcp/src/schema.ts` and applied by
`SurrealDBClient.initSchema()` on startup.

### Analyzer

```surql
DEFINE ANALYZER IF NOT EXISTS memory_analyzer
  TOKENIZERS blank, class
  FILTERS ascii, lowercase, snowball(english);
```

The Snowball English stemmer allows "running" to match "run" and "authentication"
to match "authenticate".

### Memory Table

```surql
DEFINE TABLE IF NOT EXISTS memory SCHEMAFULL;

-- Content fields
DEFINE FIELD IF NOT EXISTS content ON memory TYPE string;
DEFINE FIELD IF NOT EXISTS memory_type ON memory TYPE string
  ASSERT $value IN ['episodic', 'semantic', 'procedural', 'working'];
DEFINE FIELD IF NOT EXISTS scope ON memory TYPE string
  ASSERT $value IN ['session', 'project', 'user'];
DEFINE FIELD IF NOT EXISTS tags ON memory TYPE array<string> DEFAULT [];
DEFINE FIELD IF NOT EXISTS embedding ON memory TYPE option<array<float>>;

-- Quality scores
DEFINE FIELD IF NOT EXISTS importance ON memory TYPE float DEFAULT 0.5;
DEFINE FIELD IF NOT EXISTS confidence ON memory TYPE float DEFAULT 0.7;
DEFINE FIELD IF NOT EXISTS access_count ON memory TYPE int DEFAULT 0;

-- Lifecycle
DEFINE FIELD IF NOT EXISTS status ON memory TYPE string DEFAULT 'active'
  ASSERT $value IN ['active', 'consolidated', 'archived', 'forgotten'];
DEFINE FIELD IF NOT EXISTS source ON memory TYPE option<string>;
DEFINE FIELD IF NOT EXISTS session_id ON memory TYPE option<string>;

-- Timestamps
DEFINE FIELD IF NOT EXISTS created_at ON memory TYPE datetime DEFAULT time::now();
DEFINE FIELD IF NOT EXISTS updated_at ON memory TYPE datetime DEFAULT time::now();
DEFINE FIELD IF NOT EXISTS last_accessed_at ON memory TYPE datetime DEFAULT time::now();

-- Extensible metadata
DEFINE FIELD IF NOT EXISTS metadata ON memory FLEXIBLE TYPE option<object>;

-- Indexes
DEFINE INDEX IF NOT EXISTS memory_scope ON memory FIELDS scope;
DEFINE INDEX IF NOT EXISTS memory_type_idx ON memory FIELDS memory_type;
DEFINE INDEX IF NOT EXISTS memory_status ON memory FIELDS status;
DEFINE INDEX IF NOT EXISTS memory_tags ON memory FIELDS tags;

-- Full-text search (BM25)
DEFINE INDEX IF NOT EXISTS memory_content_search ON memory
  FIELDS content SEARCH ANALYZER memory_analyzer BM25;

-- Vector similarity search (HNSW, Phase 2)
DEFINE INDEX IF NOT EXISTS memory_embedding ON memory
  FIELDS embedding HNSW DIMENSION 384 DIST COSINE;
```

### Entity Table (Knowledge Graph Nodes)

```surql
DEFINE TABLE IF NOT EXISTS entity SCHEMAFULL;

DEFINE FIELD IF NOT EXISTS name ON entity TYPE string;
DEFINE FIELD IF NOT EXISTS entity_type ON entity TYPE string;
DEFINE FIELD IF NOT EXISTS description ON entity TYPE string DEFAULT '';
DEFINE FIELD IF NOT EXISTS embedding ON entity TYPE option<array<float>>;
DEFINE FIELD IF NOT EXISTS mention_count ON entity TYPE int DEFAULT 1;
DEFINE FIELD IF NOT EXISTS confidence ON entity TYPE float DEFAULT 0.7;
DEFINE FIELD IF NOT EXISTS scope ON entity TYPE string;
DEFINE FIELD IF NOT EXISTS created_at ON entity TYPE datetime DEFAULT time::now();
DEFINE FIELD IF NOT EXISTS updated_at ON entity TYPE datetime DEFAULT time::now();

DEFINE INDEX IF NOT EXISTS entity_name ON entity FIELDS name;
DEFINE INDEX IF NOT EXISTS entity_type_idx ON entity FIELDS entity_type;
DEFINE INDEX IF NOT EXISTS entity_embedding ON entity
  FIELDS embedding HNSW DIMENSION 384 DIST COSINE;
```

### Relationship Table (Knowledge Graph Edges)

```surql
DEFINE TABLE IF NOT EXISTS relates_to TYPE RELATION FROM entity TO entity SCHEMAFULL;

DEFINE FIELD IF NOT EXISTS relation_type ON relates_to TYPE string;
DEFINE FIELD IF NOT EXISTS weight ON relates_to TYPE float DEFAULT 0.5;
DEFINE FIELD IF NOT EXISTS confidence ON relates_to TYPE float DEFAULT 0.7;
DEFINE FIELD IF NOT EXISTS scope ON relates_to TYPE string;
DEFINE FIELD IF NOT EXISTS evidence ON relates_to TYPE option<array<string>>;
DEFINE FIELD IF NOT EXISTS created_at ON relates_to TYPE datetime DEFAULT time::now();
```

### Consolidation Queue

```surql
DEFINE TABLE IF NOT EXISTS consolidation_queue SCHEMAFULL;

DEFINE FIELD IF NOT EXISTS memory_id ON consolidation_queue TYPE record<memory>;
DEFINE FIELD IF NOT EXISTS reason ON consolidation_queue TYPE string
  ASSERT $value IN ['decay', 'duplicate', 'promotion', 'merge', 'scheduled'];
DEFINE FIELD IF NOT EXISTS priority ON consolidation_queue TYPE float DEFAULT 0.5;
DEFINE FIELD IF NOT EXISTS status ON consolidation_queue TYPE string DEFAULT 'pending'
  ASSERT $value IN ['pending', 'processing', 'completed', 'failed'];
DEFINE FIELD IF NOT EXISTS created_at ON consolidation_queue TYPE datetime
  DEFAULT time::now();
DEFINE FIELD IF NOT EXISTS processed_at ON consolidation_queue
  TYPE option<datetime>;
```

### Retrieval Log

```surql
DEFINE TABLE IF NOT EXISTS retrieval_log SCHEMAFULL;

DEFINE FIELD IF NOT EXISTS query ON retrieval_log TYPE string;
DEFINE FIELD IF NOT EXISTS strategy ON retrieval_log TYPE string DEFAULT 'bm25';
DEFINE FIELD IF NOT EXISTS results_count ON retrieval_log TYPE int DEFAULT 0;
DEFINE FIELD IF NOT EXISTS memory_ids ON retrieval_log
  TYPE array<record<memory>> DEFAULT [];
DEFINE FIELD IF NOT EXISTS was_useful ON retrieval_log TYPE option<bool>;
DEFINE FIELD IF NOT EXISTS session_id ON retrieval_log TYPE option<string>;
DEFINE FIELD IF NOT EXISTS created_at ON retrieval_log TYPE datetime
  DEFAULT time::now();
```

### Evolution State

```surql
DEFINE TABLE IF NOT EXISTS evolution_state SCHEMAFULL;

DEFINE FIELD IF NOT EXISTS key ON evolution_state TYPE string;
DEFINE FIELD IF NOT EXISTS value ON evolution_state FLEXIBLE TYPE object;
DEFINE FIELD IF NOT EXISTS updated_at ON evolution_state TYPE datetime
  DEFAULT time::now();

DEFINE INDEX IF NOT EXISTS evolution_key ON evolution_state FIELDS key UNIQUE;
```

### Decay-Based Auto-Queuing Event

```surql
DEFINE EVENT IF NOT EXISTS memory_decay_check ON memory
  WHEN $after.status = 'active'
THEN {
  LET $age_days = duration::days(time::now() - $after.created_at);
  LET $since_access = duration::days(time::now() - $after.last_accessed_at);
  IF $age_days > 30 AND $since_access > 14 AND $after.importance < 0.3 THEN
    CREATE consolidation_queue SET
      memory_id = $after.id,
      reason = 'decay',
      priority = 1.0 - $after.importance
  END;
};
```

---

## 9. MemEvolve EURM Framework Mapping

The memory model maps directly to MemEvolve's EURM (Encode, Update/Store, Retrieve,
Manage) decomposition:

| EURM Module | SurrealDB Primitive | Plugin Component |
|-------------|-------------------|-----------------|
| **Encode** | `CREATE memory SET ...` + computed embeddings | PostToolUse hooks, `store_memory` MCP tool |
| **Update/Store** | `UPSERT` + `RELATE` + `DEFINE EVENT` | Consolidation pipeline, deduplication |
| **Retrieve** | HNSW + BM25 + graph traversal + `search::rrf()` | `recall_memories` MCP tool |
| **Manage** | `DEFINE EVENT` triggers + consolidation queue | `memory-consolidator` agent, decay events |

This mapping allows the plugin to evolve its memory architecture over time -- the
retrieval strategy, consolidation thresholds, decay rates, and scoring weights can
all be tuned based on feedback stored in the `retrieval_log` and `evolution_state`
tables. The plugin does not merely accumulate memories; it can adapt *how* it
manages them.
