# Hierarchical Memory Model Design

> **Status:** Architecture specification
> **Date:** 2026-02-23
> **Context:** Claude Code plugin with SurrealDB backend
> **Builds on:** [[Agentic Memory Research Index]], [[SurrealDB Feature Mapping for Agentic Memory]], [[Short-Term and Working Memory Patterns]], [[Long-Term Memory Patterns]], [[Raw Multi-Agent Memory System Design]]
> **Part of:** [[SurrealDB Memory Plugin Architecture Index]]

---

## Table of Contents

- [[#1. Overview and Design Principles]]
- [[#2. Three Memory Scopes]]
  - [[#2a. Session Memory]]
  - [[#2b. Project Memory]]
  - [[#2c. User Memory]]
- [[#3. SurrealDB Namespace and Database Mapping]]
  - [[#3a. Namespace Hierarchy]]
  - [[#3b. Multi-Project Isolation]]
  - [[#3c. Session Lifecycle Management]]
- [[#4. Complete SurrealQL Schemas]]
  - [[#4a. Shared Definitions (All Scopes)]]
  - [[#4b. Session Scope Schema]]
  - [[#4c. Project Scope Schema]]
  - [[#4d. User Scope Schema]]
- [[#5. Memory Promotion and Demotion]]
  - [[#5a. Session to Project Promotion]]
  - [[#5b. Project to User Promotion]]
  - [[#5c. Promotion Criteria and Scoring]]
  - [[#5d. Demotion and Cleanup]]
- [[#6. Cross-Scope Retrieval]]
  - [[#6a. Unified Query Function]]
  - [[#6b. Scope Weighting Strategies]]
  - [[#6c. Deduplication]]
- [[#7. Integration with Claude Code]]
  - [[#7a. Session Initialization]]
  - [[#7b. Hook-Triggered Operations]]
  - [[#7c. Explicit Memory Commands]]
- [[#8. Design Decisions and Rationale]]

---

## 1. Overview and Design Principles

The hierarchical memory model gives Claude Code persistent, contextual memory at three scope levels -- session, project, and user -- each with different lifetimes, storage characteristics, and content types. This mirrors how developers naturally organize knowledge: some things are relevant only to the current task, others to a specific codebase, and others to your personal workflow across all projects.

### Core Principles

1. **Scope isolation by default, sharing by promotion.** Each scope is a separate SurrealDB database. Memory does not leak between scopes unless explicitly promoted.

2. **Ephemeral until proven valuable.** Session memories are born ephemeral. Only memories that meet promotion criteria survive the session. This prevents unbounded memory growth.

3. **Consolidation over accumulation.** As memories move up the hierarchy, they are consolidated -- merged, summarized, deduplicated. Higher scopes contain fewer, higher-quality memories.

4. **Retrieval spans all scopes.** When the agent needs context, it queries all three scopes simultaneously with weighted priority. Session memories are weighted highest (most immediately relevant), then project, then user.

5. **SurrealDB namespaces enforce isolation.** Each scope maps to a SurrealDB namespace. This provides hard isolation at the database engine level, not just application logic.

### Scope Summary

| Property | Session | Project | User |
|----------|---------|---------|------|
| **Lifetime** | Single conversation | Persists across sessions within a project | Persists across all projects |
| **Content** | Working context, tool outcomes, scratchpad, current task state | Codebase architecture, conventions, past decisions, error patterns | Coding style, framework preferences, cross-project patterns, tool expertise |
| **Storage** | In-memory SurrealDB | Persistent on disk (project root) | Persistent on disk (home dir) |
| **SurrealDB namespace** | `session` | `project` | `user` |
| **SurrealDB database** | `{session_id}` | `{project_path_hash}` | `default` |
| **File location** | None (in-memory only) | `.claude/engram/` | `~/.claude/engram/` |
| **Decay rate** | Instant on session end (unless promoted) | Moderate (7-day half-life) | Slow (30-day half-life) |
| **Max memories** | Unbounded during session | ~10,000 per project | ~5,000 global |

---

## 2. Three Memory Scopes

### 2a. Session Memory

Session memory is the working scratchpad for a single Claude Code conversation. It captures everything happening in the current interaction -- what the user asked, what files were examined, what tools were called, what decisions were made, and what intermediate results exist.

**Scope:** Single Claude Code conversation (from session start to session end or timeout).

**Content types:**
- Conversation context and user intent
- Working memory / scratchpad entries (intermediate reasoning, partial results)
- Current task state (active goals, in-progress steps)
- Tool call outcomes (what commands ran, their results)
- File observations (files read, patterns noticed, structure observations)
- Decisions made during the session (and their reasoning)
- Errors encountered and their resolutions

**Storage characteristics:**
- SurrealDB running in-memory mode (no disk persistence)
- Fastest possible read/write latency
- All data lives in RAM -- destroyed when the SurrealDB process exits
- No changefeeds, no file storage -- pure ephemeral working space

**Lifecycle:**
1. **Created** when a Claude Code session starts (the plugin initializes an in-memory SurrealDB namespace)
2. **Active** throughout the conversation -- memories are continuously written and read
3. **Evaluated** on session end (Stop hook or explicit `/remember`) -- promotion criteria are checked
4. **Promoted** selectively -- memories meeting promotion thresholds are copied to project scope
5. **Destroyed** -- the in-memory database is dropped; unpromoted memories are lost

**SurrealDB mapping:**
- Namespace: `session`
- Database: `s_{session_id}` (session ID is a ULID generated at session start)
- Connection: in-process embedded SurrealDB (no network hop)

### 2b. Project Memory

Project memory is the persistent knowledge store for a specific codebase or project directory. It accumulates knowledge across multiple Claude Code sessions within the same project, building a growing understanding of the codebase, its conventions, its history, and its common problems.

**Scope:** All sessions within a git repo or project directory, identified by the `.claude/` directory.

**Content types:**
- Codebase architecture knowledge (module structure, key abstractions, data flow)
- File patterns and conventions (naming, organization, test patterns)
- Build / test / deploy conventions (how to run tests, required env vars)
- Dependency knowledge (which libraries are used, version constraints, known issues)
- Past decisions and their rationale (why X was chosen over Y)
- Common errors and their fixes (patterns that come up repeatedly)
- Team conventions (code style, PR conventions, documentation patterns)
- Entity knowledge graph (projects, files, functions, dependencies and their relationships)

**Storage characteristics:**
- SurrealDB persistent mode using file-backed storage
- Data stored in `.claude/engram/` within the project root
- Survives across sessions, machine reboots, and git operations
- `.gitignore` entry recommended (memory is personal, not shared via git)
- Changefeeds enabled for promotion tracking (7-day retention)

**Lifecycle:**
1. **Created** when the first Claude Code session in a project triggers memory operations
2. **Active** indefinitely -- grows across sessions
3. **Consolidated** periodically -- similar memories are merged, weak ones decay
4. **Promoted** selectively -- patterns that repeat across projects are promoted to user scope
5. **Archived** when memory_strength drops below threshold (kept but deprioritized)
6. **Garbage collected** when archived memories exceed age/count limits

**SurrealDB mapping:**
- Namespace: `project`
- Database: `p_{sha256(canonical_project_path)[:12]}` (deterministic from project path)
- Connection: file-backed embedded SurrealDB
- File location: `{project_root}/.claude/engram/`

### 2c. User Memory

User memory is the highest-level, longest-lived memory store. It captures knowledge that transcends any single project -- personal coding preferences, learned tool expertise, framework knowledge, cross-project patterns, and general workflow intelligence.

**Scope:** All projects, all sessions for this user.

**Content types:**
- User preferences (coding style: tabs vs spaces, preferred frameworks, language preferences)
- Learned tool expertise (which MCP tools work well, common pitfalls with specific tools)
- Personal knowledge graph (technologies known, skill levels, learning history)
- Cross-project patterns (architectural patterns that recur, common debugging approaches)
- Framework/library knowledge (API patterns, gotchas, best practices learned from experience)
- Environment knowledge (OS quirks, shell configuration, development environment setup)

**Storage characteristics:**
- SurrealDB persistent mode using file-backed storage
- Data stored in `~/.claude/engram/`
- Survives across all projects and sessions
- Backed up with home directory backups
- Changefeeds enabled (30-day retention)

**Lifecycle:**
1. **Created** on first use of the memory plugin
2. **Active** indefinitely -- the longest-lived memory store
3. **Consolidated** aggressively -- user memory is the most compressed scope
4. **Never deleted** unless the user explicitly resets (even weak memories are retained at low priority)

**SurrealDB mapping:**
- Namespace: `user`
- Database: `default`
- Connection: file-backed embedded SurrealDB
- File location: `~/.claude/engram/`

---

## 3. SurrealDB Namespace and Database Mapping

### 3a. Namespace Hierarchy

The complete SurrealDB instance topology for a user with three active projects and one active session:

```
SurrealDB Instance (embedded, single process)
 |
 +-- Namespace: session
 |    |
 |    +-- Database: s_01JMXK7A9B...    (current active session -- in-memory)
 |
 +-- Namespace: project
 |    |
 |    +-- Database: p_a1b2c3d4e5f6      (Project A -- persistent)
 |    +-- Database: p_f7g8h9i0j1k2      (Project B -- persistent)
 |    +-- Database: p_l3m4n5o6p7q8      (Project C -- persistent)
 |
 +-- Namespace: user
      |
      +-- Database: default              (User memory -- persistent)
```

**Why three namespaces instead of one namespace with multiple databases?**

SurrealDB namespaces provide the strongest isolation boundary. Different namespaces cannot share data, cannot reference each other's tables, and cannot have cross-namespace permissions. This is exactly what we want:

- Session memory is ephemeral and should have no persistent footprint
- Project memory is scoped to a directory and should not leak to other projects
- User memory is global and should be accessible regardless of which project is active

The plugin manages cross-namespace operations at the application level (promotion, cross-scope retrieval).

### 3b. Multi-Project Isolation

Each project gets its own database within the `project` namespace, identified by a hash of the canonical project path:

```surql
-- Project database naming convention:
-- p_{sha256(realpath(project_root))[:12]}
--
-- Examples:
-- /Users/alice/code/my-api       -> p_a1b2c3d4e5f6
-- /Users/alice/code/my-frontend  -> p_f7g8h9i0j1k2
-- /home/alice/work/backend       -> p_l3m4n5o6p7q8
```

**Why hash the path?**

1. Paths can contain characters invalid in SurrealDB identifiers
2. Paths can be very long; hashes are fixed length
3. Canonical paths (`realpath`) handle symlinks and relative paths
4. 12-character hex prefix gives 48 bits of entropy (collision probability negligible for personal use)

**Project metadata table** (in each project database) stores the mapping back to human-readable info:

```surql
USE NS project DB p_a1b2c3d4e5f6;

DEFINE TABLE project_meta SCHEMAFULL;
DEFINE FIELD project_path   ON project_meta TYPE string;
DEFINE FIELD project_name   ON project_meta TYPE string;
DEFINE FIELD git_remote     ON project_meta TYPE option<string>;
DEFINE FIELD first_session  ON project_meta TYPE datetime DEFAULT time::now();
DEFINE FIELD last_session   ON project_meta TYPE datetime VALUE time::now();
DEFINE FIELD session_count  ON project_meta TYPE int DEFAULT 0;
DEFINE FIELD total_memories ON project_meta TYPE int DEFAULT 0;
```

### 3c. Session Lifecycle Management

Session databases are ephemeral. They are created at session start and destroyed at session end.

**Session creation flow:**

```surql
-- 1. Generate session ID (ULID for time-ordering)
-- Done in application code: session_id = ulid()

-- 2. Create session database (in-memory)
USE NS session;
DEFINE DATABASE s_01JMXK7A9B3C4D5E6F7G8H;

-- 3. Initialize schema (see Section 4b)
USE NS session DB s_01JMXK7A9B3C4D5E6F7G8H;
-- ... schema definitions ...

-- 4. Register session in project database
USE NS project DB p_a1b2c3d4e5f6;
CREATE session_registry SET
    session_id = "s_01JMXK7A9B3C4D5E6F7G8H",
    started_at = time::now(),
    status = "active";
```

**Session teardown flow:**

```surql
-- 1. Run promotion evaluation (see Section 5)
-- Application code evaluates session memories for promotion

-- 2. Promote qualifying memories to project scope
-- (cross-namespace copy, see Section 5a)

-- 3. Update session registry
USE NS project DB p_a1b2c3d4e5f6;
UPDATE session_registry SET
    status = "completed",
    ended_at = time::now(),
    memories_promoted = $promoted_count
WHERE session_id = "s_01JMXK7A9B3C4D5E6F7G8H";

-- 4. Drop session database
USE NS session;
REMOVE DATABASE s_01JMXK7A9B3C4D5E6F7G8H;
```

**Handling unclean exits:**

If Claude Code crashes or the session is interrupted without a clean shutdown:

1. On next session start, the plugin checks the `session_registry` for `status = "active"` entries
2. If an active session database still exists in the `session` namespace, it runs a recovery promotion pass
3. If the session database was already lost (process died), the session is marked as `abandoned`

```surql
-- Recovery check on session start
USE NS project DB p_a1b2c3d4e5f6;
SELECT * FROM session_registry
    WHERE status = "active"
    AND started_at < time::now() - 24h;
-- Any results indicate abandoned sessions
```

---

## 4. Complete SurrealQL Schemas

### 4a. Shared Definitions (All Scopes)

These definitions are deployed into every database across all three namespaces. They provide the common foundation.

```surql
-- =============================================================
-- SHARED DEFINITIONS -- deployed to all scope databases
-- =============================================================

-- Text analyzer for full-text search (English-optimized)
DEFINE ANALYZER memory_analyzer
    TOKENIZERS blank, class
    FILTERS lowercase, snowball(english);

-- =============================================================
-- Core memory table: the universal memory record
-- Every memory at every scope level uses this table.
-- Fields vary by scope (some are optional), but the base
-- structure is identical to enable cross-scope operations.
-- =============================================================

DEFINE TABLE memory SCHEMAFULL;

-- Identity
DEFINE FIELD memory_id      ON memory TYPE string
    COMMENT "ULID -- unique across all scopes, stable through promotion";
DEFINE FIELD scope          ON memory TYPE string
    ASSERT $value IN ["session", "project", "user"]
    COMMENT "Which scope this memory currently lives in";
DEFINE FIELD memory_type    ON memory TYPE string
    ASSERT $value IN [
        "observation",      -- something noticed about the codebase or environment
        "decision",         -- a choice made and its rationale
        "pattern",          -- a recurring pattern (code, workflow, error)
        "convention",       -- a project or user convention
        "fact",             -- a learned fact about a tool, library, or system
        "preference",       -- a user preference or style choice
        "error_fix",        -- an error encountered and how it was resolved
        "architecture",     -- codebase structure or design knowledge
        "procedure",        -- a learned multi-step workflow or strategy
        "entity",           -- a named entity (person, project, technology)
        "scratchpad",       -- ephemeral working state (session only)
        "tool_outcome"      -- result of a tool invocation (session only)
    ];

-- Content
DEFINE FIELD content        ON memory TYPE string
    COMMENT "Natural language description of the memory";
DEFINE FIELD summary        ON memory TYPE option<string>
    COMMENT "One-line summary for quick display and search";
DEFINE FIELD structured     ON memory TYPE option<object> FLEXIBLE
    COMMENT "Typed structured data associated with this memory";

-- Embedding for semantic retrieval
DEFINE FIELD embedding      ON memory TYPE option<array<float>>
    COMMENT "Vector embedding of content for semantic search";

-- Provenance
DEFINE FIELD source_session ON memory TYPE option<string>
    COMMENT "Session ID where this memory was first created";
DEFINE FIELD source_project ON memory TYPE option<string>
    COMMENT "Project database ID where this memory originated";
DEFINE FIELD promoted_from  ON memory TYPE option<record<memory>>
    COMMENT "Link to the lower-scope memory this was promoted from";
DEFINE FIELD promotion_chain ON memory TYPE option<array<object>>
    COMMENT "History: [{scope, memory_id, promoted_at}]";

-- Memory dynamics
DEFINE FIELD importance     ON memory TYPE float DEFAULT 0.5
    ASSERT $value >= 0.0 AND $value <= 1.0;
DEFINE FIELD confidence     ON memory TYPE float DEFAULT 0.5
    ASSERT $value >= 0.0 AND $value <= 1.0;
DEFINE FIELD access_count   ON memory TYPE int DEFAULT 0;
DEFINE FIELD last_accessed  ON memory TYPE datetime DEFAULT time::now();
DEFINE FIELD created_at     ON memory TYPE datetime DEFAULT time::now() READONLY;
DEFINE FIELD updated_at     ON memory TYPE datetime VALUE time::now();

-- Tags and categorization
DEFINE FIELD tags           ON memory TYPE option<set<string>>;
DEFINE FIELD domain         ON memory TYPE option<string>
    COMMENT "Knowledge domain: python, aws, testing, git, etc.";

-- Lifecycle
DEFINE FIELD status         ON memory TYPE string
    DEFAULT "active"
    ASSERT $value IN ["active", "consolidated", "archived", "promoted"];

-- Computed: memory strength with time decay
-- Base half-life varies by scope (set differently per scope deployment)
-- Default: 7-day half-life (project scope)
DEFINE FIELD memory_strength ON memory
    COMPUTED math::round(
        importance * confidence * math::pow(
            0.5,
            duration::days(time::now() - last_accessed)
                / (7.0 * (1.0 + <float>access_count * 0.15))
        ) * 1000.0
    ) / 1000.0;

-- Computed: staleness indicator
DEFINE FIELD is_stale ON memory
    COMPUTED status = "active"
        AND last_accessed < time::now() - 30d
        AND access_count < 3;

-- =============================================================
-- INDEXES (common to all scopes)
-- =============================================================

-- Semantic search via HNSW
DEFINE INDEX idx_memory_embedding ON memory
    FIELDS embedding
    HNSW DIMENSION 1536 DIST COSINE TYPE F32;

-- Full-text search on content
DEFINE INDEX idx_memory_content ON memory
    FIELDS content
    SEARCH ANALYZER memory_analyzer BM25;

-- Full-text search on summary
DEFINE INDEX idx_memory_summary ON memory
    FIELDS summary
    SEARCH ANALYZER memory_analyzer BM25;

-- Structured lookups
DEFINE INDEX idx_memory_type ON memory FIELDS memory_type, status;
DEFINE INDEX idx_memory_domain ON memory FIELDS domain, status;
DEFINE INDEX idx_memory_tags ON memory FIELDS tags;
DEFINE INDEX idx_memory_importance ON memory FIELDS importance;
DEFINE INDEX idx_memory_created ON memory FIELDS created_at;
DEFINE INDEX idx_memory_id ON memory FIELDS memory_id UNIQUE;

-- =============================================================
-- RELATION TABLES (knowledge graph edges)
-- =============================================================

-- General association between memories
DEFINE TABLE relates_to TYPE RELATION FROM memory TO memory SCHEMAFULL;
DEFINE FIELD relation_type  ON relates_to TYPE string
    ASSERT $value IN [
        "similar_to",       -- semantically similar memories
        "contradicts",      -- conflicting information
        "supersedes",       -- newer version of an older memory
        "derived_from",     -- extracted or inferred from another memory
        "supports",         -- provides evidence for another memory
        "part_of",          -- component of a larger concept
        "caused_by",        -- causal relationship
        "related_to"        -- general association
    ];
DEFINE FIELD strength       ON relates_to TYPE float DEFAULT 0.5
    ASSERT $value >= 0.0 AND $value <= 1.0;
DEFINE FIELD created_at     ON relates_to TYPE datetime DEFAULT time::now();
DEFINE FIELD metadata       ON relates_to TYPE option<object> FLEXIBLE;

DEFINE INDEX idx_relates_type ON relates_to FIELDS relation_type;

-- =============================================================
-- ENTITY TABLE (named entities in the knowledge graph)
-- =============================================================

DEFINE TABLE entity SCHEMAFULL;
DEFINE FIELD name           ON entity TYPE string;
DEFINE FIELD entity_type    ON entity TYPE string
    ASSERT $value IN [
        "file", "function", "class", "module", "package",
        "technology", "person", "project", "service",
        "concept", "tool", "custom"
    ];
DEFINE FIELD description    ON entity TYPE option<string>;
DEFINE FIELD embedding      ON entity TYPE option<array<float>>;
DEFINE FIELD attributes     ON entity TYPE option<object> FLEXIBLE;
DEFINE FIELD mention_count  ON entity TYPE int DEFAULT 1;
DEFINE FIELD created_at     ON entity TYPE datetime DEFAULT time::now();
DEFINE FIELD updated_at     ON entity TYPE datetime VALUE time::now();

DEFINE INDEX idx_entity_name_type ON entity FIELDS name, entity_type UNIQUE;
DEFINE INDEX idx_entity_embedding ON entity
    FIELDS embedding
    HNSW DIMENSION 1536 DIST COSINE TYPE F32;

-- Memory-to-entity linkage
DEFINE TABLE mentions TYPE RELATION FROM memory TO entity SCHEMAFULL;
DEFINE FIELD context        ON mentions TYPE option<string>;
DEFINE FIELD created_at     ON mentions TYPE datetime DEFAULT time::now();

-- =============================================================
-- COMMON FUNCTIONS
-- =============================================================

-- Hybrid search: combine semantic + keyword retrieval
DEFINE FUNCTION fn::hybrid_search(
    $query_text: string,
    $query_embedding: array,
    $k: int,
    $min_strength: float
) {
    LET $semantic = SELECT id, memory_id, content, summary, memory_type,
            importance, memory_strength,
            vector::distance::knn() AS distance
        FROM memory
        WHERE status = "active"
            AND memory_strength >= $min_strength
            AND embedding <|$k, 100|> $query_embedding;

    LET $keyword = SELECT id, memory_id, content, summary, memory_type,
            importance, memory_strength,
            search::score(1) AS ft_score
        FROM memory
        WHERE status = "active"
            AND memory_strength >= $min_strength
            AND content @1@ $query_text
        ORDER BY ft_score DESC
        LIMIT $k;

    RETURN search::rrf([$semantic, $keyword], $k, 60);
};

-- Recall and strengthen: every retrieval makes the memory more durable
DEFINE FUNCTION fn::recall($memory_id: string) {
    UPDATE memory SET
        access_count += 1,
        last_accessed = time::now()
    WHERE memory_id = $memory_id AND status = "active";

    RETURN (SELECT *,
        ->relates_to->memory.{memory_id, summary, memory_type} AS related,
        ->mentions->entity.{name, entity_type} AS entities
    FROM memory
    WHERE memory_id = $memory_id);
};

-- Store a new memory with optional entity linkage
DEFINE FUNCTION fn::store_memory(
    $memory_id: string,
    $scope: string,
    $memory_type: string,
    $content: string,
    $summary: option<string>,
    $embedding: option<array>,
    $importance: float,
    $confidence: float,
    $domain: option<string>,
    $tags: option<set<string>>,
    $structured: option<object>,
    $source_session: option<string>,
    $source_project: option<string>
) {
    CREATE memory CONTENT {
        memory_id: $memory_id,
        scope: $scope,
        memory_type: $memory_type,
        content: $content,
        summary: $summary,
        embedding: $embedding,
        importance: $importance,
        confidence: $confidence,
        domain: $domain,
        tags: $tags,
        structured: $structured,
        source_session: $source_session,
        source_project: $source_project,
        status: "active"
    };
};
```

### 4b. Session Scope Schema

Deployed into each session database. Extends the shared schema with session-specific tables and adjusted behaviors.

```surql
-- =============================================================
-- SESSION SCOPE SCHEMA
-- Deployed to: NS session DB s_{session_id}
-- =============================================================

-- Override memory_strength for session scope:
-- No time decay during session (all memories are equally fresh).
-- Strength is purely importance * confidence.
REMOVE FIELD memory_strength ON memory;
DEFINE FIELD memory_strength ON memory
    COMPUTED math::round(importance * confidence * 1000.0) / 1000.0;

-- =============================================================
-- Session metadata
-- =============================================================

DEFINE TABLE session_meta SCHEMAFULL;
DEFINE FIELD session_id     ON session_meta TYPE string;
DEFINE FIELD project_db     ON session_meta TYPE option<string>
    COMMENT "Project database ID this session belongs to";
DEFINE FIELD project_path   ON session_meta TYPE option<string>;
DEFINE FIELD started_at     ON session_meta TYPE datetime DEFAULT time::now();
DEFINE FIELD last_active    ON session_meta TYPE datetime VALUE time::now();
DEFINE FIELD memory_count   ON session_meta TYPE int DEFAULT 0;

-- =============================================================
-- Conversation turns (raw context tracking)
-- =============================================================

DEFINE TABLE turn SCHEMAFULL;
DEFINE FIELD turn_number    ON turn TYPE int;
DEFINE FIELD role           ON turn TYPE string
    ASSERT $value IN ["user", "assistant", "system", "tool"];
DEFINE FIELD content        ON turn TYPE string;
DEFINE FIELD embedding      ON turn TYPE option<array<float>>;
DEFINE FIELD token_count    ON turn TYPE int DEFAULT 0;
DEFINE FIELD created_at     ON turn TYPE datetime DEFAULT time::now();
DEFINE FIELD extracted      ON turn TYPE bool DEFAULT false
    COMMENT "Whether memories have been extracted from this turn";
DEFINE FIELD metadata       ON turn TYPE option<object> FLEXIBLE;

DEFINE INDEX idx_turn_number ON turn FIELDS turn_number;
DEFINE INDEX idx_turn_embedding ON turn
    FIELDS embedding
    HNSW DIMENSION 1536 DIST COSINE TYPE F32;

-- =============================================================
-- Tool invocation log (detailed tool call tracking)
-- =============================================================

DEFINE TABLE tool_call SCHEMAFULL;
DEFINE FIELD tool_name      ON tool_call TYPE string;
DEFINE FIELD arguments      ON tool_call TYPE option<object> FLEXIBLE;
DEFINE FIELD result_summary ON tool_call TYPE option<string>;
DEFINE FIELD success        ON tool_call TYPE bool DEFAULT true;
DEFINE FIELD duration_ms    ON tool_call TYPE option<int>;
DEFINE FIELD turn_ref       ON tool_call TYPE option<record<turn>>;
DEFINE FIELD created_at     ON tool_call TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_tool_name ON tool_call FIELDS tool_name;

-- =============================================================
-- Session-specific events
-- =============================================================

-- Auto-update session meta on memory creation
DEFINE EVENT update_session_meta ON TABLE memory
    WHEN $event = "CREATE"
    THEN {
        UPDATE session_meta SET
            memory_count += 1,
            last_active = time::now()
        LIMIT 1;
    };

-- =============================================================
-- Session-specific functions
-- =============================================================

-- Get promotion candidates: memories worth preserving
DEFINE FUNCTION fn::get_promotion_candidates($min_importance: float) {
    RETURN (SELECT memory_id, memory_type, content, summary,
            importance, confidence, access_count, tags, domain,
            embedding, structured, memory_strength
        FROM memory
        WHERE status = "active"
            AND memory_type NOT IN ["scratchpad", "tool_outcome"]
            AND importance >= $min_importance
        ORDER BY memory_strength DESC
        LIMIT 50);
};

-- Get session summary for promotion context
DEFINE FUNCTION fn::get_session_summary() {
    LET $meta = SELECT * FROM session_meta LIMIT 1;
    LET $memory_stats = SELECT
            memory_type,
            count() AS count,
            math::mean(importance) AS avg_importance
        FROM memory
        WHERE status = "active"
        GROUP BY memory_type;
    LET $tool_stats = SELECT
            tool_name,
            count() AS count,
            math::sum(IF success THEN 1 ELSE 0 END) AS successes
        FROM tool_call
        GROUP BY tool_name;

    RETURN {
        session: $meta[0],
        memory_breakdown: $memory_stats,
        tool_usage: $tool_stats,
        total_turns: (SELECT VALUE count() FROM turn GROUP ALL)[0],
        total_memories: (SELECT VALUE count() FROM memory GROUP ALL)[0]
    };
};
```

### 4c. Project Scope Schema

Deployed into each project database. Extends the shared schema with project-specific tables, consolidation logic, and promotion tracking.

```surql
-- =============================================================
-- PROJECT SCOPE SCHEMA
-- Deployed to: NS project DB p_{hash}
-- =============================================================

-- Memory strength uses 7-day half-life (already the default in shared schema)
-- No override needed.

-- Enable changefeeds for promotion tracking
DEFINE TABLE memory CHANGEFEED 7d INCLUDE ORIGINAL;

-- =============================================================
-- Project metadata
-- =============================================================

DEFINE TABLE project_meta SCHEMAFULL;
DEFINE FIELD project_path   ON project_meta TYPE string;
DEFINE FIELD project_name   ON project_meta TYPE string;
DEFINE FIELD git_remote     ON project_meta TYPE option<string>;
DEFINE FIELD first_session  ON project_meta TYPE datetime DEFAULT time::now();
DEFINE FIELD last_session   ON project_meta TYPE datetime VALUE time::now();
DEFINE FIELD session_count  ON project_meta TYPE int DEFAULT 0;
DEFINE FIELD total_memories ON project_meta TYPE int DEFAULT 0;

-- =============================================================
-- Session registry (tracks all sessions in this project)
-- =============================================================

DEFINE TABLE session_registry SCHEMAFULL;
DEFINE FIELD session_id     ON session_registry TYPE string;
DEFINE FIELD started_at     ON session_registry TYPE datetime DEFAULT time::now();
DEFINE FIELD ended_at       ON session_registry TYPE option<datetime>;
DEFINE FIELD status         ON session_registry TYPE string
    DEFAULT "active"
    ASSERT $value IN ["active", "completed", "abandoned"];
DEFINE FIELD memories_promoted ON session_registry TYPE int DEFAULT 0;
DEFINE FIELD summary        ON session_registry TYPE option<string>
    COMMENT "LLM-generated summary of what happened in this session";

DEFINE INDEX idx_session_status ON session_registry FIELDS status;
DEFINE INDEX idx_session_id ON session_registry FIELDS session_id UNIQUE;

-- =============================================================
-- Promotion log (tracks what was promoted from sessions)
-- =============================================================

DEFINE TABLE promotion_log SCHEMAFULL;
DEFINE FIELD source_session ON promotion_log TYPE string;
DEFINE FIELD memory_id      ON promotion_log TYPE string;
DEFINE FIELD original_type  ON promotion_log TYPE string;
DEFINE FIELD promoted_at    ON promotion_log TYPE datetime DEFAULT time::now();
DEFINE FIELD promotion_reason ON promotion_log TYPE string
    COMMENT "Why this memory was promoted: importance, explicit, pattern_match";
DEFINE FIELD merged_into    ON promotion_log TYPE option<string>
    COMMENT "If merged with existing project memory, the target memory_id";

DEFINE INDEX idx_promo_session ON promotion_log FIELDS source_session;
DEFINE INDEX idx_promo_memory ON promotion_log FIELDS memory_id;

-- =============================================================
-- Consolidation tracking
-- =============================================================

DEFINE TABLE consolidation_log SCHEMAFULL;
DEFINE FIELD consolidated_at ON consolidation_log TYPE datetime DEFAULT time::now();
DEFINE FIELD source_count   ON consolidation_log TYPE int;
DEFINE FIELD result_count   ON consolidation_log TYPE int;
DEFINE FIELD source_ids     ON consolidation_log TYPE array<string>;
DEFINE FIELD result_ids     ON consolidation_log TYPE array<string>;
DEFINE FIELD method         ON consolidation_log TYPE string
    ASSERT $value IN ["merge_similar", "summarize_cluster", "decay_archive"];

-- =============================================================
-- Project-specific events
-- =============================================================

-- Update project meta on memory creation
DEFINE EVENT update_project_meta ON TABLE memory
    WHEN $event = "CREATE"
    THEN {
        UPDATE project_meta SET
            total_memories += 1,
            last_session = time::now()
        LIMIT 1;
    };

-- Flag for consolidation when unconsolidated memories exceed threshold
DEFINE EVENT consolidation_check ON TABLE memory
    WHEN $event = "CREATE"
    THEN {
        LET $count = (SELECT VALUE count()
            FROM memory
            WHERE status = "active"
            GROUP ALL);
        IF $count[0] > 500 {
            -- Create consolidation request if none pending
            LET $pending = (SELECT VALUE count()
                FROM consolidation_request
                WHERE status = "pending"
                GROUP ALL);
            IF $pending[0] IS NONE OR $pending[0] = 0 {
                CREATE consolidation_request SET
                    requested_at = time::now(),
                    status = "pending",
                    reason = "memory_count_threshold";
            };
        };
    };

DEFINE TABLE consolidation_request SCHEMAFULL;
DEFINE FIELD requested_at   ON consolidation_request TYPE datetime DEFAULT time::now();
DEFINE FIELD status         ON consolidation_request TYPE string DEFAULT "pending"
    ASSERT $value IN ["pending", "in_progress", "completed", "failed"];
DEFINE FIELD reason         ON consolidation_request TYPE string;
DEFINE FIELD completed_at   ON consolidation_request TYPE option<datetime>;

-- =============================================================
-- Project-specific functions
-- =============================================================

-- Find memories similar to a candidate (for merge-on-promotion)
DEFINE FUNCTION fn::find_similar_memories(
    $query_embedding: array,
    $similarity_threshold: float,
    $k: int
) {
    RETURN (SELECT id, memory_id, content, summary, memory_type,
            importance, confidence, memory_strength,
            vector::distance::knn() AS distance
        FROM memory
        WHERE status = "active"
            AND embedding <|$k, 100|> $query_embedding
        ORDER BY distance);
};

-- Get memories ready for user-scope promotion
-- (patterns that appear across multiple sessions)
DEFINE FUNCTION fn::get_user_promotion_candidates($min_sessions: int) {
    RETURN (SELECT memory_id, memory_type, content, summary,
            importance, confidence, access_count,
            source_session, tags, domain, embedding,
            memory_strength
        FROM memory
        WHERE status = "active"
            AND access_count >= $min_sessions
            AND importance >= 0.7
            AND memory_type IN [
                "pattern", "convention", "preference",
                "procedure", "fact"
            ]
        ORDER BY memory_strength DESC
        LIMIT 20);
};

-- Archive weak memories
DEFINE FUNCTION fn::archive_weak_memories($threshold: float) {
    UPDATE memory SET status = "archived"
    WHERE status = "active"
        AND memory_strength < $threshold
        AND created_at < time::now() - 30d;
};
```

### 4d. User Scope Schema

Deployed into the user's global database. Extends the shared schema with user-specific tables, cross-project tracking, and the slowest decay rate.

```surql
-- =============================================================
-- USER SCOPE SCHEMA
-- Deployed to: NS user DB default
-- =============================================================

-- Override memory_strength for user scope: 30-day half-life
REMOVE FIELD memory_strength ON memory;
DEFINE FIELD memory_strength ON memory
    COMPUTED math::round(
        importance * confidence * math::pow(
            0.5,
            duration::days(time::now() - last_accessed)
                / (30.0 * (1.0 + <float>access_count * 0.2))
        ) * 1000.0
    ) / 1000.0;

-- Enable changefeeds for audit
DEFINE TABLE memory CHANGEFEED 30d INCLUDE ORIGINAL;

-- =============================================================
-- User profile (preferences and settings)
-- =============================================================

DEFINE TABLE user_profile SCHEMAFULL;
DEFINE FIELD username       ON user_profile TYPE option<string>;
DEFINE FIELD created_at     ON user_profile TYPE datetime DEFAULT time::now();
DEFINE FIELD last_active    ON user_profile TYPE datetime VALUE time::now();
DEFINE FIELD total_sessions ON user_profile TYPE int DEFAULT 0;
DEFINE FIELD total_projects ON user_profile TYPE int DEFAULT 0;
DEFINE FIELD settings       ON user_profile TYPE option<object> FLEXIBLE
    COMMENT "User-configurable plugin settings";

-- =============================================================
-- Project registry (tracks all known projects)
-- =============================================================

DEFINE TABLE project_registry SCHEMAFULL;
DEFINE FIELD project_db     ON project_registry TYPE string
    COMMENT "The database ID in the project namespace";
DEFINE FIELD project_path   ON project_registry TYPE string;
DEFINE FIELD project_name   ON project_registry TYPE string;
DEFINE FIELD git_remote     ON project_registry TYPE option<string>;
DEFINE FIELD first_seen     ON project_registry TYPE datetime DEFAULT time::now();
DEFINE FIELD last_seen      ON project_registry TYPE datetime VALUE time::now();
DEFINE FIELD session_count  ON project_registry TYPE int DEFAULT 0;
DEFINE FIELD memory_count   ON project_registry TYPE int DEFAULT 0;

DEFINE INDEX idx_project_db ON project_registry FIELDS project_db UNIQUE;
DEFINE INDEX idx_project_path ON project_registry FIELDS project_path UNIQUE;

-- =============================================================
-- Cross-project pattern tracking
-- =============================================================

DEFINE TABLE cross_project_pattern SCHEMAFULL;
DEFINE FIELD memory_id      ON cross_project_pattern TYPE string
    COMMENT "The user-scope memory this pattern tracks";
DEFINE FIELD source_projects ON cross_project_pattern TYPE array<string>
    COMMENT "Project database IDs where this pattern was observed";
DEFINE FIELD observation_count ON cross_project_pattern TYPE int DEFAULT 1;
DEFINE FIELD first_observed ON cross_project_pattern TYPE datetime DEFAULT time::now();
DEFINE FIELD last_observed  ON cross_project_pattern TYPE datetime VALUE time::now();

DEFINE INDEX idx_pattern_memory ON cross_project_pattern FIELDS memory_id UNIQUE;

-- =============================================================
-- User-specific events
-- =============================================================

-- Track cross-project patterns when memories are promoted
DEFINE EVENT track_cross_project ON TABLE memory
    WHEN $event = "CREATE" AND $after.source_project IS NOT NONE
    THEN {
        -- Check if a similar memory already exists (promoted from a different project)
        LET $similar = SELECT memory_id FROM memory
            WHERE memory_id != $after.memory_id
                AND status = "active"
                AND memory_type = $after.memory_type
                AND embedding IS NOT NONE
                AND $after.embedding IS NOT NONE
                AND embedding <|3, 50|> $after.embedding;

        -- If similar memories exist from different projects, record the cross-project pattern
        FOR $match IN $similar {
            LET $existing = SELECT * FROM cross_project_pattern
                WHERE memory_id = $match.memory_id LIMIT 1;
            IF array::len($existing) > 0 {
                UPDATE cross_project_pattern SET
                    source_projects = array::union(source_projects, [$after.source_project]),
                    observation_count += 1
                WHERE memory_id = $match.memory_id;
            };
        };
    };

-- =============================================================
-- User-specific functions
-- =============================================================

-- Get user preferences by domain
DEFINE FUNCTION fn::get_preferences($domain: option<string>) {
    IF $domain IS NOT NONE {
        RETURN (SELECT memory_id, content, summary, importance,
                confidence, memory_strength
            FROM memory
            WHERE status = "active"
                AND memory_type = "preference"
                AND domain = $domain
            ORDER BY memory_strength DESC);
    } ELSE {
        RETURN (SELECT memory_id, content, summary, importance,
                confidence, memory_strength, domain
            FROM memory
            WHERE status = "active"
                AND memory_type = "preference"
            ORDER BY memory_strength DESC);
    };
};

-- Get cross-project patterns (most valuable user memories)
DEFINE FUNCTION fn::get_cross_project_patterns($min_projects: int) {
    LET $patterns = SELECT * FROM cross_project_pattern
        WHERE array::len(source_projects) >= $min_projects
        ORDER BY observation_count DESC;

    RETURN (SELECT memory.*,
            cross_project_pattern.source_projects,
            cross_project_pattern.observation_count
        FROM $patterns
        JOIN memory ON memory.memory_id = cross_project_pattern.memory_id);
};
```

---

## 5. Memory Promotion and Demotion

Promotion is the mechanism by which valuable memories move from lower scopes to higher scopes. It is the key differentiator between a stateless tool and an intelligent assistant that learns over time.

### 5a. Session to Project Promotion

**When it triggers:**
1. **Stop hook** -- when a Claude Code session ends cleanly
2. **Explicit command** -- when the user invokes `/remember` or a similar command
3. **Importance threshold** -- when a memory's importance exceeds 0.8 during the session (immediate promotion)

**Promotion process:**

```surql
-- =============================================================
-- SESSION -> PROJECT PROMOTION
-- Executed by the plugin at session end or on /remember
-- =============================================================

-- Step 1: Get promotion candidates from session
-- (executed against NS session DB s_{session_id})
USE NS session DB s_01JMXK7A9B3C4D5E6F7G8H;

LET $candidates = fn::get_promotion_candidates(0.6);
-- Returns memories with importance >= 0.6 that are not scratchpad/tool_outcome

-- Step 2: For each candidate, check for duplicates in project scope
-- (executed against NS project DB p_{hash})
-- This is done in application code because SurrealDB cannot cross namespaces

-- Step 3: Promote or merge
-- For each candidate:
```

The application-level promotion logic:

```
FOR each candidate in session_candidates:
    1. Query project DB: fn::find_similar_memories(candidate.embedding, 0.85, 5)
    2. IF similar memory exists with cosine similarity > 0.85:
        a. MERGE: Update existing project memory
           - Increase access_count
           - Update importance = max(existing.importance, candidate.importance)
           - Append to promotion_chain
           - Strengthen confidence
        b. Log merge in promotion_log
    3. ELSE:
        a. CREATE new memory in project DB
           - Copy all fields from session memory
           - Set scope = "project"
           - Set source_session = session_id
           - Set promoted_from = session memory record
           - Add to promotion_chain
        b. Log creation in promotion_log
    4. Update session memory status = "promoted"
```

**Promotion SurrealQL (executed in project database):**

```surql
-- Promote a memory from session to project (new or merge)
DEFINE FUNCTION fn::promote_from_session(
    $memory_id: string,
    $memory_type: string,
    $content: string,
    $summary: option<string>,
    $embedding: option<array>,
    $importance: float,
    $confidence: float,
    $domain: option<string>,
    $tags: option<set<string>>,
    $structured: option<object>,
    $source_session: string,
    $promotion_reason: string
) {
    -- Check for existing similar memory
    LET $similar = IF $embedding IS NOT NONE {
        (SELECT id, memory_id, content, importance, confidence,
                access_count, promotion_chain,
                vector::distance::knn() AS distance
            FROM memory
            WHERE status = "active"
                AND embedding <|3, 50|> $embedding
            ORDER BY distance
            LIMIT 1)
    } ELSE {
        []
    };

    -- Decide: merge or create
    IF array::len($similar) > 0 AND $similar[0].distance < 0.15 {
        -- MERGE with existing memory (cosine distance < 0.15 means similarity > 0.85)
        LET $target = $similar[0];
        UPDATE $target.id SET
            importance = math::max([importance, $importance]),
            confidence = math::min([confidence + 0.05, 1.0]),
            access_count += 1,
            last_accessed = time::now(),
            promotion_chain = array::append(
                promotion_chain ?? [],
                {
                    scope: "session",
                    memory_id: $memory_id,
                    promoted_at: time::now(),
                    action: "merged"
                }
            );

        -- Log the merge
        CREATE promotion_log SET
            source_session = $source_session,
            memory_id = $memory_id,
            original_type = $memory_type,
            promotion_reason = $promotion_reason,
            merged_into = $target.memory_id;

        RETURN { action: "merged", target: $target.memory_id };
    } ELSE {
        -- CREATE new project memory
        LET $new = fn::store_memory(
            $memory_id,
            "project",
            $memory_type,
            $content,
            $summary,
            $embedding,
            $importance,
            $confidence,
            $domain,
            $tags,
            $structured,
            $source_session,
            NONE
        );

        -- Log the promotion
        CREATE promotion_log SET
            source_session = $source_session,
            memory_id = $memory_id,
            original_type = $memory_type,
            promotion_reason = $promotion_reason;

        RETURN { action: "created", memory_id: $memory_id };
    };
};
```

### 5b. Project to User Promotion

**When it triggers:**
1. **Cross-session pattern detection** -- when a memory has been accessed in 3+ different sessions
2. **Explicit command** -- when the user says "remember this for all projects" or similar
3. **Consolidation job** -- periodic consolidation identifies cross-project patterns

**Promotion criteria:**
- Memory accessed in >= 3 different sessions (`access_count >= 3`)
- Memory importance >= 0.7
- Memory type is one of: `pattern`, `convention`, `preference`, `procedure`, `fact`
- Memory is not project-specific (e.g., not a specific file path reference)

**Promotion SurrealQL (executed in user database):**

```surql
-- Promote a memory from project to user scope
DEFINE FUNCTION fn::promote_from_project(
    $memory_id: string,
    $memory_type: string,
    $content: string,
    $summary: option<string>,
    $embedding: option<array>,
    $importance: float,
    $confidence: float,
    $domain: option<string>,
    $tags: option<set<string>>,
    $structured: option<object>,
    $source_project: string,
    $promotion_reason: string
) {
    -- Check for existing similar memory at user scope
    LET $similar = IF $embedding IS NOT NONE {
        (SELECT id, memory_id, content, importance, confidence,
                access_count, promotion_chain,
                vector::distance::knn() AS distance
            FROM memory
            WHERE status = "active"
                AND embedding <|3, 50|> $embedding
            ORDER BY distance
            LIMIT 1)
    } ELSE {
        []
    };

    IF array::len($similar) > 0 AND $similar[0].distance < 0.15 {
        -- MERGE: this pattern was already known from another project
        LET $target = $similar[0];
        UPDATE $target.id SET
            importance = math::max([importance, $importance]),
            confidence = math::min([confidence + 0.1, 1.0]),
            access_count += 1,
            last_accessed = time::now(),
            promotion_chain = array::append(
                promotion_chain ?? [],
                {
                    scope: "project",
                    memory_id: $memory_id,
                    source_project: $source_project,
                    promoted_at: time::now(),
                    action: "merged"
                }
            );

        -- Track cross-project observation
        UPSERT cross_project_pattern SET
            memory_id = $target.memory_id,
            source_projects = array::union(
                (SELECT VALUE source_projects FROM cross_project_pattern
                    WHERE memory_id = $target.memory_id)[0] ?? [],
                [$source_project]
            ),
            observation_count += 1
        WHERE memory_id = $target.memory_id;

        RETURN { action: "merged", target: $target.memory_id };
    } ELSE {
        -- CREATE new user memory
        fn::store_memory(
            $memory_id,
            "user",
            $memory_type,
            $content,
            $summary,
            $embedding,
            $importance,
            $confidence,
            $domain,
            $tags,
            $structured,
            NONE,
            $source_project
        );

        -- Initialize cross-project tracking
        CREATE cross_project_pattern SET
            memory_id = $memory_id,
            source_projects = [$source_project],
            observation_count = 1;

        RETURN { action: "created", memory_id: $memory_id };
    };
};
```

### 5c. Promotion Criteria and Scoring

The promotion score determines whether a memory is worth promoting. It combines multiple signals:

```surql
-- Promotion scoring function
-- Returns a score from 0.0 to 1.0
DEFINE FUNCTION fn::promotion_score(
    $importance: float,
    $confidence: float,
    $access_count: int,
    $memory_type: string,
    $has_embedding: bool
) {
    -- Base score from importance and confidence
    LET $base = ($importance * 0.4) + ($confidence * 0.3);

    -- Access frequency bonus (logarithmic)
    LET $freq_bonus = math::min([math::log($access_count + 1, 10) / 2.0, 0.2]);

    -- Type bonus: some types are more promotion-worthy
    LET $type_bonus = IF $memory_type IN ["pattern", "convention", "procedure"] {
        0.1
    } ELSE IF $memory_type IN ["decision", "error_fix", "architecture"] {
        0.08
    } ELSE IF $memory_type IN ["preference", "fact"] {
        0.06
    } ELSE {
        0.0
    };

    -- Embedding bonus: memories with embeddings are more useful (searchable)
    LET $embed_bonus = IF $has_embedding { 0.05 } ELSE { 0.0 };

    RETURN math::min([$base + $freq_bonus + $type_bonus + $embed_bonus, 1.0]);
};
```

**Promotion thresholds:**

| Transition | Score Threshold | Additional Conditions |
|------------|----------------|----------------------|
| Session -> Project (auto) | >= 0.6 | Not scratchpad or tool_outcome |
| Session -> Project (explicit `/remember`) | Any | User-triggered, always promotes |
| Session -> Project (immediate) | >= 0.85 | Promotes during session, not just at end |
| Project -> User (auto) | >= 0.7 | Accessed in 3+ sessions, not project-specific |
| Project -> User (explicit) | Any | User-triggered |

### 5d. Demotion and Cleanup

Memories do not demote (move from higher to lower scope). Instead, weak memories are gradually archived and eventually garbage collected within their scope.

```surql
-- Archive weak memories at project scope
-- Run periodically (e.g., after every 10th session)
DEFINE FUNCTION fn::project_maintenance() {
    -- Archive memories with very low strength
    LET $archived = UPDATE memory SET status = "archived"
    WHERE status = "active"
        AND memory_strength < 0.05
        AND created_at < time::now() - 14d
        AND access_count < 2;

    -- Delete very old archived memories
    LET $deleted = DELETE FROM memory
    WHERE status = "archived"
        AND updated_at < time::now() - 90d;

    -- Clean up orphaned entities
    LET $orphan_entities = SELECT id FROM entity
    WHERE id NOT IN (
        SELECT VALUE out FROM mentions WHERE out IS NOT NONE
    )
    AND created_at < time::now() - 30d;

    FOR $e IN $orphan_entities {
        DELETE $e.id;
    };

    RETURN {
        archived: array::len($archived),
        deleted: array::len($deleted),
        orphans_cleaned: array::len($orphan_entities)
    };
};

-- User scope maintenance (more conservative -- rarely deletes)
DEFINE FUNCTION fn::user_maintenance() {
    -- Archive but never auto-delete at user scope
    UPDATE memory SET status = "archived"
    WHERE status = "active"
        AND memory_strength < 0.02
        AND created_at < time::now() - 90d
        AND access_count < 2;
};
```

---

## 6. Cross-Scope Retrieval

The most critical operation: when the agent needs context, it searches all three scopes simultaneously and returns a unified, deduplicated, weighted result set.

### 6a. Unified Query Function

Cross-scope retrieval is implemented at the application layer because SurrealDB cannot query across namespaces in a single query. The plugin executes parallel queries against each scope and merges the results.

**Application-level pseudocode:**

```
FUNCTION cross_scope_retrieve(query_text, query_embedding, k, weights):
    // 1. Query all three scopes in parallel
    session_results = query_scope("session", session_db, query_text, query_embedding, k)
    project_results = query_scope("project", project_db, query_text, query_embedding, k)
    user_results    = query_scope("user", "default", query_text, query_embedding, k)

    // 2. Apply scope weights to scores
    FOR result IN session_results: result.weighted_score *= weights.session
    FOR result IN project_results: result.weighted_score *= weights.project
    FOR result IN user_results:    result.weighted_score *= weights.user

    // 3. Merge and deduplicate
    all_results = merge(session_results, project_results, user_results)
    deduplicated = deduplicate(all_results, similarity_threshold=0.90)

    // 4. Sort by weighted score and return top k
    RETURN sort(deduplicated, by=weighted_score, desc=true)[:k]
```

**Per-scope query (executed in each scope's database):**

```surql
-- Per-scope retrieval function
-- Called for each scope during cross-scope retrieval
DEFINE FUNCTION fn::scope_retrieve(
    $query_text: string,
    $query_embedding: array,
    $k: int,
    $min_strength: float,
    $type_filter: option<array<string>>
) {
    -- Hybrid search (semantic + keyword)
    LET $semantic = SELECT id, memory_id, scope, memory_type, content,
            summary, importance, confidence, memory_strength,
            embedding, tags, domain,
            vector::distance::knn() AS distance
        FROM memory
        WHERE status = "active"
            AND memory_strength >= $min_strength
            AND embedding <|$k, 100|> $query_embedding;

    LET $keyword = SELECT id, memory_id, scope, memory_type, content,
            summary, importance, confidence, memory_strength,
            embedding, tags, domain,
            search::score(1) AS ft_score
        FROM memory
        WHERE status = "active"
            AND memory_strength >= $min_strength
            AND content @1@ $query_text
        ORDER BY ft_score DESC
        LIMIT $k;

    LET $fused = search::rrf([$semantic, $keyword], $k, 60);

    -- Apply type filter if specified
    IF $type_filter IS NOT NONE {
        RETURN (SELECT * FROM $fused
            WHERE memory_type IN $type_filter
            LIMIT $k);
    } ELSE {
        RETURN (SELECT * FROM $fused LIMIT $k);
    };
};
```

### 6b. Scope Weighting Strategies

Different retrieval contexts call for different scope weights:

| Context | Session Weight | Project Weight | User Weight | Rationale |
|---------|---------------|----------------|-------------|-----------|
| **Default** | 0.50 | 0.35 | 0.15 | Current context is most relevant |
| **Codebase question** | 0.20 | 0.60 | 0.20 | Project knowledge dominates |
| **Personal preference** | 0.10 | 0.20 | 0.70 | User memory is authoritative |
| **Error debugging** | 0.40 | 0.40 | 0.20 | Both current context and past project errors matter |
| **New project** | 0.30 | 0.10 | 0.60 | No project memory yet; lean on user experience |
| **Architecture discussion** | 0.15 | 0.65 | 0.20 | Project structure knowledge dominates |

```surql
-- Scope weight profiles stored in user database
USE NS user DB default;

DEFINE TABLE scope_weight_profile SCHEMAFULL;
DEFINE FIELD profile_name   ON scope_weight_profile TYPE string;
DEFINE FIELD session_weight  ON scope_weight_profile TYPE float;
DEFINE FIELD project_weight  ON scope_weight_profile TYPE float;
DEFINE FIELD user_weight     ON scope_weight_profile TYPE float;
DEFINE FIELD description    ON scope_weight_profile TYPE option<string>;

DEFINE INDEX idx_profile_name ON scope_weight_profile FIELDS profile_name UNIQUE;

-- Initialize default profiles
CREATE scope_weight_profile SET
    profile_name = "default",
    session_weight = 0.50,
    project_weight = 0.35,
    user_weight = 0.15,
    description = "General-purpose retrieval, current context weighted highest";

CREATE scope_weight_profile SET
    profile_name = "codebase",
    session_weight = 0.20,
    project_weight = 0.60,
    user_weight = 0.20,
    description = "Codebase-focused queries, project knowledge dominates";

CREATE scope_weight_profile SET
    profile_name = "preferences",
    session_weight = 0.10,
    project_weight = 0.20,
    user_weight = 0.70,
    description = "Personal preference queries, user memory is authoritative";

CREATE scope_weight_profile SET
    profile_name = "debugging",
    session_weight = 0.40,
    project_weight = 0.40,
    user_weight = 0.20,
    description = "Error debugging, both current and historical context matter";

CREATE scope_weight_profile SET
    profile_name = "new_project",
    session_weight = 0.30,
    project_weight = 0.10,
    user_weight = 0.60,
    description = "New project with no history, lean on user experience";

CREATE scope_weight_profile SET
    profile_name = "architecture",
    session_weight = 0.15,
    project_weight = 0.65,
    user_weight = 0.20,
    description = "Architecture discussions, project structure knowledge dominates";
```

### 6c. Deduplication

When the same knowledge exists at multiple scopes (e.g., a session memory that was also promoted to project scope), deduplication prevents returning redundant results.

**Deduplication strategy:**

1. **Memory ID match** -- if `memory_id` is identical across scopes, keep only the highest-scope version (user > project > session) unless the lower-scope version has been updated more recently
2. **Semantic similarity** -- if two memories from different scopes have cosine similarity > 0.90, keep the one with higher `memory_strength`
3. **Merge metadata** -- when deduplicating, merge tags and note which scopes contained the memory

```surql
-- Deduplication helper function (used in application-level merge)
-- Given two memories, decide which to keep
DEFINE FUNCTION fn::dedup_winner(
    $mem_a_scope: string,
    $mem_a_strength: float,
    $mem_a_updated: datetime,
    $mem_b_scope: string,
    $mem_b_strength: float,
    $mem_b_updated: datetime
) {
    -- Scope priority: user > project > session
    LET $scope_rank = {
        "user": 3,
        "project": 2,
        "session": 1
    };

    -- If same scope, prefer stronger memory
    IF $mem_a_scope = $mem_b_scope {
        RETURN IF $mem_a_strength >= $mem_b_strength { "a" } ELSE { "b" };
    };

    -- Different scopes: prefer higher scope unless lower is significantly stronger
    LET $a_rank = $scope_rank[$mem_a_scope];
    LET $b_rank = $scope_rank[$mem_b_scope];

    IF $a_rank > $b_rank {
        -- A is higher scope; keep A unless B is 2x stronger
        RETURN IF $mem_b_strength > $mem_a_strength * 2.0 { "b" } ELSE { "a" };
    } ELSE {
        RETURN IF $mem_a_strength > $mem_b_strength * 2.0 { "a" } ELSE { "b" };
    };
};
```

---

## 7. Integration with Claude Code

### 7a. Session Initialization

When a Claude Code session starts in a project directory, the plugin:

1. Generates a session ULID
2. Creates the session database in the `session` namespace (in-memory)
3. Deploys the shared schema + session schema
4. Connects to the project database (creates if first session in this project)
5. Connects to the user database (creates if first use)
6. Loads recent project context and relevant user preferences into session memory
7. Registers the session in the project's `session_registry`

```
SESSION START SEQUENCE:
    session_id = generate_ulid()

    // Session scope setup
    surreal.query("USE NS session; DEFINE DATABASE s_{session_id}")
    surreal.query("USE NS session DB s_{session_id}")
    deploy_shared_schema()
    deploy_session_schema()

    // Project scope setup
    project_hash = sha256(realpath(cwd))[:12]
    project_db = "p_" + project_hash
    surreal.query("USE NS project; DEFINE DATABASE {project_db}")  // no-op if exists
    surreal.query("USE NS project DB {project_db}")
    IF first_session:
        deploy_shared_schema()
        deploy_project_schema()
        initialize_project_meta(cwd)

    // User scope setup
    surreal.query("USE NS user; DEFINE DATABASE default")  // no-op if exists
    surreal.query("USE NS user DB default")
    IF first_use:
        deploy_shared_schema()
        deploy_user_schema()
        initialize_user_profile()

    // Pre-load context
    recent_project_memories = project_db.query(fn::hybrid_search(
        session_context, session_embedding, 10, 0.1))
    user_preferences = user_db.query(fn::get_preferences(detect_domain(cwd)))

    // Seed session with pre-loaded context
    FOR memory IN recent_project_memories + user_preferences:
        session_db.query(fn::store_memory(..., scope="session", ...))

    // Register session
    project_db.query(CREATE session_registry SET session_id = session_id, ...)
```

### 7b. Hook-Triggered Operations

The memory system integrates with Claude Code hooks to capture events automatically:

| Hook | Memory Operation |
|------|-----------------|
| **PreToolUse** | Log tool invocation intent; pre-fetch relevant memories |
| **PostToolUse** | Record tool outcome; extract observations |
| **Stop** | Run promotion evaluation; promote qualifying memories; generate session summary |
| **SubagentStop** | Collect subagent discoveries for promotion consideration |

### 7c. Explicit Memory Commands

Users can interact with memory through slash commands:

| Command | Action |
|---------|--------|
| `/remember` | Promote current session context to project memory |
| `/remember-all` | Promote to both project and user memory |
| `/forget <query>` | Archive matching memories (soft delete) |
| `/memory` | Show memory statistics across all scopes |
| `/memory search <query>` | Search across all scopes with results grouped by scope |
| `/memory inspect <id>` | Show full details of a specific memory |

---

## 8. Design Decisions and Rationale

### Why three scopes instead of two or four?

Three scopes map to the natural boundaries of developer workflow:

- **Two scopes** (session + persistent) would conflate project-specific and user-global knowledge. A convention learned in project A would pollute project B.
- **Four scopes** (adding team/org) adds complexity without clear benefit for a personal tool. Team memory can be added later as a fourth scope without changing the architecture.
- **Three scopes** align with Claude Code's existing concept hierarchy: a session has a working directory (project), and the user has global settings (`~/.claude/`).

### Why SurrealDB namespaces for isolation instead of table prefixes?

Namespaces provide engine-level isolation: different storage paths, independent schema evolution, no accidental cross-contamination. Table prefixes (`session_memory`, `project_memory`) would share the same database, making it impossible to use different storage modes (in-memory for session vs persistent for project) and making cleanup harder (dropping a namespace is atomic; deleting by prefix is not).

### Why a unified `memory` table across scopes instead of scope-specific tables?

A single `memory` table with a `scope` field enables:
1. The same promotion functions work for all transitions
2. Cross-scope deduplication can compare fields directly
3. Schema evolution happens once, not three times
4. The knowledge graph edges (`relates_to`, `mentions`) work identically at all scopes

The cost is that some fields are unused in some scopes (e.g., `source_session` is always null in user scope). This is an acceptable tradeoff for operational simplicity.

### Why hybrid search (semantic + keyword) as the default?

Neither vector search nor keyword search alone is optimal. A developer asking "how do I run the tests?" benefits from both:
- **Semantic search** finds memories about testing even if the exact words differ
- **Keyword search** finds memories containing "test" or "pytest" that might be semantically distant

SurrealDB's built-in `search::rrf` fusion eliminates the need for external fusion logic, making hybrid search essentially free.

### Why promotion instead of replication?

Promotion (move + transform) is better than replication (copy everything) because:
1. Higher scopes should contain consolidated, high-quality memories -- not raw dumps
2. Unbounded replication would cause memory growth proportional to total sessions
3. Promotion criteria act as a quality filter, keeping higher scopes clean
4. Merge-on-promotion (deduplication during promotion) prevents redundancy

### Why not use SurrealDB's built-in auth for scope isolation?

For a single-user plugin running embedded SurrealDB, full authentication (JWT, DEFINE ACCESS) adds complexity without benefit. The plugin process is the only client. Namespace isolation provides the separation guarantee. If multi-user support is added later, auth can be layered on without changing the schema.

---

## See Also

- [[SurrealDB Feature Mapping for Agentic Memory]] -- detailed feature-to-use-case mapping
- [[Short-Term and Working Memory Patterns]] -- session memory pattern foundations
- [[Long-Term Memory Patterns]] -- project/user memory pattern foundations
- [[Raw Multi-Agent Memory System Design]] -- multi-agent namespacing patterns
- [[Knowledge Graph Patterns with SurrealDB]] -- entity/relation schema patterns

---

*Architecture specification compiled: 2026-02-23 | Part of the SurrealDB Memory Plugin design series*
