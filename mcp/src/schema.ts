/**
 * SurrealDB schema definitions for the memory plugin.
 *
 * All DEFINE TABLE, FIELD, INDEX, ANALYZER, and EVENT statements live here.
 * Imported by surrealdb-client.ts initSchema().
 */

/** BM25 full-text search analyzer */
export const ANALYZER_SQL = `
  DEFINE ANALYZER IF NOT EXISTS memory_analyzer TOKENIZERS blank, class
    FILTERS ascii, lowercase, snowball(english);
`;

/** Core memory table — stores all memory records */
export const MEMORY_TABLE_SQL = `
  DEFINE TABLE IF NOT EXISTS memory SCHEMAFULL;

  DEFINE FIELD IF NOT EXISTS content ON memory TYPE string;
  DEFINE FIELD IF NOT EXISTS memory_type ON memory TYPE string
    ASSERT $value IN ['episodic', 'semantic', 'procedural', 'working'];
  DEFINE FIELD IF NOT EXISTS scope ON memory TYPE string
    ASSERT $value IN ['session', 'project', 'user'];
  DEFINE FIELD IF NOT EXISTS tags ON memory TYPE array<string> DEFAULT [];
  DEFINE FIELD IF NOT EXISTS embedding ON memory TYPE option<array<float>>;
  DEFINE FIELD IF NOT EXISTS importance ON memory TYPE float DEFAULT 0.5;
  DEFINE FIELD IF NOT EXISTS confidence ON memory TYPE float DEFAULT 0.7;
  DEFINE FIELD IF NOT EXISTS access_count ON memory TYPE int DEFAULT 0;
  DEFINE FIELD IF NOT EXISTS status ON memory TYPE string DEFAULT 'active'
    ASSERT $value IN ['active', 'consolidated', 'archived', 'forgotten'];
  DEFINE FIELD IF NOT EXISTS source ON memory TYPE option<string>;
  DEFINE FIELD IF NOT EXISTS session_id ON memory TYPE option<string>;
  DEFINE FIELD IF NOT EXISTS created_at ON memory TYPE datetime DEFAULT time::now();
  DEFINE FIELD IF NOT EXISTS updated_at ON memory TYPE datetime DEFAULT time::now();
  DEFINE FIELD IF NOT EXISTS last_accessed_at ON memory TYPE datetime DEFAULT time::now();
  DEFINE FIELD IF NOT EXISTS metadata ON memory FLEXIBLE TYPE option<object>;

  -- Computed memory strength: exponential decay weighted by memory type.
  -- Procedural decays slowest (0.999), semantic mid (0.995), episodic faster (0.99), working fastest (0.95).
  -- strength = importance * decay_rate ^ hours_since_last_access
  DEFINE FIELD IF NOT EXISTS memory_strength ON memory VALUE
    importance * math::pow(
      IF memory_type = 'procedural' THEN 0.999
      ELSE IF memory_type = 'semantic' THEN 0.995
      ELSE IF memory_type = 'episodic' THEN 0.99
      ELSE 0.95
      END,
      duration::hours(time::now() - last_accessed_at)
    );

  -- Indexes for common queries
  DEFINE INDEX IF NOT EXISTS memory_scope ON memory FIELDS scope;
  DEFINE INDEX IF NOT EXISTS memory_type_idx ON memory FIELDS memory_type;
  DEFINE INDEX IF NOT EXISTS memory_status ON memory FIELDS status;
  DEFINE INDEX IF NOT EXISTS memory_tags ON memory FIELDS tags;

  -- BM25 full-text search index
  DEFINE INDEX IF NOT EXISTS memory_content_search ON memory
    FIELDS content SEARCH ANALYZER memory_analyzer BM25;

  -- HNSW vector index for embedding similarity search (Phase 2)
  DEFINE INDEX IF NOT EXISTS memory_embedding ON memory
    FIELDS embedding HNSW DIMENSION 384 DIST COSINE;
`;

/** Entity table — knowledge graph nodes */
export const ENTITY_TABLE_SQL = `
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

  -- HNSW vector index for entity embedding similarity
  DEFINE INDEX IF NOT EXISTS entity_embedding ON entity
    FIELDS embedding HNSW DIMENSION 384 DIST COSINE;
`;

/** Relationship edge table — knowledge graph edges */
export const RELATES_TO_TABLE_SQL = `
  DEFINE TABLE IF NOT EXISTS relates_to TYPE RELATION FROM entity TO entity SCHEMAFULL;

  DEFINE FIELD IF NOT EXISTS relation_type ON relates_to TYPE string;
  DEFINE FIELD IF NOT EXISTS weight ON relates_to TYPE float DEFAULT 0.5;
  DEFINE FIELD IF NOT EXISTS confidence ON relates_to TYPE float DEFAULT 0.7;
  DEFINE FIELD IF NOT EXISTS scope ON relates_to TYPE string;
  DEFINE FIELD IF NOT EXISTS evidence ON relates_to TYPE option<array<string>>;
  DEFINE FIELD IF NOT EXISTS created_at ON relates_to TYPE datetime DEFAULT time::now();
`;

/** Consolidation queue — tracks memories pending consolidation */
export const CONSOLIDATION_QUEUE_TABLE_SQL = `
  DEFINE TABLE IF NOT EXISTS consolidation_queue SCHEMAFULL;

  DEFINE FIELD IF NOT EXISTS memory_id ON consolidation_queue TYPE record<memory>;
  DEFINE FIELD IF NOT EXISTS reason ON consolidation_queue TYPE string
    ASSERT $value IN ['decay', 'duplicate', 'promotion', 'merge', 'scheduled'];
  DEFINE FIELD IF NOT EXISTS priority ON consolidation_queue TYPE float DEFAULT 0.5;
  DEFINE FIELD IF NOT EXISTS status ON consolidation_queue TYPE string DEFAULT 'pending'
    ASSERT $value IN ['pending', 'processing', 'completed', 'failed'];
  DEFINE FIELD IF NOT EXISTS created_at ON consolidation_queue TYPE datetime DEFAULT time::now();
  DEFINE FIELD IF NOT EXISTS processed_at ON consolidation_queue TYPE option<datetime>;

  DEFINE INDEX IF NOT EXISTS cq_status ON consolidation_queue FIELDS status;
  DEFINE INDEX IF NOT EXISTS cq_priority ON consolidation_queue FIELDS priority;
`;

/** Retrieval log — tracks memory accesses for feedback and adaptation */
export const RETRIEVAL_LOG_TABLE_SQL = `
  DEFINE TABLE IF NOT EXISTS retrieval_log SCHEMAFULL;

  DEFINE FIELD IF NOT EXISTS memory_id ON retrieval_log TYPE option<record<memory>>;
  DEFINE FIELD IF NOT EXISTS event_type ON retrieval_log TYPE string DEFAULT 'search'
    ASSERT $value IN ['search', 'access', 'lifecycle_transition', 'consolidation'];
  DEFINE FIELD IF NOT EXISTS query ON retrieval_log TYPE option<string>;
  DEFINE FIELD IF NOT EXISTS strategy ON retrieval_log TYPE string DEFAULT 'bm25';
  DEFINE FIELD IF NOT EXISTS results_count ON retrieval_log TYPE int DEFAULT 0;
  DEFINE FIELD IF NOT EXISTS memory_ids ON retrieval_log TYPE array<record<memory>> DEFAULT [];
  DEFINE FIELD IF NOT EXISTS old_status ON retrieval_log TYPE option<string>;
  DEFINE FIELD IF NOT EXISTS new_status ON retrieval_log TYPE option<string>;
  DEFINE FIELD IF NOT EXISTS was_useful ON retrieval_log TYPE option<bool>;
  DEFINE FIELD IF NOT EXISTS session_id ON retrieval_log TYPE option<string>;
  DEFINE FIELD IF NOT EXISTS created_at ON retrieval_log TYPE datetime DEFAULT time::now();

  DEFINE INDEX IF NOT EXISTS rl_event_type ON retrieval_log FIELDS event_type;
  DEFINE INDEX IF NOT EXISTS rl_timestamp ON retrieval_log FIELDS created_at;
`;

/** Evolution state — tracks memory system self-tuning parameters */
export const EVOLUTION_STATE_TABLE_SQL = `
  DEFINE TABLE IF NOT EXISTS evolution_state SCHEMAFULL;

  DEFINE FIELD IF NOT EXISTS key ON evolution_state TYPE string;
  DEFINE FIELD IF NOT EXISTS value ON evolution_state FLEXIBLE TYPE object;
  DEFINE FIELD IF NOT EXISTS updated_at ON evolution_state TYPE datetime DEFAULT time::now();

  DEFINE INDEX IF NOT EXISTS evolution_key ON evolution_state FIELDS key UNIQUE;
`;

/** Events for automatic memory lifecycle management */
export const EVENTS_SQL = `
  -- Log lifecycle transitions (status changes)
  DEFINE EVENT IF NOT EXISTS memory_lifecycle ON TABLE memory WHEN
    $before.status != $after.status
  THEN {
    CREATE retrieval_log SET
      memory_id = $after.id,
      event_type = 'lifecycle_transition',
      old_status = $before.status,
      new_status = $after.status;
  };

  -- Auto-queue memories for consolidation when access drops off
  DEFINE EVENT IF NOT EXISTS memory_decay_check ON memory WHEN $after.status = 'active' THEN {
    LET $age_days = duration::days(time::now() - $after.created_at);
    LET $since_access = duration::days(time::now() - $after.last_accessed_at);
    IF $age_days > 30 AND $since_access > 14 AND $after.importance < 0.3 THEN
      CREATE consolidation_queue SET
        memory_id = $after.id,
        reason = 'decay',
        priority = 1.0 - $after.importance
    END;
  };
`;

/** Seed default evolution_state values for system tuning parameters (idempotent via UPSERT) */
export const EVOLUTION_SEED_SQL = [
  `UPSERT evolution_state SET key = 'scope_weights', value = { session: 1.5, project: 1.0, user: 0.7 }, updated_at = time::now() WHERE key = 'scope_weights';`,
  `UPSERT evolution_state SET key = 'decay_half_lives', value = { working: 0.042, episodic: 1.0, semantic: 7.0, procedural: 30.0 }, updated_at = time::now() WHERE key = 'decay_half_lives';`,
  `UPSERT evolution_state SET key = 'promotion_thresholds', value = { importance: 0.5, access_count: 2 }, updated_at = time::now() WHERE key = 'promotion_thresholds';`,
  `UPSERT evolution_state SET key = 'retrieval_strategy', value = { default_strategy: 'bm25' }, updated_at = time::now() WHERE key = 'retrieval_strategy';`,
];

/** All schema SQL in execution order */
export const ALL_SCHEMA_SQL = [
  ANALYZER_SQL,
  MEMORY_TABLE_SQL,
  ENTITY_TABLE_SQL,
  RELATES_TO_TABLE_SQL,
  CONSOLIDATION_QUEUE_TABLE_SQL,
  RETRIEVAL_LOG_TABLE_SQL,
  EVOLUTION_STATE_TABLE_SQL,
  EVENTS_SQL,
  ...EVOLUTION_SEED_SQL,
];
