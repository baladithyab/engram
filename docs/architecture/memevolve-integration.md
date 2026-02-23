# MemEvolve Integration — How the Plugin Implements Evolving Memory

This document maps the MemEvolve EURM framework (Encode, Update/Store, Retrieve, Manage)
to the plugin's hook pipeline, explaining how memory evolves across sessions and scopes.

## The EURM Framework

MemEvolve (Zhang et al., 2025) decomposes any memory system into four modules:

```
    Raw Experience                   Current Task Context
         │                                │
         ▼                                │
    ┌─────────┐                           │
    │ ENCODE  │ Transform experience      │
    │   (E)   │ into structured memory    │
    └────┬────┘                           │
         │                                ▼
         ▼                          ┌───────────┐
    ┌─────────┐                     │ RETRIEVE  │ Select relevant
    │ UPDATE/ │ Integrate into      │    (R)    │ memories for
    │ STORE   │ persistent store    └─────┬─────┘ current query
    │   (U)   │                           │
    └────┬────┘                           │
         │                                ▼
         ▼                          ┌─────────────┐
    ┌─────────────────────────────┐ │ TASK OUTPUT │
    │        MEMORY STATE         │ └─────────────┘
    │ (session/project/user DBs)  │
    └────────────┬────────────────┘
                 │
                 ▼
            ┌─────────┐
            │ MANAGE  │ Consolidation, promotion,
            │   (G)   │ pruning, decay
            └─────────┘
```

## Plugin Hook → EURM Mapping

### ENCODE (E) — Transforming Experience into Memory

| Hook | EURM Role | What It Encodes |
|------|-----------|----------------|
| **Stop** (prompt) | Primary encoder | Session learnings → structured memories with type/scope/tags |
| **PostToolUse** (Write/Edit) | Background encoder | File changes → episodic memories |
| **PostToolUse** (Bash error) | Background encoder | Errors → episodic memories with error context |
| **TaskCompleted** (prompt) | Subagent encoder | Subagent discoveries → project memories |
| **PreCompact** (command) | Emergency encoder | Context about to be lost → session memories |

The Stop hook follows the full ENCODE pipeline:
1. Review session activity
2. Classify each item by type (episodic/semantic/procedural)
3. Assign scope (session/project/user) based on generalizability
4. Set importance based on impact (0.3 for trivia, 0.8 for architecture decisions)
5. Tag with keywords for retrieval

### UPDATE/STORE (U) — Integrating into Persistent Store

Every `store_memory` call routes to the correct SurrealDB database based on scope:

```
store_memory(scope="session")  →  DB: s_{session_id}     (ephemeral)
store_memory(scope="project")  →  DB: p_{project_hash}   (persistent)
store_memory(scope="user")     →  DB: u_{user_hash}      (global)
```

The schema is identical across all three databases — same tables, indexes, events.
Each database is fully isolated within the same SurrealDB namespace.

**Deduplication**: Before storing, the system checks for existing memories with
similar content (future: cosine similarity on embeddings > 0.85). If a duplicate
exists, the existing memory is strengthened rather than creating a new one.

### RETRIEVE (R) — Selecting Relevant Memories

| Hook | EURM Role | What It Retrieves |
|------|-----------|-------------------|
| **SessionStart** (command) | Context primer | Injects memory system awareness into session |
| **SubagentStart** (prompt) | Subagent briefing | Relevant memories for the subagent's task |
| **recall_memories** MCP tool | On-demand retrieval | Cross-scope search with priority weighting |

Cross-scope retrieval searches all three databases in parallel and merges results:

```
Search("authentication patterns")
  ├─ session DB → 2 results × 1.5 weight (most relevant to current work)
  ├─ project DB → 5 results × 1.0 weight (codebase knowledge)
  └─ user DB   → 1 result  × 0.7 weight (general knowledge)

  Final: 8 results, sorted by weighted relevance, top N returned
```

**Access-based strengthening**: Every retrieval bumps `access_count` and
`last_accessed_at`, extending the memory's effective half-life by 20%.
This implements the "testing effect" from cognitive science — recalled
memories become stronger.

### MANAGE (G) — Lifecycle, Consolidation, Decay

| Hook/Tool | EURM Role | What It Manages |
|-----------|-----------|----------------|
| **Stop** hook | Promotion pipeline | Session → project promotion on session end |
| **TeammateIdle** hook | Opportunistic maintenance | Assigns consolidation to idle agents |
| `reflect_and_consolidate` tool | Full pipeline | Promote, archive, deduplicate |
| `forget_memory` tool | Manual pruning | User-directed forgetting |
| Computed `memory_strength` | Automatic decay | Exponential decay per memory type |

#### Memory Lifecycle State Machine

```
active → consolidated → archived → forgotten
  │          │              │           │
  │     (summarized     (low          (cleanup:
  │      from multiple   importance,   clear embedding
  │      episodes)       no access)    and content)
  │
  └── promotion ──→ higher scope
      (session→project, project→user)
```

#### Promotion Criteria

**Session → Project** (triggered by Stop hook):
- importance ≥ 0.5 OR access_count ≥ 2
- memory_type in [semantic, procedural, episodic]
- Not a duplicate of existing project memory (cosine similarity < 0.85)

**Project → User** (triggered by reflect_and_consolidate):
- Accessed in 3+ different sessions
- importance ≥ 0.7
- memory_type in [semantic, procedural]
- Represents a generalizable pattern (not project-specific)

#### Exponential Decay

Memory strength decays based on type:

```
strength = importance × exp(-0.693 × days / effective_half_life)
effective_half_life = base_half_life × (1 + access_count × 0.2)
```

| Memory Type | Base Half-Life | After 5 accesses |
|-------------|---------------|-------------------|
| working | 1 hour | 2 hours |
| episodic | 1 day | 2 days |
| semantic | 7 days | 14 days |
| procedural | 30 days | 60 days |

This mirrors cognitive science:
- Procedural memory (skills) is most durable
- Episodic memory (events) fades fastest
- Frequently accessed memories become permanent

## Session Lifecycle — Complete EURM Flow

```
┌─ SESSION START ──────────────────────────────────────────┐
│                                                          │
│  [Setup hook]     Initialize DB if first run             │
│  [SessionStart]   RETRIEVE: inject memory context        │
│                                                          │
├─ SESSION ACTIVE ─────────────────────────────────────────┤
│                                                          │
│  [User works]     RETRIEVE: recall_memories as needed    │
│  [PostToolUse]    ENCODE: log file changes and errors    │
│  [SubagentStart]  RETRIEVE: brief subagents with memory  │
│  [TaskCompleted]  ENCODE: capture subagent discoveries   │
│  [TeammateIdle]   MANAGE: assign consolidation work      │
│                                                          │
├─ PRE-COMPACT (if context gets large) ────────────────────┤
│                                                          │
│  [PreCompact]     ENCODE: save critical context before   │
│                   compaction destroys it                  │
│                                                          │
├─ POST-COMPACT ───────────────────────────────────────────┤
│                                                          │
│  [User continues] RETRIEVE: recall_memories to recover   │
│                   saved context                          │
│                                                          │
├─ SESSION END ────────────────────────────────────────────┤
│                                                          │
│  [Stop hook]      ENCODE: store session learnings        │
│                   UPDATE: strengthen accessed memories    │
│                   MANAGE: promote, consolidate, archive   │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

## Cross-Session Evolution

Over multiple sessions, the memory system evolves:

1. **Session 1**: Claude discovers "this project uses React 18 with TypeScript strict mode"
   - Stored as: semantic, project scope, importance 0.7

2. **Session 2**: Claude recalls this fact (access_count → 2, strength grows)

3. **Session 5**: Claude discovers the same pattern in another project
   - Project memory promoted to user scope (accessed across projects)

4. **Session 10**: Stale project memories from session 1 that were never accessed
   - Decay drops importance below 0.1
   - reflect_and_consolidate archives them

5. **Session 20**: Related episodic memories consolidated into semantic summary
   - 5 separate "fixed auth bug" episodes → 1 semantic "common auth patterns"

This implements MemEvolve's key insight: **the memory system improves not just by
accumulating content, but by restructuring and consolidating what it knows.**

## References

- [MemEvolve Paper Analysis](../research/memevolve-paper-analysis.md)
- [Self-Evolving Memory Design](../research/self-evolving-memory-design.md)
- [Hierarchical Memory Model](../research/hierarchical-memory-model.md)
- [Long-Term Memory Patterns](../../docs/research/surrealdb-feature-mapping.md)
