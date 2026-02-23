# SurrealDB Feature Mapping for Agentic Memory

> Research date: 2026-02-23
> Built on: [[SurrealDB 3.0 Research Index]] and sub-documents

This document systematically maps every major SurrealDB feature to concrete agentic memory use cases, with working SurrealQL examples for each. It concludes with a competitive analysis against the typical Postgres+pgvector and Neo4j+vector combos, and identifies gaps where SurrealDB falls short.

---

## Table of Contents

- [[#1. Documents (Schemaless JSON) -- Episodic Memory]]
- [[#2. Graph Relations (RELATE) -- Knowledge Graphs and Associative Memory]]
- [[#3. HNSW Vector Indexes -- Semantic Similarity Search]]
- [[#4. BM25 Full-Text Search -- Keyword-Based Memory Recall]]
- [[#5. Hybrid Search (search rrf and linear) -- Combined Retrieval]]
- [[#6. LIVE SELECT -- Real-Time Memory Notifications]]
- [[#7. Changefeeds -- Memory Evolution Audit Trail]]
- [[#8. DEFINE EVENT -- Memory Consolidation Triggers]]
- [[#9. Computed Fields -- Dynamic Memory Scores]]
- [[#10. Record References (Bidirectional) -- Associative Memory Links]]
- [[#11. Permissions (Row-Level) -- Per-Agent Memory Isolation]]
- [[#12. SurrealML -- In-Database Embedding and Classification]]
- [[#13. Custom Functions -- Memory Scoring Algorithms]]
- [[#14. DEFINE TABLE AS (Views) -- Memory Summaries]]
- [[#15. DEFINE ACCESS (Record-Level) -- Agent Authentication]]
- [[#16. DEFINE API (3.0) -- Custom Memory API Endpoints]]
- [[#17. File Storage (3.0) -- Multimodal Memories]]
- [[#18. Surrealism WASM Extensions -- In-Database AI Logic]]
- [[#19. Namespaces and Databases -- Multi-Tenant Agent Memory]]
- [[#20. Client-Side Transactions (3.0) -- Atomic Memory Operations]]
- [[#21. Record IDs -- Natural Memory Addressing]]
- [[#Competitive Advantages Over Postgres+pgvector and Neo4j+Vector]]
- [[#Gaps -- What SurrealDB Does Not Cover Well]]

---

## 1. Documents (Schemaless JSON) -- Episodic Memory

**Memory use case:** Store conversations, events, observations, tool calls, and other episodic memories as rich, nested JSON documents. Schemaless tables let agents store heterogeneous memory types without rigid upfront schemas.

**Why it fits:** Episodic memories are inherently varied -- a conversation turn looks different from a tool invocation, which looks different from an environmental observation. Schemaless documents accommodate this naturally.

### SurrealQL Examples

```surql
-- Define an episodic memory table (schemaless for flexibility)
DEFINE TABLE episodic_memory SCHEMALESS
    PERMISSIONS
        FOR select, create WHERE agent_id = $auth.id
        FOR update, delete NONE;

-- Store a conversation memory
CREATE episodic_memory SET
    agent_id = agent:assistant_1,
    type = "conversation",
    timestamp = time::now(),
    content = {
        role: "user",
        text: "What is the capital of France?",
        response: "The capital of France is Paris.",
        tokens_used: 42
    },
    context = {
        session_id: "sess_abc123",
        tool_calls: [],
        user_id: user:alice
    },
    importance = 0.3;

-- Store a tool-use memory
CREATE episodic_memory SET
    agent_id = agent:assistant_1,
    type = "tool_call",
    timestamp = time::now(),
    content = {
        tool: "web_search",
        query: "SurrealDB 3.0 release date",
        result_summary: "Released February 17, 2026",
        success: true
    },
    context = {
        session_id: "sess_abc123",
        triggered_by: episodic_memory:conversation_xyz
    },
    importance = 0.5;

-- Store an observation memory
CREATE episodic_memory SET
    agent_id = agent:assistant_1,
    type = "observation",
    timestamp = time::now(),
    content = {
        observed: "User prefers concise answers",
        evidence: ["short responses rated higher", "asked to 'keep it brief' 3 times"],
        confidence: 0.85
    },
    importance = 0.8;

-- Retrieve recent episodic memories for an agent
SELECT * FROM episodic_memory
    WHERE agent_id = agent:assistant_1
    ORDER BY timestamp DESC
    LIMIT 50;

-- Retrieve by type and time window
SELECT * FROM episodic_memory
    WHERE agent_id = agent:assistant_1
      AND type = "conversation"
      AND timestamp > time::now() - 1h
    ORDER BY timestamp DESC;
```

**Key advantage:** The `FLEXIBLE` keyword on `SCHEMAFULL` tables lets you enforce certain fields (agent_id, timestamp, type) while leaving content open:

```surql
DEFINE TABLE episodic_memory SCHEMAFULL;
DEFINE FIELD agent_id ON episodic_memory TYPE record<agent>;
DEFINE FIELD type ON episodic_memory TYPE string;
DEFINE FIELD timestamp ON episodic_memory TYPE datetime DEFAULT time::now();
DEFINE FIELD importance ON episodic_memory TYPE float DEFAULT 0.5;
DEFINE FIELD content ON episodic_memory TYPE object FLEXIBLE;
DEFINE FIELD context ON episodic_memory TYPE object FLEXIBLE;
DEFINE FIELD embedding ON episodic_memory TYPE option<array<float>>;
```

---

## 2. Graph Relations (RELATE) -- Knowledge Graphs and Associative Memory

**Memory use case:** Build knowledge graphs where entities, concepts, and memories are nodes connected by typed, metadata-rich edges. Agents can traverse associations ("what did I learn about X?", "what is related to Y?") without JOINs.

**Why it fits:** Human memory is associative -- recalling one concept activates related concepts. Graph edges with metadata (strength, type, timestamp) model this naturally. SurrealDB's edge tables are first-class tables with their own schema, indexes, and permissions.

### SurrealQL Examples

```surql
-- Define entity and relation tables
DEFINE TABLE entity SCHEMAFULL;
DEFINE FIELD name ON entity TYPE string;
DEFINE FIELD entity_type ON entity TYPE string;
DEFINE FIELD description ON entity TYPE option<string>;
DEFINE FIELD embedding ON entity TYPE option<array<float>>;
DEFINE FIELD first_seen ON entity TYPE datetime DEFAULT time::now();
DEFINE FIELD last_seen ON entity TYPE datetime VALUE time::now();
DEFINE FIELD mention_count ON entity TYPE int DEFAULT 1;

DEFINE TABLE relates_to TYPE RELATION FROM entity TO entity SCHEMAFULL;
DEFINE FIELD relation_type ON relates_to TYPE string;
DEFINE FIELD strength ON relates_to TYPE float DEFAULT 0.5;
DEFINE FIELD evidence ON relates_to TYPE array DEFAULT [];
DEFINE FIELD created_at ON relates_to TYPE datetime DEFAULT time::now();
DEFINE FIELD last_reinforced ON relates_to TYPE datetime VALUE time::now();

-- Create entities
CREATE entity:paris SET
    name = "Paris",
    entity_type = "city",
    description = "Capital of France";

CREATE entity:france SET
    name = "France",
    entity_type = "country";

CREATE entity:eiffel_tower SET
    name = "Eiffel Tower",
    entity_type = "landmark",
    description = "Iron lattice tower on the Champ de Mars";

-- Create relationships with metadata
RELATE entity:paris->relates_to->entity:france SET
    relation_type = "capital_of",
    strength = 1.0,
    evidence = ["geography", "user conversation on 2026-02-23"];

RELATE entity:eiffel_tower->relates_to->entity:paris SET
    relation_type = "located_in",
    strength = 1.0,
    evidence = ["common knowledge"];

-- Multi-hop traversal: What is related to France?
SELECT
    name,
    <-relates_to<-entity.name AS related_from,
    ->relates_to->entity.name AS related_to
FROM entity:france;

-- Find all entities within 2 hops of a starting entity
SELECT
    ->relates_to->entity AS direct,
    ->relates_to->entity->relates_to->entity AS two_hop
FROM entity:paris;

-- Reinforce a relationship (increase strength on repeated evidence)
UPDATE relates_to
    SET strength = math::min([strength + 0.1, 1.0]),
        evidence += "reinforced in session sess_def456",
        last_reinforced = time::now()
    WHERE in = entity:paris AND out = entity:france;

-- Find strongest relationships for an entity
SELECT
    ->relates_to.relation_type AS relation,
    ->relates_to.strength AS strength,
    ->relates_to->entity.name AS target
FROM entity:paris
ORDER BY strength DESC;

-- Link episodic memories to entities (cross-model query)
DEFINE TABLE mentions TYPE RELATION FROM episodic_memory TO entity SCHEMAFULL;
DEFINE FIELD context ON mentions TYPE option<string>;

RELATE episodic_memory:conv_123->mentions->entity:paris SET
    context = "User asked about the capital of France";

-- Retrieve all memories that mention an entity
SELECT <-mentions<-episodic_memory.* AS memories
FROM entity:paris;
```

---

## 3. HNSW Vector Indexes -- Semantic Similarity Search

**Memory use case:** Store embeddings alongside memories and perform approximate nearest-neighbor search for semantic retrieval. This is the core of "recall by meaning" -- finding relevant memories even when the exact words differ.

**Why it fits:** Agents need to retrieve memories that are semantically similar to the current context, not just keyword matches. HNSW provides O(log N) approximate search, and SurrealDB 3.0 delivers ~8x faster vector search than 2.x.

### SurrealQL Examples

```surql
-- Define memory table with embedding field
DEFINE TABLE memory SCHEMAFULL;
DEFINE FIELD agent_id ON memory TYPE record<agent>;
DEFINE FIELD content ON memory TYPE string;
DEFINE FIELD metadata ON memory TYPE object FLEXIBLE;
DEFINE FIELD embedding ON memory TYPE array<float>;
DEFINE FIELD importance ON memory TYPE float DEFAULT 0.5;
DEFINE FIELD created_at ON memory TYPE datetime DEFAULT time::now();
DEFINE FIELD access_count ON memory TYPE int DEFAULT 0;
DEFINE FIELD last_accessed ON memory TYPE option<datetime>;

-- Create HNSW vector index (1536-dim for OpenAI ada-002, or 3072 for text-embedding-3-large)
DEFINE INDEX idx_memory_embedding ON memory
    FIELDS embedding
    HNSW DIMENSION 1536 DIST COSINE TYPE F32;

-- Store a memory with its embedding
CREATE memory SET
    agent_id = agent:assistant_1,
    content = "The user prefers Python over JavaScript for backend work",
    metadata = { source: "conversation", session: "sess_abc" },
    embedding = [0.012, -0.034, 0.056, ...],  -- 1536 dimensions
    importance = 0.7;

-- Semantic search: find 10 most similar memories to a query embedding
LET $query_embedding = [0.015, -0.030, 0.060, ...];

SELECT id, content, importance,
    vector::distance::knn() AS distance
FROM memory
WHERE agent_id = agent:assistant_1
    AND embedding <|10, 100|> $query_embedding
ORDER BY distance;

-- Semantic search with importance weighting (post-filter)
SELECT id, content, importance,
    vector::distance::knn() AS distance,
    (1.0 - vector::distance::knn()) * importance AS relevance_score
FROM memory
WHERE agent_id = agent:assistant_1
    AND embedding <|20, 100|> $query_embedding
ORDER BY relevance_score DESC
LIMIT 10;

-- Update access patterns on retrieval (for recency/frequency scoring)
UPDATE memory SET
    access_count += 1,
    last_accessed = time::now()
WHERE id IN $retrieved_memory_ids;
```

See also: [[SurrealML and AI Vector Capabilities#Vector Search Overview]]

---

## 4. BM25 Full-Text Search -- Keyword-Based Memory Recall

**Memory use case:** Search memories by keywords when the agent knows specific terms but not the exact phrasing. Useful for recalling facts ("what do I know about X?"), searching through conversation logs, and complementing vector search.

**Why it fits:** Not all retrieval is semantic. Sometimes an agent needs to find a memory containing a specific entity name, error code, or technical term. BM25 is the standard relevance-scoring algorithm for keyword search.

### SurrealQL Examples

```surql
-- Define a text analyzer with stemming
DEFINE ANALYZER memory_analyzer
    TOKENIZERS blank, class
    FILTERS lowercase, snowball(english);

-- Define full-text index on memory content
DEFINE INDEX idx_memory_content ON memory
    FIELDS content
    SEARCH ANALYZER memory_analyzer BM25(1.2, 0.75) HIGHLIGHTS;

-- Keyword search with scoring
SELECT id, content, importance,
    search::score(1) AS text_score
FROM memory
WHERE agent_id = agent:assistant_1
    AND content @1@ 'Python backend'
ORDER BY text_score DESC
LIMIT 10;

-- Keyword search with highlighted matches
SELECT
    search::highlight('<mark>', '</mark>', 1) AS highlighted_content,
    search::score(1) AS relevance
FROM memory
WHERE content @1@ 'database migration'
ORDER BY relevance DESC
LIMIT 5;
```

See also: [[Advanced Features Functions Indexes Analyzers#Full-Text Search System]]

---

## 5. Hybrid Search (search::rrf and linear) -- Combined Retrieval

**Memory use case:** Combine vector semantic search with BM25 keyword search for more robust memory retrieval. This is the state of the art for RAG systems -- neither vector nor keyword search alone is optimal.

**Why it fits:** An agent asking "what was that Python error about database connections?" benefits from both semantic similarity (understanding the intent) and keyword matching (Python, database, connections). SurrealDB's built-in fusion functions (`search::rrf`, `search::linear`) eliminate external fusion logic.

### SurrealQL Examples

```surql
-- Define a hybrid search function for agent memory
DEFINE FUNCTION fn::hybrid_memory_search(
    $agent_id: record<agent>,
    $query_text: string,
    $query_embedding: array,
    $k: int
) {
    -- Semantic search via HNSW
    LET $semantic = SELECT id, content,
        vector::distance::knn() AS distance
        FROM memory
        WHERE agent_id = $agent_id
            AND embedding <|$k, 100|> $query_embedding;

    -- Keyword search via BM25
    LET $keyword = SELECT id, content,
        search::score(1) AS ft_score
        FROM memory
        WHERE agent_id = $agent_id
            AND content @1@ $query_text
        ORDER BY ft_score DESC
        LIMIT $k;

    -- Fuse using Reciprocal Rank Fusion
    RETURN search::rrf([$semantic, $keyword], $k, 60);
};

-- Usage: hybrid retrieval
LET $results = fn::hybrid_memory_search(
    agent:assistant_1,
    "Python database connection error",
    [0.015, -0.030, 0.060, ...],
    10
);

-- Alternative: weighted linear fusion (when you want to tune vector vs keyword weight)
DEFINE FUNCTION fn::weighted_memory_search(
    $agent_id: record<agent>,
    $query_text: string,
    $query_embedding: array,
    $k: int,
    $semantic_weight: float,
    $keyword_weight: float
) {
    LET $semantic = SELECT id, content,
        vector::distance::knn() AS distance
        FROM memory
        WHERE agent_id = $agent_id
            AND embedding <|$k, 100|> $query_embedding;

    LET $keyword = SELECT id, content,
        search::score(1) AS ft_score
        FROM memory
        WHERE agent_id = $agent_id
            AND content @1@ $query_text
        ORDER BY ft_score DESC
        LIMIT $k;

    RETURN search::linear(
        [$semantic, $keyword],
        [$semantic_weight, $keyword_weight],
        $k,
        'minmax'
    );
};
```

See also: [[SurrealML and AI Vector Capabilities#Hybrid Search -- Fusing Results]]

---

## 6. LIVE SELECT -- Real-Time Memory Notifications

**Memory use case:** Push real-time notifications to agents when shared memories are updated, new knowledge is added, or memory consolidation completes. Enables reactive agent behavior -- agents respond to memory changes without polling.

**Why it fits:** In multi-agent systems, agents need to react when another agent adds relevant knowledge or when memory consolidation changes the importance of a memory. LIVE SELECT eliminates polling and provides immediate notification.

### SurrealQL Examples

```surql
-- Agent subscribes to new memories from other agents in the same workspace
LIVE SELECT * FROM memory
    WHERE workspace_id = $auth.workspace
      AND agent_id != $auth.id
      AND importance > 0.7;

-- Agent subscribes to changes on a specific entity in the knowledge graph
LIVE SELECT *,
    <-relates_to<-entity.name AS related_from,
    ->relates_to->entity.name AS related_to
FROM entity:critical_project;

-- Subscribe to memory consolidation results (diff mode for bandwidth)
LIVE SELECT DIFF FROM consolidated_memory
    WHERE agent_id = $auth.id;

-- React to real-time presence of other agents
LIVE SELECT * FROM agent_state
    WHERE workspace_id = $auth.workspace;

-- Kill when the agent session ends
KILL $subscription_uuid;
```

**Architecture pattern** (Get and Subscribe):

```surql
-- 1. Subscribe first (so no changes are missed)
LIVE SELECT * FROM memory WHERE workspace_id = $workspace_id;

-- 2. Then fetch the initial snapshot
SELECT * FROM memory
    WHERE workspace_id = $workspace_id
    ORDER BY created_at DESC
    LIMIT 100;
```

See also: [[Real-Time Live Queries and Changefeeds#LIVE SELECT -- Push-Based Real-Time Queries]]

---

## 7. Changefeeds -- Memory Evolution Audit Trail

**Memory use case:** Track the complete history of how memories evolve over time. Replay memory changes for debugging, auditing, or reconstructing past knowledge states. Enable external systems (analytics, backup) to consume memory changes.

**Why it fits:** Understanding *how* an agent's knowledge changed is as important as knowing its current state. Changefeeds provide persistent, replayable CDC with configurable retention.

### SurrealQL Examples

```surql
-- Enable changefeed on memory tables with before/after state
DEFINE TABLE memory CHANGEFEED 30d INCLUDE ORIGINAL;
DEFINE TABLE entity CHANGEFEED 30d INCLUDE ORIGINAL;
DEFINE TABLE relates_to CHANGEFEED 30d INCLUDE ORIGINAL;

-- Replay all memory changes since a checkpoint
SHOW CHANGES FOR TABLE memory SINCE d"2026-02-20T00:00:00Z" LIMIT 1000;

-- Replay entity knowledge graph changes
SHOW CHANGES FOR TABLE entity SINCE $last_checkpoint LIMIT 500;

-- Database-level change replay (all tables)
SHOW CHANGES FOR DATABASE SINCE $last_sync_versionstamp LIMIT 1000;
```

**External consumer pattern** for syncing memory changes to analytics:

```javascript
let lastVersionstamp = 0;

async function syncMemoryChanges() {
    const changes = await db.query(
        `SHOW CHANGES FOR TABLE memory SINCE $vs LIMIT 100`,
        { vs: lastVersionstamp }
    );
    for (const changeset of changes) {
        await sendToAnalytics(changeset);
        lastVersionstamp = changeset.versionstamp;
    }
}
```

See also: [[Real-Time Live Queries and Changefeeds#Changefeeds -- Historical Change Data Capture]]

---

## 8. DEFINE EVENT -- Memory Consolidation Triggers

**Memory use case:** Trigger automatic memory processing when new memories are created or updated. Use cases include: auto-generating embeddings on write, importance re-scoring based on access patterns, memory consolidation (merging similar memories), and cascading knowledge graph updates.

**Why it fits:** Events run server-side within the transaction, ensuring consistency. Async events (3.0) enable heavy processing like embedding generation without blocking writes.

### SurrealQL Examples

```surql
-- Auto-generate embeddings when a memory is created
DEFINE EVENT auto_embed ON TABLE memory
    WHEN $event = "CREATE"
    THEN {
        -- Call an external embedding API (requires --allow-net)
        LET $embedding = http::post("http://localhost:11434/api/embed", {
            model: "nomic-embed-text",
            input: $after.content
        }).embedding;
        UPDATE $after.id SET embedding = $embedding;
    };

-- Re-score importance when a memory is accessed frequently
DEFINE EVENT importance_boost ON TABLE memory
    WHEN $event = "UPDATE" AND $after.access_count > $before.access_count
    THEN {
        LET $recency_factor = 1.0 / (1.0 + duration::hours(time::now() - $after.created_at));
        LET $frequency_factor = math::log($after.access_count + 1, 10) / 3.0;
        LET $new_importance = math::min([
            ($after.importance * 0.6) + ($recency_factor * 0.2) + ($frequency_factor * 0.2),
            1.0
        ]);
        UPDATE $after.id SET importance = $new_importance;
    };

-- Async event: consolidate duplicate entities in the knowledge graph
DEFINE EVENT entity_dedup ON TABLE entity ASYNC RETRY 3 MAXDEPTH 1
    WHEN $event = "CREATE"
    THEN {
        -- Find existing entities with the same name
        LET $existing = SELECT * FROM entity
            WHERE name = $after.name
              AND id != $after.id;
        IF array::len($existing) > 0 {
            -- Merge: move all relations from the new entity to the existing one
            LET $target = $existing[0].id;
            UPDATE relates_to SET in = $target WHERE in = $after.id;
            UPDATE relates_to SET out = $target WHERE out = $after.id;
            UPDATE $target SET
                mention_count += $after.mention_count,
                description = $after.description ?? $target.description;
            DELETE $after.id;
        };
    };

-- Track when memories decay below threshold and archive them
DEFINE EVENT memory_decay_check ON TABLE memory
    WHEN $event = "UPDATE" AND $after.importance < 0.1
    THEN {
        -- Move to archive table
        CREATE archived_memory CONTENT {
            original_id: $after.id,
            content: $after.content,
            final_importance: $after.importance,
            archived_at: time::now()
        };
        DELETE $after.id;
    };
```

See also: [[Real-Time Live Queries and Changefeeds#DEFINE EVENT -- Server-Side Triggers]]

---

## 9. Computed Fields -- Dynamic Memory Scores

**Memory use case:** Calculate time-decaying importance scores, recency weights, access frequency metrics, and memory staleness indicators on every read without storing them. These values change with time and do not need to be persisted.

**Why it fits:** Computed fields are evaluated on every `SELECT`, making them ideal for time-dependent calculations. A memory's "recency score" naturally decays over time without any cron job or batch update.

### SurrealQL Examples

```surql
-- Recency score: decays exponentially with age (half-life of 7 days)
DEFINE FIELD recency_score ON memory
    COMPUTED math::pow(0.5, duration::days(time::now() - created_at) / 7.0);

-- Staleness indicator: true if not accessed in 30 days
DEFINE FIELD is_stale ON memory
    COMPUTED last_accessed IS NONE OR time::now() - last_accessed > 30d;

-- Composite retrieval score combining importance, recency, and frequency
DEFINE FIELD retrieval_score ON memory
    COMPUTED (importance * 0.4)
        + (math::pow(0.5, duration::days(time::now() - created_at) / 7.0) * 0.3)
        + (math::min([math::log(access_count + 1, 10) / 3.0, 1.0]) * 0.3);

-- Age in human-readable form
DEFINE FIELD age ON memory
    COMPUTED time::now() - created_at;

-- Whether a memory is "hot" (frequently accessed recently)
DEFINE FIELD is_hot ON memory
    COMPUTED access_count > 5
        AND last_accessed IS NOT NONE
        AND time::now() - last_accessed < 1h;

-- Usage: retrieve memories sorted by dynamic retrieval score
SELECT id, content, retrieval_score, recency_score, is_stale, is_hot
FROM memory
WHERE agent_id = agent:assistant_1
ORDER BY retrieval_score DESC
LIMIT 20;
```

See also: [[Core Features and Whats New#Computed Fields]] and [[Data Model and Multi-Model Architecture#Computed Fields and Dynamic Values]]

---

## 10. Record References (Bidirectional) -- Associative Memory Links

**Memory use case:** Create bidirectional links between memories, entities, and agents with automatic reverse tracking. When memory A references entity B, entity B automatically knows about memory A without explicit bookkeeping.

**Why it fits:** Associative memory requires bidirectional traversal -- "which memories mention this entity?" and "which entities does this memory mention?". Record references handle this at the schema level with configurable deletion behavior.

### SurrealQL Examples

```surql
-- Define a memory that references entities it mentions
DEFINE FIELD mentioned_entities ON memory
    TYPE option<array<record<entity>>>
    REFERENCE ON DELETE UNSET;

-- Define a computed reverse reference on entity: all memories that mention it
DEFINE FIELD mentioned_in ON entity
    COMPUTED <~(memory FIELD mentioned_entities);

-- Create a memory that mentions entities
CREATE memory:conv_456 SET
    agent_id = agent:assistant_1,
    content = "Paris is the capital of France and home to the Eiffel Tower",
    mentioned_entities = [entity:paris, entity:france, entity:eiffel_tower],
    importance = 0.6;

-- Query from the entity side: which memories mention Paris?
SELECT id, name, mentioned_in.content AS memory_texts
FROM entity:paris;

-- Bidirectional navigation without explicit RELATE
-- From memory -> entities:
SELECT mentioned_entities.name FROM memory:conv_456;
-- From entity -> memories:
SELECT mentioned_in.* FROM entity:paris;

-- Configurable deletion: if entity is deleted, unset the reference in memory
DELETE entity:eiffel_tower;
-- memory:conv_456.mentioned_entities no longer includes entity:eiffel_tower
```

See also: [[Data Model and Multi-Model Architecture#Record References -- Bidirectional Tracking]]

---

## 11. Permissions (Row-Level) -- Per-Agent Memory Isolation

**Memory use case:** Isolate each agent's memories so that agents can only read/write their own memories by default, with controlled sharing for collaborative workspaces. Row-level security enforces this at the database layer, not the application layer.

**Why it fits:** In multi-agent systems, agents should not accidentally access or corrupt each other's private memories. SurrealDB's `PERMISSIONS WHERE` clause enforces this on every query, even if the application code has bugs.

### SurrealQL Examples

```surql
-- Agent's private memories: only the owning agent can access
DEFINE TABLE private_memory SCHEMAFULL
    PERMISSIONS
        FOR select, update WHERE agent_id = $auth.id
        FOR create WHERE $auth.id IS NOT NONE
        FOR delete NONE;

-- Shared workspace memories: any agent in the workspace can read,
-- only the creator can update/delete
DEFINE TABLE shared_memory SCHEMAFULL
    PERMISSIONS
        FOR select WHERE workspace_id IN $auth.workspaces
        FOR create WHERE workspace_id IN $auth.workspaces
        FOR update WHERE agent_id = $auth.id
        FOR delete WHERE agent_id = $auth.id OR $auth.role = "admin";

-- Knowledge graph entities: readable by all agents in workspace,
-- writable only by agents with "knowledge_writer" role
DEFINE TABLE entity SCHEMAFULL
    PERMISSIONS
        FOR select WHERE workspace_id IN $auth.workspaces
        FOR create, update WHERE $auth.role IN ["knowledge_writer", "admin"]
        FOR delete WHERE $auth.role = "admin";

-- Field-level permissions: hide internal scoring from non-admin agents
DEFINE FIELD internal_score ON memory TYPE float
    PERMISSIONS
        FOR select WHERE $auth.role = "admin"
        FOR update WHERE $auth.role = "admin";

-- Agent can see their own embedding but not others'
DEFINE FIELD embedding ON memory TYPE array<float>
    PERMISSIONS
        FOR select WHERE agent_id = $auth.id OR $auth.role = "admin";
```

See also: [[Authentication and Permissions#Permissions and Authorization]]

---

## 12. SurrealML -- In-Database Embedding and Classification

**Memory use case:** Run embedding models and importance classifiers directly inside SurrealDB, eliminating external API calls for embedding generation and memory classification. Store a trained model, then call it from any SurrealQL query.

**Why it fits:** Every memory write that needs an embedding currently requires a round-trip to an external API (OpenAI, Ollama, etc.). SurrealML lets you deploy a model once and call it inline, reducing latency and eliminating network dependencies.

### SurrealQL Examples

```surql
-- After uploading an embedding model as a .surml file:
-- surreal import --conn http://localhost:8000 embedding-model.surml

-- Generate embeddings inline during memory creation
CREATE memory SET
    agent_id = agent:assistant_1,
    content = "The user prefers dark mode interfaces",
    embedding = ml::text-embedding<0.0.1>({
        text: "The user prefers dark mode interfaces"
    }),
    importance = 0.5;

-- Classify memory importance using a trained classifier
CREATE memory SET
    agent_id = agent:assistant_1,
    content = "Critical: production database migration scheduled for tomorrow",
    importance = ml::importance-classifier<0.0.1>({
        text: "Critical: production database migration scheduled for tomorrow",
        source: "conversation",
        has_deadline: true
    }),
    embedding = ml::text-embedding<0.0.1>({
        text: "Critical: production database migration scheduled for tomorrow"
    });

-- Batch re-embed all memories with a new model version
UPDATE memory SET
    embedding = ml::text-embedding<0.0.2>({
        text: content
    });
```

See also: [[SurrealML and AI Vector Capabilities#SurrealML Overview]]

---

## 13. Custom Functions -- Memory Scoring Algorithms

**Memory use case:** Define reusable memory scoring algorithms, decay functions, and retrieval ranking logic as named SurrealQL functions. These encapsulate complex scoring formulas that multiple agents or queries can reuse.

**Why it fits:** Memory scoring logic (exponential decay, frequency-recency tradeoffs, multi-factor ranking) is complex and should be defined once, tested, and reused across all memory retrieval paths.

### SurrealQL Examples

```surql
-- Exponential time decay function
DEFINE FUNCTION fn::time_decay($created_at: datetime, $half_life_days: float) {
    RETURN math::pow(0.5, duration::days(time::now() - $created_at) / $half_life_days);
};

-- Frequency-based importance boost (logarithmic scaling)
DEFINE FUNCTION fn::frequency_score($access_count: int) {
    RETURN math::min([math::log($access_count + 1, 10) / 3.0, 1.0]);
};

-- Composite memory relevance score
DEFINE FUNCTION fn::memory_relevance(
    $importance: float,
    $created_at: datetime,
    $access_count: int,
    $last_accessed: option<datetime>,
    $semantic_distance: float
) {
    LET $recency = fn::time_decay($created_at, 7.0);
    LET $frequency = fn::frequency_score($access_count);
    LET $freshness = IF $last_accessed {
        fn::time_decay($last_accessed, 3.0)
    } ELSE {
        0.0
    };
    LET $semantic_similarity = 1.0 - $semantic_distance;

    RETURN ($importance * 0.25)
         + ($recency * 0.15)
         + ($frequency * 0.10)
         + ($freshness * 0.10)
         + ($semantic_similarity * 0.40);
};

-- Use in retrieval queries
LET $query_embedding = [...];

SELECT id, content,
    fn::memory_relevance(
        importance,
        created_at,
        access_count,
        last_accessed,
        vector::distance::knn()
    ) AS relevance
FROM memory
WHERE agent_id = agent:assistant_1
    AND embedding <|20, 100|> $query_embedding
ORDER BY relevance DESC
LIMIT 10;

-- Memory consolidation: merge similar memories
DEFINE FUNCTION fn::should_consolidate($mem_a: record, $mem_b: record) {
    LET $similarity = vector::similarity::cosine($mem_a.embedding, $mem_b.embedding);
    LET $same_type = $mem_a.type = $mem_b.type;
    LET $time_close = duration::hours(
        math::abs(duration::secs($mem_a.created_at - $mem_b.created_at))
    ) < 24;
    RETURN $similarity > 0.92 AND $same_type AND $time_close;
};
```

See also: [[Advanced Features Functions Indexes Analyzers#Custom Functions (DEFINE FUNCTION)]]

---

## 14. DEFINE TABLE AS (Views) -- Memory Summaries

**Memory use case:** Create automatically maintained materialized views that aggregate memory statistics: per-agent memory counts, average importance by topic, most active knowledge domains, and workspace-level dashboards.

**Why it fits:** Table views are incrementally updated -- they do not recompute on every query. This makes them efficient for dashboards and summary statistics that agents consult frequently.

### SurrealQL Examples

```surql
-- Per-agent memory statistics (auto-updated on every memory write)
DEFINE TABLE agent_memory_stats AS
    SELECT
        agent_id,
        count() AS total_memories,
        math::mean(importance) AS avg_importance,
        time::max(created_at) AS last_memory_at,
        math::sum(access_count) AS total_accesses
    FROM memory
    GROUP BY agent_id;

-- Query agent stats like a regular table
SELECT * FROM agent_memory_stats WHERE agent_id = agent:assistant_1;

-- Per-type memory distribution
DEFINE TABLE memory_type_summary AS
    SELECT
        agent_id,
        type,
        count() AS count,
        math::mean(importance) AS avg_importance
    FROM episodic_memory
    GROUP BY agent_id, type;

-- Knowledge graph density metrics
DEFINE TABLE entity_connectivity AS
    SELECT
        entity_type,
        count() AS entity_count
    FROM entity
    GROUP BY entity_type;

-- Hot memories dashboard (DROP source after aggregation to save space)
DEFINE TABLE memory_access_log DROP;

DEFINE TABLE hourly_access_stats AS
    SELECT
        time::group(accessed_at, 'hour') AS hour,
        count() AS access_count,
        math::mean(importance) AS avg_importance_accessed
    FROM memory_access_log
    GROUP BY hour;
```

See also: [[Advanced Features Functions Indexes Analyzers#Pre-computed Table Views (DEFINE TABLE AS)]]

---

## 15. DEFINE ACCESS (Record-Level) -- Agent Authentication

**Memory use case:** Authenticate agents to the memory store using unique credentials. Each agent gets its own identity (`$auth.id`), roles, and workspace associations. Supports JWT for external identity providers, bearer tokens for service-to-service auth, and record-level access for direct agent authentication.

**Why it fits:** In production multi-agent systems, each agent needs its own authenticated identity to enforce memory isolation, audit access patterns, and prevent unauthorized memory modification.

### SurrealQL Examples

```surql
-- Define the agent table
DEFINE TABLE agent SCHEMAFULL
    PERMISSIONS
        FOR select WHERE id = $auth.id OR $auth.role = "admin"
        FOR update WHERE id = $auth.id
        FOR create, delete NONE;

DEFINE FIELD name ON agent TYPE string;
DEFINE FIELD role ON agent TYPE string DEFAULT "agent";
DEFINE FIELD workspaces ON agent TYPE array<record<workspace>> DEFAULT [];
DEFINE FIELD password ON agent TYPE string;
DEFINE INDEX agent_name ON agent FIELDS name UNIQUE;

-- Define agent authentication access method
DEFINE ACCESS agent_auth ON DATABASE TYPE RECORD
    SIGNUP (
        CREATE agent CONTENT {
            name: $name,
            password: crypto::argon2::generate($password),
            role: "agent",
            workspaces: $workspaces ?? []
        }
    )
    SIGNIN (
        SELECT * FROM agent
        WHERE name = $name
          AND crypto::argon2::compare(password, $password)
    )
    DURATION FOR TOKEN 15m, FOR SESSION 12h;

-- Define bearer access for long-running agent processes
DEFINE ACCESS agent_bearer ON DATABASE TYPE BEARER FOR RECORD
    DURATION FOR GRANT 30d, FOR TOKEN 5m, FOR SESSION 24h;

-- Generate a bearer key for an agent
ACCESS agent_bearer GRANT FOR RECORD agent:assistant_1;

-- JWT access for agents authenticated by an external orchestrator
DEFINE ACCESS orchestrator_jwt ON DATABASE TYPE JWT
    URL "https://orchestrator.example.com/.well-known/jwks.json"
    DURATION FOR SESSION 4h;
```

See also: [[Authentication and Permissions#Access Methods (DEFINE ACCESS)]]

---

## 16. DEFINE API (3.0) -- Custom Memory API Endpoints

**Memory use case:** Expose custom HTTP endpoints for memory operations: recall, store, search, consolidate. Agents or external systems can call these without needing a SurrealDB client library. Middleware can add rate limiting, logging, and transformation.

**Why it fits:** `DEFINE API` turns SurrealDB into a self-contained memory service with custom REST endpoints. No external API gateway needed.

### SurrealQL Examples

```surql
-- Memory recall endpoint
DEFINE API "/memory/recall" FOR post THEN {
    LET $body = $request.body;
    LET $results = fn::hybrid_memory_search(
        $auth.id,
        $body.query_text,
        $body.query_embedding,
        $body.k ?? 10
    );
    RETURN { status: 200, body: $results };
};

-- Memory store endpoint
DEFINE API "/memory/store" FOR post THEN {
    LET $body = $request.body;
    LET $mem = CREATE memory SET
        agent_id = $auth.id,
        content = $body.content,
        metadata = $body.metadata ?? {},
        importance = $body.importance ?? 0.5,
        embedding = $body.embedding;
    RETURN { status: 201, body: $mem };
};

-- Knowledge graph query endpoint
DEFINE API "/knowledge/related/:entity_id" FOR get THEN {
    LET $entity = type::record("entity", $entity_id);
    LET $related = SELECT
        ->relates_to.relation_type AS relation,
        ->relates_to.strength AS strength,
        ->relates_to->entity.* AS target
    FROM $entity
    ORDER BY strength DESC;
    RETURN { status: 200, body: $related };
};

-- Memory statistics endpoint
DEFINE API "/memory/stats" FOR get THEN {
    LET $stats = SELECT * FROM agent_memory_stats
        WHERE agent_id = $auth.id;
    RETURN { status: 200, body: $stats };
};
```

See also: [[Advanced Features Functions Indexes Analyzers#DEFINE API (3.0)]]

---

## 17. File Storage (3.0) -- Multimodal Memories

**Memory use case:** Store images, audio recordings, documents, and other files as part of an agent's memory. A visual agent can remember screenshots; a voice agent can store audio clips; a document agent can archive PDFs alongside their metadata and embeddings.

**Why it fits:** SurrealDB 3.0's native file storage eliminates the need for a separate object store (S3, GCS). Files are queryable alongside structured data in the same SurrealQL query.

### SurrealQL Examples

```surql
-- Define a bucket for agent memory files
DEFINE BUCKET memory_files;

-- Store a multimodal memory with an attached image
CREATE memory SET
    agent_id = agent:vision_agent,
    type = "visual_observation",
    content = "User's whiteboard diagram showing system architecture",
    importance = 0.8,
    embedding = [...],
    attached_file = f"memory_files:/whiteboard_2026-02-23.png";

-- Query memories with their associated files
SELECT content, importance, attached_file
FROM memory
WHERE agent_id = agent:vision_agent
    AND type = "visual_observation"
ORDER BY created_at DESC;
```

See also: [[Core Features and Whats New#File Storage]]

---

## 18. Surrealism WASM Extensions -- In-Database AI Logic

**Memory use case:** Run embedding models, importance classifiers, entity extractors, and memory consolidation logic directly inside SurrealDB at near-native speed. No external API calls, no network latency, full ACID transactional consistency.

**Why it fits:** Surrealism plugins execute within the same transaction as the invoking query. An INSERT that generates an embedding, classifies importance, and extracts entities happens atomically.

### SurrealQL Examples

```surql
-- Load a WASM embedding model (conceptual -- syntax may evolve)
DEFINE MODULE memory_embedder TYPE WASM;

-- Use in-database embedding on every memory write
DEFINE EVENT auto_embed ON TABLE memory
    WHEN $event = "CREATE"
    THEN {
        UPDATE $after.id SET
            embedding = memory_embedder::embed($after.content)
    };

-- Entity extraction via WASM plugin
DEFINE MODULE entity_extractor TYPE WASM;

DEFINE EVENT auto_extract_entities ON TABLE memory
    WHEN $event = "CREATE"
    THEN {
        LET $entities = entity_extractor::extract($after.content);
        FOR $ent IN $entities {
            UPSERT entity SET
                name = $ent.name,
                entity_type = $ent.type,
                mention_count += 1
            WHERE name = $ent.name;
        };
    };
```

See also: [[SurrealML and AI Vector Capabilities#Surrealism -- WASM Extensions for AI]]

---

## 19. Namespaces and Databases -- Multi-Tenant Agent Memory

**Memory use case:** Isolate different projects, organizations, or environments using SurrealDB's namespace/database hierarchy. Each tenant gets its own database with its own schema, agents, and memory -- complete isolation without separate database instances.

### SurrealQL Examples

```surql
-- Organization-level isolation via namespaces
DEFINE NAMESPACE org_acme;
DEFINE NAMESPACE org_globex;

-- Project-level isolation via databases within a namespace
USE NS org_acme;
DEFINE DATABASE project_alpha;
DEFINE DATABASE project_beta;

-- Each database has its own complete memory schema
USE NS org_acme DB project_alpha;
DEFINE TABLE memory SCHEMAFULL;
DEFINE TABLE entity SCHEMAFULL;
-- ...

-- Agents authenticate at the database level
DEFINE ACCESS agent_auth ON DATABASE TYPE RECORD ...;
```

---

## 20. Client-Side Transactions (3.0) -- Atomic Memory Operations

**Memory use case:** Group multiple memory operations into a single atomic transaction from the client side. Store a memory, create entity nodes, link them with relationships, and update statistics -- all atomically.

### SurrealQL Examples

```surql
-- Atomic memory ingestion: store memory + extract entities + create links
BEGIN;

-- Create the memory
LET $mem = CREATE ONLY memory SET
    agent_id = agent:assistant_1,
    content = "Paris is the capital of France",
    importance = 0.6,
    embedding = [...];

-- Upsert entities
LET $paris = UPSERT entity SET
    name = "Paris",
    entity_type = "city",
    mention_count += 1
WHERE name = "Paris";

LET $france = UPSERT entity SET
    name = "France",
    entity_type = "country",
    mention_count += 1
WHERE name = "France";

-- Create relationships
RELATE $paris[0].id->relates_to->$france[0].id SET
    relation_type = "capital_of",
    strength = 1.0;

-- Link memory to entities
UPDATE $mem.id SET
    mentioned_entities = [$paris[0].id, $france[0].id];

COMMIT;
```

---

## 21. Record IDs -- Natural Memory Addressing

**Memory use case:** Use composite record IDs for natural addressing of time-series memories, session-scoped memories, and entity-keyed data. Array-based IDs enable efficient range queries over time windows.

### SurrealQL Examples

```surql
-- Time-series memory IDs for efficient temporal queries
CREATE memory:['agent_1', d'2026-02-23T10:30:00Z'] SET
    content = "Started task analysis",
    importance = 0.3;

CREATE memory:['agent_1', d'2026-02-23T10:31:00Z'] SET
    content = "Found relevant documentation",
    importance = 0.5;

-- Range query: all memories from agent_1 in the last hour
SELECT * FROM memory:['agent_1', NONE]..=['agent_1', time::now()];

-- Session-scoped memory IDs
CREATE session_memory:['sess_abc', 1] SET content = "User greeted";
CREATE session_memory:['sess_abc', 2] SET content = "User asked about pricing";

-- Range query: all memories from a session
SELECT * FROM session_memory:['sess_abc', NONE]..=['sess_abc', ..];
```

---

## Competitive Advantages Over Postgres+pgvector and Neo4j+Vector

### Why SurrealDB is uniquely suited for agentic memory

| Dimension | SurrealDB | Postgres + pgvector | Neo4j + Vector |
|---|---|---|---|
| **Unified query language** | One SurrealQL query does vector search + graph traversal + keyword search + aggregation | Requires mixing SQL, pgvector operators, possibly FDW for graph, Elasticsearch for FTS | Cypher for graph, separate vector plugin, no native FTS |
| **Graph + vector in one query** | `SELECT * FROM memory WHERE embedding <\|5\|> $vec ORDER BY ->relates_to->entity.name` | Requires CTEs or application-level joins | Vector search is a plugin, not deeply integrated into Cypher |
| **Hybrid search built-in** | `search::rrf()` and `search::linear()` built into the query language | Must implement RRF in application code or use external tools | Not available |
| **Real-time subscriptions** | `LIVE SELECT` pushes memory changes to agents over WebSocket | Requires LISTEN/NOTIFY + external pub-sub (Redis, Kafka) | Not native |
| **Row-level security** | `PERMISSIONS WHERE agent_id = $auth.id` on every table | Requires RLS policies per table, less expressive WHERE clauses | Basic role-based, no row-level |
| **Direct client auth** | Agents authenticate directly to the database with DEFINE ACCESS | Requires middleware/API layer for auth | Requires middleware |
| **Multi-model in single engine** | Documents + graph + vectors + FTS + time-series + geospatial | Relational + pgvector (bolt-on) + GIN/GiST for FTS | Graph + bolt-on vector |
| **Embedded deployment** | In-memory, WASM (browser), or on-disk -- same API | Server required | Server required |
| **Schema flexibility** | Mix SCHEMAFULL and SCHEMALESS per table, FLEXIBLE fields | Schema required (or use JSONB) | Schema-optional but flat properties |
| **Edge tables** | Full tables with schema, indexes, permissions | Not applicable (no native graph) | Properties on edges, limited indexing |
| **Materialized views** | `DEFINE TABLE AS` with auto-incremental update | Requires manual refresh or triggers | Not available |
| **In-database ML inference** | SurrealML + Surrealism WASM extensions | pgml extension (experimental) | Not available |
| **Custom API endpoints** | `DEFINE API` turns the database into a REST service | Requires external API layer | Requires external API layer |
| **File storage** | Native (3.0) | Requires external storage (S3, etc.) | Not available |
| **Changefeeds** | Built-in CDC with configurable retention | Logical replication (complex setup) | Not available |
| **Single binary** | One binary handles everything | Multiple components (PG + pgvector + FTS + connection pooler) | Neo4j server + plugins |

### Unique advantages for agentic memory specifically

1. **Single-query multimodal retrieval:** A single SurrealQL query can find semantically similar memories (HNSW), traverse their knowledge graph connections (arrow syntax), run keyword search (BM25), fuse results (search::rrf), and return enriched results with computed fields (recency score, staleness) -- all in one ACID transaction. This would require 3-4 separate queries and application-level join logic in a Postgres+Neo4j stack.

2. **Memory isolation without middleware:** Row-level permissions + record-level authentication means each agent authenticates directly to SurrealDB and can only see its own memories. No API gateway or middleware needed.

3. **Reactive memory architecture:** LIVE SELECT enables agents to react to memory changes in real-time without polling. No external pub-sub infrastructure needed.

4. **Self-contained memory service:** DEFINE API + DEFINE ACCESS + built-in auth turns SurrealDB into a complete memory API service. Deploy one binary instead of database + API server + auth service + message broker.

5. **Context graphs as first-class data:** Graph edges in SurrealDB are full tables with schema, indexes, and permissions. In Postgres, modeling a knowledge graph requires complex many-to-many tables with self-joins. In Neo4j, you get the graph but lose document flexibility and vector search.

---

## Gaps -- What SurrealDB Does Not Cover Well

### 1. Large Language Model inference

SurrealML supports traditional ML models (regression, classification, small neural nets) via ONNX Runtime, but cannot run multi-billion-parameter LLMs. Embedding generation for large models (GPT-4, Claude) must still be done externally. Surrealism WASM extensions may eventually bridge this gap, but currently they are better suited for smaller models and custom logic.

**Workaround:** Use external embedding APIs (OpenAI, Ollama, Bedrock) and store the resulting vectors. Use DEFINE EVENT with `http::post` to auto-generate embeddings on write.

### 2. Distributed LIVE SELECT

As of SurrealDB 3.0, LIVE SELECT is single-node only. Multi-node live queries are in active development. This means real-time memory notifications do not work in horizontally scaled deployments.

**Workaround:** Use changefeeds (SHOW CHANGES FOR TABLE) for distributed change detection. Poll at a reasonable interval or use an external message broker for cross-node notifications.

### 3. Advanced graph algorithms

SurrealDB supports multi-hop traversal and filtered paths, but lacks built-in graph algorithms like PageRank, community detection, shortest path (Dijkstra/BFS), centrality measures, and graph embeddings (Node2Vec). Neo4j's GDS (Graph Data Science) library is significantly more capable for analytical graph workloads.

**Workaround:** Export graph data to a specialized tool for analysis, or implement simple algorithms as custom functions. For PageRank-like memory importance, use iterative SurrealQL updates.

### 4. Production maturity and ecosystem

SurrealDB is younger than PostgreSQL (40+ years) and Neo4j (15+ years). Some features (refresh tokens, bearer access) are still experimental. The community is smaller, and there are fewer battle-tested production deployments at scale. Security audit history is thinner.

**Mitigation:** Use SurrealDB for the memory layer specifically, where its multi-model advantages are strongest. Keep critical transactional systems on proven databases.

### 5. Vector search precision tuning

SurrealDB's HNSW implementation is functional but lacks some advanced features found in dedicated vector databases:
- No product quantization (PQ) for memory-efficient large-scale indexes
- No dimensionality reduction or scalar quantization
- No per-query metadata filtering integrated into the HNSW traversal (post-filtering only)
- `vector::distance::mahalanobis` is unimplemented
- No support for sparse vectors or late interaction models (ColBERT)

**Workaround:** For very large-scale vector workloads (millions+ vectors with complex filtering), consider a dedicated vector database alongside SurrealDB for the graph/document layers. For moderate scales (hundreds of thousands), SurrealDB's HNSW is adequate.

### 6. Temporal versioning and time-travel queries

While SurrealKV supports versioned storage, SurrealDB does not yet expose time-travel queries at the SurrealQL level (e.g., "what did this memory look like 3 days ago?"). Changefeeds provide change history but require application-level reconstruction.

**Workaround:** Use changefeeds with INCLUDE ORIGINAL to capture before/after states. Build a history table with events to reconstruct past states.

### 7. Native memory consolidation / summarization

SurrealDB has no built-in memory consolidation or summarization engine. Operations like "merge similar memories into a summary" or "compress old memories" require application logic or LLM calls.

**Workaround:** Implement consolidation as DEFINE EVENT triggers that call external summarization APIs, or use Surrealism WASM plugins for lightweight summarization.

### 8. Observability for memory operations

While the official SurrealMCP supports OpenTelemetry, the core SurrealDB server has limited built-in observability. There are no native memory-specific metrics (cache hit rates, retrieval latency percentiles, embedding index coverage).

**Workaround:** Use application-level instrumentation, SurrealDB's slow query logging (3.0), and external monitoring via changefeeds.

---

## Summary: Feature-to-Memory-Use-Case Matrix

| SurrealDB Feature | Agentic Memory Use Case | Unique Advantage |
|---|---|---|
| Documents (schemaless JSON) | Episodic memory storage | Flexible schema per memory type |
| Graph relations (RELATE) | Knowledge graph, associative memory | Edge tables with full schema + metadata |
| HNSW vector indexes | Semantic similarity search | 8x faster in 3.0, unified with graph/FTS |
| BM25 full-text search | Keyword-based memory recall | Built-in analyzers, stemming, highlights |
| Hybrid search (RRF/linear) | Combined retrieval strategies | Built into query language, no external fusion |
| LIVE SELECT | Real-time memory notifications | Push-based, no external pub-sub needed |
| Changefeeds | Memory evolution audit trail | Persistent, replayable, configurable retention |
| DEFINE EVENT | Memory consolidation triggers | Sync + async, same-transaction guarantees |
| Computed fields | Dynamic memory scores (recency, importance) | Evaluated on read, time-dependent by nature |
| Record references | Associative memory links | Bidirectional at schema level, auto-tracked |
| Permissions (row-level) | Per-agent memory isolation | WHERE clauses on table permissions |
| SurrealML | In-database embedding/classification | ONNX-based, no external API needed |
| Custom functions | Memory scoring algorithms | Reusable, typed, permissioned |
| Table views (DEFINE TABLE AS) | Memory summaries, dashboards | Incrementally maintained materialized views |
| DEFINE ACCESS | Agent authentication | Direct client-to-DB auth |
| DEFINE API (3.0) | Custom memory API endpoints | Database as REST service |
| File storage (3.0) | Multimodal memories | Native, queryable alongside structured data |
| Surrealism WASM | In-database AI logic | Near-native speed, transactional |
| Namespaces/Databases | Multi-tenant agent memory | Hierarchical isolation |
| Client-side transactions | Atomic memory operations | ACID across memory + graph + entities |
| Record IDs (composite) | Natural memory addressing | Array-based IDs enable time-range queries |

---

*See also:*
- [[SurrealDB 3.0 Research Index]]
- [[Core Features and Whats New]]
- [[Data Model and Multi-Model Architecture]]
- [[SurrealML and AI Vector Capabilities]]
- [[Real-Time Live Queries and Changefeeds]]
- [[Advanced Features Functions Indexes Analyzers]]
- [[Authentication and Permissions]]
- [[SurrealDB MCP Server]]
- [[SDKs Deployment and Ecosystem]]
