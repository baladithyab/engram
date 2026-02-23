# Self-Evolving Memory Design

> **Part of:** [[Implementation Blueprint and Index]]
> **Builds on:** [[MemEvolve Paper Analysis]], [[Long-Term Memory Patterns]], [[Hierarchical Memory Model Design]]
> **Date:** 2026-02-23

---

## 1. Design Philosophy

Static memory systems accumulate content but never change their architecture. Inspired by MemEvolve's **meta-evolutionary framework** (Zhang et al., 2025), this design makes the memory system itself adaptive:

- Memory **content** evolves through consolidation, decay, and strengthening
- Memory **structure** evolves through knowledge graph restructuring
- Memory **retrieval** evolves through strategy adaptation based on feedback
- Memory **architecture** evolves through periodic self-reflection

The EURM framework (Encode, Update/Store, Retrieve, Manage) maps directly to SurrealDB primitives:

| EURM Module | SurrealDB Primitive | Plugin Component |
|-------------|-------------------|-----------------|
| **Encode** | CREATE + computed embeddings | PostToolUse hooks, MCP `store_memory` |
| **Update/Store** | UPSERT + RELATE + DEFINE EVENT | Consolidation pipeline |
| **Retrieve** | HNSW + BM25 + graph traversal + search::rrf | MCP `recall_memories` |
| **Manage** | DEFINE EVENT triggers + scheduled functions | memory-consolidator agent |

---

## 2. Memory Lifecycle State Machine

Every memory record follows a deterministic lifecycle:

```
                    ┌──────────────────────────┐
                    │                          │
                    ▼                          │ (retrieved → strengthened)
┌─────────┐   ┌─────────┐   ┌──────────────┐   │   ┌────────────┐   ┌────────────┐
│ CREATED │──▶│ ACTIVE  │──▶│ CONSOLIDATED │───┘──▶│  ARCHIVED  │──▶│  FORGOTTEN │
└─────────┘   └─────────┘   └──────────────┘       └────────────┘   └────────────┘
     │              │               │                     │
     │         (importance          │                (importance
     │          stays high)    (merged into             < 0.01)
     │              │           summary)
     └──── (importance < 0.1 ──┘
            within 24h → skip
            to ARCHIVED)
```

### SurrealQL Schema

```surql
-- Lifecycle status enum via field assertion
DEFINE FIELD status ON memory ASSERT $value IN [
    'created', 'active', 'consolidated', 'archived', 'forgotten'
];

DEFINE FIELD status_history ON memory TYPE array<object> DEFAULT [];
DEFINE FIELD status_changed_at ON memory TYPE datetime DEFAULT time::now();
```

### Lifecycle Transition Events

```surql
-- CREATED → ACTIVE: after first retrieval or after 1 hour
DEFINE EVENT activate_memory ON TABLE memory WHEN
    $before.status = 'created' AND $after.access_count > 0
THEN {
    UPDATE $after.id SET
        status = 'active',
        status_changed_at = time::now(),
        status_history += { from: 'created', to: 'active', at: time::now() }
    ;
};

-- ACTIVE → CONSOLIDATED: when memory_strength drops below threshold
-- AND memory has been accessed enough times to have value
DEFINE EVENT consolidate_memory ON TABLE memory WHEN
    $before.status = 'active'
    AND $after.memory_strength < 0.3
    AND $after.access_count >= 2
THEN {
    -- Queue for consolidation rather than immediate transition
    CREATE consolidation_queue SET
        memory_id = $after.id,
        reason = 'strength_decay',
        strength_at_queue = $after.memory_strength,
        queued_at = time::now()
    ;
};

-- ACTIVE → ARCHIVED: low-value memories that were barely used
DEFINE EVENT archive_weak_memory ON TABLE memory WHEN
    $before.status = 'active'
    AND $after.memory_strength < 0.1
    AND $after.access_count < 2
THEN {
    UPDATE $after.id SET
        status = 'archived',
        status_changed_at = time::now(),
        status_history += { from: 'active', to: 'archived', at: time::now() }
    ;
};

-- ARCHIVED → FORGOTTEN: after extended period with no access
DEFINE EVENT forget_memory ON TABLE memory WHEN
    $before.status = 'archived'
    AND $after.memory_strength < 0.01
THEN {
    UPDATE $after.id SET
        status = 'forgotten',
        status_changed_at = time::now(),
        status_history += { from: 'archived', to: 'forgotten', at: time::now() },
        -- Clear heavy fields to save space
        embedding = NONE,
        content = '[forgotten]'
    ;
};
```

---

## 3. Memory Quality Scoring

### 3.1 Importance Score

A composite score combining multiple signals:

```surql
DEFINE FIELD importance ON memory TYPE float DEFAULT 0.5;

-- Component scores (updated by events and retrieval)
DEFINE FIELD recency_score ON memory COMPUTED
    math::exp(-0.1 * duration::days(time::now() - updated_at));

DEFINE FIELD frequency_score ON memory COMPUTED
    math::min(1.0, access_count / 10.0);

DEFINE FIELD relevance_score ON memory TYPE float DEFAULT 0.5;
DEFINE FIELD confidence ON memory TYPE float DEFAULT 0.7;
DEFINE FIELD outcome_impact ON memory TYPE float DEFAULT 0.5;
DEFINE FIELD user_feedback ON memory TYPE float DEFAULT 0.0;
```

### 3.2 Importance Calculation Function

```surql
DEFINE FUNCTION fn::calculate_importance($memory_id: record<memory>) {
    LET $m = (SELECT * FROM ONLY $memory_id);

    LET $recency = math::exp(-0.1 * duration::days(time::now() - $m.updated_at));
    LET $frequency = math::min(1.0, $m.access_count / 10.0);

    -- Weighted combination
    LET $score = (
        $recency      * 0.25 +
        $frequency    * 0.20 +
        $m.relevance_score  * 0.20 +
        $m.confidence       * 0.15 +
        $m.outcome_impact   * 0.10 +
        $m.user_feedback    * 0.10
    );

    -- Type bonus: procedural memories are more durable
    LET $type_bonus = IF $m.memory_type = 'procedural' { 0.1 }
        ELSE IF $m.memory_type = 'semantic' { 0.05 }
        ELSE { 0.0 };

    RETURN math::min(1.0, $score + $type_bonus);
};
```

### 3.3 Exponential Decay with Access-Based Strengthening

```surql
-- Memory strength = base importance * decay * access bonus
DEFINE FIELD memory_strength ON memory COMPUTED {
    LET $base = importance;
    LET $half_life = MATCH memory_type {
        'episodic'   => 1.0,    -- 1-day half-life
        'semantic'   => 7.0,    -- 7-day half-life
        'procedural' => 30.0,   -- 30-day half-life
        'working'    => 0.042,  -- ~1 hour half-life
        _ => 3.0                -- default 3 days
    };

    -- Each access extends effective half-life by 20%
    LET $effective_half_life = $half_life * (1.0 + access_count * 0.2);
    LET $days_elapsed = duration::days(time::now() - last_accessed_at);
    LET $decay = math::exp(-0.693 * $days_elapsed / $effective_half_life);

    RETURN $base * $decay;
};
```

### 3.4 Strengthening on Retrieval

```surql
DEFINE FUNCTION fn::strengthen_on_access($memory_id: record<memory>) {
    UPDATE $memory_id SET
        access_count += 1,
        last_accessed_at = time::now(),
        -- Recalculate importance with updated frequency
        importance = fn::calculate_importance($memory_id)
    ;
};
```

---

## 4. Automatic Consolidation Pipeline

### 4.1 Consolidation Queue Processing

```surql
-- Consolidation request table
DEFINE TABLE consolidation_queue SCHEMAFULL;
DEFINE FIELD memory_id ON consolidation_queue TYPE record<memory>;
DEFINE FIELD reason ON consolidation_queue TYPE string;
DEFINE FIELD strength_at_queue ON consolidation_queue TYPE float;
DEFINE FIELD queued_at ON consolidation_queue TYPE datetime DEFAULT time::now();
DEFINE FIELD processed ON consolidation_queue TYPE bool DEFAULT false;
```

### 4.2 Session → Project Promotion

Triggered by the Stop hook at end of session:

```surql
DEFINE FUNCTION fn::promote_session_to_project($session_id: string) {
    -- Find session memories worth promoting
    LET $candidates = (
        SELECT * FROM memory
        WHERE scope = 'session'
            AND session_id = $session_id
            AND importance >= 0.5
            AND access_count >= 2
            AND memory_type IN ['semantic', 'procedural', 'episodic']
        ORDER BY importance DESC
        LIMIT 20
    );

    FOR $mem IN $candidates {
        -- Check for duplicates in project scope
        LET $similar = (
            SELECT id, content, embedding FROM memory
            WHERE scope = 'project'
                AND vector::similarity::cosine(embedding, $mem.embedding) > 0.85
            LIMIT 1
        );

        IF array::len($similar) > 0 {
            -- Merge into existing: strengthen it
            UPDATE $similar[0].id SET
                access_count += $mem.access_count,
                importance = math::max(importance, $mem.importance),
                updated_at = time::now(),
                metadata.merged_from += [$mem.id]
            ;
        } ELSE {
            -- Promote: create new project-scoped memory
            CREATE memory SET
                content = $mem.content,
                memory_type = $mem.memory_type,
                scope = 'project',
                embedding = $mem.embedding,
                importance = $mem.importance * 0.8,  -- slight discount on promotion
                confidence = $mem.confidence,
                tags = $mem.tags,
                metadata = {
                    promoted_from: $mem.id,
                    promoted_at: time::now(),
                    original_scope: 'session',
                    original_session: $session_id
                }
            ;
        };
    };

    RETURN array::len($candidates);
};
```

### 4.3 Project → User Promotion

Triggered when a pattern appears across multiple projects:

```surql
DEFINE FUNCTION fn::promote_project_to_user($memory_id: record<memory>) {
    LET $mem = (SELECT * FROM ONLY $memory_id);

    -- Only promote if accessed across 3+ sessions
    IF $mem.metadata.session_access_count < 3 {
        RETURN 'not_enough_cross_session_access';
    };

    -- Only promote generalizable types
    IF $mem.memory_type NOT IN ['procedural', 'semantic'] {
        RETURN 'type_not_promotable';
    };

    -- Check for existing user-level duplicate
    LET $existing = (
        SELECT id FROM memory
        WHERE scope = 'user'
            AND vector::similarity::cosine(embedding, $mem.embedding) > 0.85
        LIMIT 1
    );

    IF array::len($existing) > 0 {
        UPDATE $existing[0].id SET
            access_count += $mem.access_count,
            importance = math::max(importance, $mem.importance),
            updated_at = time::now()
        ;
        RETURN 'merged_into_existing';
    };

    CREATE memory SET
        content = $mem.content,
        memory_type = $mem.memory_type,
        scope = 'user',
        embedding = $mem.embedding,
        importance = $mem.importance * 0.7,
        confidence = $mem.confidence,
        tags = $mem.tags,
        metadata = {
            promoted_from: $mem.id,
            promoted_at: time::now(),
            original_scope: 'project'
        }
    ;

    RETURN 'promoted';
};
```

### 4.4 Episodic → Semantic Consolidation

Group related episodic memories into higher-level semantic facts:

```surql
DEFINE FUNCTION fn::consolidate_episodes($topic: string, $scope: string) {
    -- Find related episodic memories about a topic
    LET $episodes = (
        SELECT * FROM memory
        WHERE memory_type = 'episodic'
            AND scope = $scope
            AND status = 'active'
            AND tags CONTAINS $topic
        ORDER BY created_at ASC
    );

    IF array::len($episodes) < 3 {
        RETURN 'not_enough_episodes';
    };

    -- Create consolidation record (actual summarization done by LLM via hook)
    CREATE consolidation_queue SET
        memory_ids = $episodes.map(|$e| $e.id),
        reason = 'episodic_to_semantic',
        topic = $topic,
        scope = $scope,
        episode_count = array::len($episodes),
        queued_at = time::now()
    ;

    -- Mark source episodes as consolidated
    FOR $ep IN $episodes {
        UPDATE $ep.id SET
            status = 'consolidated',
            status_changed_at = time::now(),
            metadata.consolidated_into = 'pending'
        ;
    };

    RETURN 'queued_for_consolidation';
};
```

---

## 5. Knowledge Graph Evolution

### 5.1 Entity Extraction Pipeline

New memories trigger entity extraction (via LLM in PostToolUse/Stop hooks):

```surql
-- Entity table
DEFINE TABLE entity SCHEMAFULL;
DEFINE FIELD name ON entity TYPE string;
DEFINE FIELD entity_type ON entity TYPE string
    ASSERT $value IN ['concept', 'tool', 'file', 'pattern', 'error', 'library',
                       'convention', 'person', 'project', 'decision'];
DEFINE FIELD description ON entity TYPE string;
DEFINE FIELD embedding ON entity TYPE array<float>;
DEFINE FIELD mention_count ON entity TYPE int DEFAULT 1;
DEFINE FIELD confidence ON entity TYPE float DEFAULT 0.7;
DEFINE FIELD scope ON entity TYPE string ASSERT $value IN ['session', 'project', 'user'];
DEFINE FIELD first_seen ON entity TYPE datetime DEFAULT time::now();
DEFINE FIELD last_seen ON entity TYPE datetime DEFAULT time::now();

DEFINE INDEX entity_embedding ON entity FIELDS embedding HNSW DIMENSION 384 DIST COSINE;
DEFINE INDEX entity_name ON entity FIELDS name;
DEFINE INDEX entity_type_idx ON entity FIELDS entity_type;

-- Entity deduplication on insert
DEFINE EVENT entity_dedup ON TABLE entity WHEN $event = 'CREATE' THEN {
    LET $similar = (
        SELECT id, name FROM entity
        WHERE id != $after.id
            AND scope = $after.scope
            AND entity_type = $after.entity_type
            AND vector::similarity::cosine(embedding, $after.embedding) > 0.88
        LIMIT 1
    );

    IF array::len($similar) > 0 {
        -- Merge: update existing, delete new
        UPDATE $similar[0].id SET
            mention_count += 1,
            last_seen = time::now(),
            confidence = math::min(1.0, confidence + 0.05)
        ;
        DELETE $after.id;
    };
};
```

### 5.2 Relationship Discovery

```surql
-- Relationship edge table
DEFINE TABLE relates_to TYPE RELATION FROM entity TO entity SCHEMAFULL;
DEFINE FIELD relation_type ON relates_to TYPE string
    ASSERT $value IN ['uses', 'depends_on', 'is_a', 'part_of', 'causes',
                       'fixes', 'contradicts', 'replaces', 'related_to',
                       'tested_by', 'configured_by', 'imports'];
DEFINE FIELD weight ON relates_to TYPE float DEFAULT 0.5;
DEFINE FIELD confidence ON relates_to TYPE float DEFAULT 0.7;
DEFINE FIELD evidence ON relates_to TYPE array<record<memory>> DEFAULT [];
DEFINE FIELD valid_from ON relates_to TYPE datetime DEFAULT time::now();
DEFINE FIELD invalid_at ON relates_to TYPE option<datetime>;
DEFINE FIELD scope ON relates_to TYPE string;

-- Strengthen relationship on repeated observation
DEFINE EVENT strengthen_relation ON TABLE relates_to WHEN $event = 'UPDATE' THEN {
    IF array::len($after.evidence) > array::len($before.evidence) {
        UPDATE $after.id SET
            weight = math::min(1.0, weight + 0.1),
            confidence = math::min(1.0, confidence + 0.05)
        ;
    };
};
```

### 5.3 Contradiction Detection

```surql
DEFINE FUNCTION fn::detect_contradictions($entity_id: record<entity>) {
    -- Find all facts about this entity
    LET $outgoing = (
        SELECT *, out.name AS target_name, out.id AS target_id
        FROM relates_to
        WHERE in = $entity_id AND invalid_at IS NONE
    );

    -- Check for contradicting relations
    LET $contradictions = [];
    FOR $r1 IN $outgoing {
        FOR $r2 IN $outgoing {
            IF $r1.id != $r2.id
                AND $r1.target_id = $r2.target_id
                AND (
                    ($r1.relation_type = 'causes' AND $r2.relation_type = 'contradicts')
                    OR ($r1.relation_type = 'uses' AND $r2.relation_type = 'replaces')
                ) {
                $contradictions += {
                    relation_a: $r1.id,
                    relation_b: $r2.id,
                    entity: $entity_id,
                    target: $r1.target_id
                };
            };
        };
    };

    IF array::len($contradictions) > 0 {
        -- Queue for resolution
        FOR $c IN $contradictions {
            CREATE contradiction_queue SET
                contradiction = $c,
                detected_at = time::now(),
                resolved = false
            ;
        };
    };

    RETURN $contradictions;
};
```

### 5.4 Graph Pruning

```surql
DEFINE FUNCTION fn::prune_knowledge_graph($scope: string) {
    -- Remove low-confidence, rarely-seen entities
    LET $weak_entities = (
        SELECT id FROM entity
        WHERE scope = $scope
            AND confidence < 0.3
            AND mention_count < 2
            AND time::now() - last_seen > 30d
    );

    FOR $e IN $weak_entities {
        -- Remove associated edges first
        DELETE relates_to WHERE in = $e.id OR out = $e.id;
        DELETE $e.id;
    };

    -- Invalidate stale edges
    UPDATE relates_to SET invalid_at = time::now()
    WHERE scope = $scope
        AND confidence < 0.2
        AND time::now() - valid_from > 30d
        AND invalid_at IS NONE;

    RETURN {
        entities_pruned: array::len($weak_entities),
        edges_invalidated: 'see above'
    };
};
```

---

## 6. Retrieval Strategy Evolution

Inspired by MemEvolve's outer loop that adapts the retrieval architecture itself.

### 6.1 Retrieval Feedback Tracking

```surql
DEFINE TABLE retrieval_log SCHEMAFULL;
DEFINE FIELD query ON retrieval_log TYPE string;
DEFINE FIELD query_type ON retrieval_log TYPE string
    ASSERT $value IN ['code_search', 'error_debug', 'convention', 'architecture',
                       'how_to', 'recall_fact', 'find_pattern', 'general'];
DEFINE FIELD strategy ON retrieval_log TYPE string
    ASSERT $value IN ['vector', 'keyword', 'hybrid', 'graph', 'graph_vector'];
DEFINE FIELD results_returned ON retrieval_log TYPE int;
DEFINE FIELD results_used ON retrieval_log TYPE int DEFAULT 0;
DEFINE FIELD user_feedback ON retrieval_log TYPE option<string>
    ASSERT $value IN [NONE, 'helpful', 'not_helpful', 'partially_helpful'];
DEFINE FIELD latency_ms ON retrieval_log TYPE int;
DEFINE FIELD scope ON retrieval_log TYPE string;
DEFINE FIELD timestamp ON retrieval_log TYPE datetime DEFAULT time::now();

DEFINE INDEX retrieval_log_type ON retrieval_log FIELDS query_type, strategy;
```

### 6.2 Strategy Effectiveness Analysis

```surql
DEFINE FUNCTION fn::analyze_retrieval_effectiveness($scope: string) {
    -- Aggregate feedback by query_type × strategy
    LET $stats = (
        SELECT
            query_type,
            strategy,
            count() AS total_queries,
            math::sum(IF user_feedback = 'helpful' THEN 1 ELSE 0 END) AS helpful_count,
            math::sum(IF user_feedback = 'not_helpful' THEN 1 ELSE 0 END) AS unhelpful_count,
            math::mean(results_used) AS avg_results_used,
            math::mean(latency_ms) AS avg_latency
        FROM retrieval_log
        WHERE scope = $scope
            AND timestamp > time::now() - 30d
        GROUP BY query_type, strategy
    );

    RETURN $stats;
};
```

### 6.3 Adaptive Strategy Weights

```surql
-- Per-project strategy weight profiles
DEFINE TABLE strategy_weights SCHEMAFULL;
DEFINE FIELD scope ON strategy_weights TYPE string;
DEFINE FIELD query_type ON strategy_weights TYPE string;
DEFINE FIELD vector_weight ON strategy_weights TYPE float DEFAULT 0.4;
DEFINE FIELD keyword_weight ON strategy_weights TYPE float DEFAULT 0.3;
DEFINE FIELD graph_weight ON strategy_weights TYPE float DEFAULT 0.3;
DEFINE FIELD updated_at ON strategy_weights TYPE datetime DEFAULT time::now();
DEFINE FIELD update_count ON strategy_weights TYPE int DEFAULT 0;

-- Adapt weights based on feedback
DEFINE FUNCTION fn::adapt_strategy_weights($scope: string) {
    LET $effectiveness = fn::analyze_retrieval_effectiveness($scope);

    FOR $stat IN $effectiveness {
        -- Calculate success rate for each strategy per query type
        LET $success_rate = IF $stat.total_queries > 5 {
            $stat.helpful_count / $stat.total_queries
        } ELSE {
            0.5  -- default when insufficient data
        };

        -- Get current weights
        LET $current = (
            SELECT * FROM strategy_weights
            WHERE scope = $scope AND query_type = $stat.query_type
            LIMIT 1
        );

        IF array::len($current) = 0 {
            -- Initialize with defaults
            CREATE strategy_weights SET
                scope = $scope,
                query_type = $stat.query_type;
        } ELSE {
            -- Nudge weight toward successful strategies (learning rate 0.1)
            LET $delta = ($success_rate - 0.5) * 0.1;

            LET $field = MATCH $stat.strategy {
                'vector' => 'vector_weight',
                'keyword' => 'keyword_weight',
                'graph' => 'graph_weight',
                _ => 'vector_weight'
            };

            -- Update with normalization
            UPDATE $current[0].id SET
                updated_at = time::now(),
                update_count += 1
            ;
        };
    };

    RETURN 'weights_adapted';
};
```

---

## 7. Self-Reflection Mechanism

### 7.1 Periodic Review Trigger

```surql
-- Track when last reflection happened per scope
DEFINE TABLE reflection_log SCHEMAFULL;
DEFINE FIELD scope ON reflection_log TYPE string;
DEFINE FIELD triggered_by ON reflection_log TYPE string;  -- 'scheduled' | 'manual' | 'session_count'
DEFINE FIELD session_count_at ON reflection_log TYPE int;
DEFINE FIELD insights_generated ON reflection_log TYPE int DEFAULT 0;
DEFINE FIELD entities_merged ON reflection_log TYPE int DEFAULT 0;
DEFINE FIELD edges_pruned ON reflection_log TYPE int DEFAULT 0;
DEFINE FIELD memories_archived ON reflection_log TYPE int DEFAULT 0;
DEFINE FIELD duration_ms ON reflection_log TYPE int;
DEFINE FIELD timestamp ON reflection_log TYPE datetime DEFAULT time::now();
```

### 7.2 Reflection Queries

The memory-consolidator agent runs these queries to identify patterns:

```surql
-- Find clusters of related memories that could be consolidated
DEFINE FUNCTION fn::find_consolidation_candidates($scope: string) {
    -- Memories with similar embeddings that are still separate
    LET $candidates = (
        SELECT
            id,
            content,
            memory_type,
            importance,
            embedding
        FROM memory
        WHERE scope = $scope
            AND status = 'active'
            AND memory_type = 'episodic'
        ORDER BY importance DESC
        LIMIT 100
    );

    -- Group by similarity (this would be done by the LLM agent)
    RETURN $candidates;
};

-- Find frequently co-accessed memories (association strength)
DEFINE FUNCTION fn::find_associations($scope: string) {
    SELECT
        m1.id AS memory_a,
        m2.id AS memory_b,
        count() AS co_access_count
    FROM retrieval_log AS r1, retrieval_log AS r2
    WHERE r1.scope = $scope
        AND r2.scope = $scope
        AND r1.id != r2.id
        AND math::abs(duration::secs(r1.timestamp - r2.timestamp)) < 300
    GROUP BY m1.id, m2.id
    HAVING co_access_count >= 3
    ORDER BY co_access_count DESC
    LIMIT 20
};

-- Find underperforming memories (retrieved but never used)
DEFINE FUNCTION fn::find_noise_memories($scope: string) {
    SELECT
        memory_id,
        count() AS times_retrieved,
        math::sum(IF results_used > 0 THEN 0 ELSE 1 END) AS times_ignored
    FROM retrieval_log
    WHERE scope = $scope
        AND timestamp > time::now() - 14d
    GROUP BY memory_id
    HAVING times_ignored > times_retrieved * 0.8
    ORDER BY times_retrieved DESC
};
```

### 7.3 Meta-Memories

Insights about the memory system itself:

```surql
DEFINE TABLE meta_memory SCHEMAFULL;
DEFINE FIELD insight_type ON meta_memory TYPE string
    ASSERT $value IN [
        'retrieval_pattern',     -- "vector search works best for error debugging"
        'memory_gap',            -- "no memories about testing conventions"
        'consolidation_signal',  -- "10 episodic memories about auth could be one semantic"
        'decay_anomaly',         -- "procedural memories decaying too fast for this project"
        'graph_insight'          -- "entity X has become a hub — consider splitting"
    ];
DEFINE FIELD description ON meta_memory TYPE string;
DEFINE FIELD evidence ON meta_memory TYPE array<record> DEFAULT [];
DEFINE FIELD action_taken ON meta_memory TYPE option<string>;
DEFINE FIELD scope ON meta_memory TYPE string;
DEFINE FIELD created_at ON meta_memory TYPE datetime DEFAULT time::now();
```

---

## 8. Memory-Consolidator Agent Design

The memory-consolidator runs as a background agent dispatched by the Stop hook or `/memory-consolidate` command.

### Responsibilities

1. **Process consolidation queue** — take queued memories, use LLM to summarize related episodes into semantic memories
2. **Run promotion pipeline** — check session memories for project promotion candidates
3. **Prune knowledge graph** — remove weak entities and stale edges
4. **Detect contradictions** — find and flag contradicting relationships
5. **Adapt retrieval weights** — analyze retrieval logs and adjust strategy weights
6. **Generate meta-memories** — identify patterns about the memory system itself
7. **Report** — summarize what was consolidated, pruned, promoted

### Consolidation Run Flow

```
┌─────────────────────────────────────────────────────┐
│              CONSOLIDATION RUN                       │
│                                                     │
│  1. Process consolidation_queue                     │
│     └─ For each group: LLM summarize → semantic     │
│                                                     │
│  2. Session → Project promotion                     │
│     └─ fn::promote_session_to_project()             │
│                                                     │
│  3. Project → User promotion                        │
│     └─ fn::promote_project_to_user() for candidates│
│                                                     │
│  4. Knowledge graph maintenance                     │
│     └─ fn::prune_knowledge_graph()                  │
│     └─ fn::detect_contradictions() for top entities │
│                                                     │
│  5. Retrieval strategy adaptation                   │
│     └─ fn::adapt_strategy_weights()                 │
│                                                     │
│  6. Self-reflection                                 │
│     └─ fn::find_consolidation_candidates()          │
│     └─ fn::find_noise_memories()                    │
│     └─ Generate meta_memory records                 │
│                                                     │
│  7. Write reflection_log entry                      │
└─────────────────────────────────────────────────────┘
```

### Agent Frontmatter

```yaml
---
name: memory-consolidator
description: |
  Use this agent when memory maintenance is needed. Triggered automatically
  by the Stop hook at session end, or manually via /memory-consolidate.
  Processes consolidation queues, promotes memories between scopes,
  prunes the knowledge graph, adapts retrieval strategies, and
  generates meta-insights about the memory system.
model: inherit
color: yellow
tools: ["Read", "Bash", "Grep"]
---
```

---

## 9. Evolution Scheduling

### When Evolution Runs

| Trigger | What Runs | Latency Budget |
|---------|-----------|---------------|
| **Every session end** (Stop hook) | Promotion pipeline, lightweight consolidation | 30s |
| **Every 5 sessions** | Full consolidation + graph pruning | 2 min (background agent) |
| **Every 20 sessions** | Retrieval strategy adaptation + self-reflection | 5 min (background agent) |
| **Manual** (`/memory-consolidate`) | Full pipeline | No limit |

### Session Counter

```surql
DEFINE TABLE evolution_state SCHEMAFULL;
DEFINE FIELD scope ON evolution_state TYPE string;
DEFINE FIELD session_count ON evolution_state TYPE int DEFAULT 0;
DEFINE FIELD last_full_consolidation ON evolution_state TYPE datetime;
DEFINE FIELD last_reflection ON evolution_state TYPE datetime;
DEFINE FIELD last_strategy_adaptation ON evolution_state TYPE datetime;

-- Increment on each session
DEFINE FUNCTION fn::tick_session($scope: string) {
    UPSERT evolution_state SET
        scope = $scope,
        session_count += 1
    WHERE scope = $scope;

    LET $state = (SELECT * FROM evolution_state WHERE scope = $scope LIMIT 1);

    RETURN {
        needs_full_consolidation: $state[0].session_count % 5 = 0,
        needs_reflection: $state[0].session_count % 20 = 0
    };
};
```

---

## 10. Design Trade-offs and Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Soft delete vs hard delete | Soft (status='forgotten') | Preserves graph structure, enables recovery |
| LLM-based consolidation | Yes, via agent | Summaries need reasoning; can't be pure SurrealQL |
| Promotion threshold | importance >= 0.5, access >= 2 | Balances signal vs noise; tunable per project |
| Decay half-life | Per memory type (1d/7d/30d) | Mirrors cognitive science; procedural memory is most durable |
| Retrieval adaptation | Slow learning rate (0.1) | Prevents oscillation; needs 50+ feedback points to shift |
| Graph pruning threshold | confidence < 0.3, mentions < 2 | Conservative; avoid deleting emerging knowledge |
| Contradiction resolution | Queue for review | LLM needed; auto-resolution too risky |

---

## 11. Open Questions

1. **Embedding updates**: When a memory's content changes during consolidation, should the embedding be regenerated? (Cost vs accuracy)
2. **Cross-project knowledge graph merging**: When promoting project entities to user scope, how to handle entity name collisions across projects?
3. **Feedback collection**: How to implicitly detect whether a retrieved memory was "helpful" without explicit user feedback? (Heuristic: was the memory content referenced in the next response?)
4. **Evolution convergence**: How to detect when retrieval weights have stabilized and stop adapting?
5. **Memory budget**: Should there be a hard cap on total memories per scope? If so, what eviction policy?

---

## Related Documents

- [[MemEvolve Paper Analysis]] — theoretical foundation for meta-evolutionary memory
- [[Long-Term Memory Patterns]] — detailed decay curves and spaced repetition
- [[Hierarchical Memory Model Design]] — scope architecture this builds on
- [[Hooks System for Automatic Memory]] — triggers that feed the evolution pipeline
- [[Knowledge Graph Patterns with SurrealDB]] — entity/relationship schemas
- [[Implementation Blueprint and Index]] — how this fits into the build plan
