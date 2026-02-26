---
name: surrealql
description: |
  This skill should be used when writing SurrealQL queries for SurrealDB 3.0,
  modifying the engram schema, or debugging SurrealQL errors. Triggers on:
  "SurrealQL", "surql", "SurrealDB query", "schema change", "DEFINE TABLE",
  "DEFINE FIELD", "DEFINE INDEX", "UPSERT", "RELATE", or any SurrealDB DDL.
---

# SurrealQL Reference for SurrealDB 3.0

Quick reference for writing correct SurrealQL. SurrealDB is NOT MySQL, Postgres,
or SQLite — it has its own dialect. Defaults to generic SQL intuitions will produce
bugs.

## Critical Gotchas

### UPSERT, not ON DUPLICATE KEY UPDATE

MySQL:
```sql
INSERT INTO t (id, val) VALUES (1, 'x') ON DUPLICATE KEY UPDATE val = 'x';
```

SurrealDB 3.0:
```surql
UPSERT t SET key = 'mykey', val = 'x', updated_at = time::now() WHERE key = 'mykey';
```

There is no `ON DUPLICATE KEY`. Use `UPSERT ... WHERE` for idempotent inserts.

### COMPUTED fields use VALUE, not COMPUTED

```surql
-- Correct (SurrealDB 3.0)
DEFINE FIELD IF NOT EXISTS strength ON memory VALUE importance * math::pow(0.999, duration::hours(time::now() - last_accessed_at));

-- Wrong (older docs may show this)
DEFINE FIELD IF NOT EXISTS strength ON memory COMPUTED ...;
```

### SCHEMAFULL vs SCHEMALESS

```surql
DEFINE TABLE IF NOT EXISTS memory SCHEMAFULL;   -- strict: only defined fields allowed
DEFINE TABLE IF NOT EXISTS scratch SCHEMALESS;   -- flexible: any fields allowed
```

Use `SCHEMAFULL` for core tables. Use `FLEXIBLE TYPE` for individual fields that need
to accept arbitrary data within a SCHEMAFULL table:

```surql
DEFINE FIELD IF NOT EXISTS metadata ON memory FLEXIBLE TYPE option<object>;
```

### Graph Relations use TYPE RELATION

```surql
-- Define a relation table
DEFINE TABLE IF NOT EXISTS relates_to TYPE RELATION FROM entity TO entity SCHEMAFULL;

-- Create an edge
RELATE entity:foo->relates_to->entity:bar SET
  relation_type = 'imports',
  weight = 0.8;
```

Graph traversal uses arrow syntax:
```surql
-- One hop
SELECT ->relates_to->entity.name FROM entity:foo;

-- Reverse
SELECT <-relates_to<-entity.name FROM entity:bar;

-- Two hops
SELECT ->relates_to->entity->relates_to->entity.name FROM entity:foo;
```

### String Delimiters

SurrealDB supports three string delimiters:
- `'single quotes'` — string literals
- `"double quotes"` — string literals (identical to single)
- `` `backticks` `` — identifier quoting (table/field names with special chars)

Backticks can contain keywords: `` `DROP TABLE` `` is a valid identifier, not DDL.
Security validators must strip backtick content before checking for blocked keywords.

## BM25 Full-Text Search

```surql
-- Define analyzer
DEFINE ANALYZER IF NOT EXISTS memory_analyzer
  TOKENIZERS blank, class
  FILTERS ascii, lowercase, snowball(english);

-- Define search index
DEFINE INDEX IF NOT EXISTS memory_content_search ON memory
  FIELDS content SEARCH ANALYZER memory_analyzer BM25;

-- Query with score
SELECT *, search::score(1) AS relevance
FROM memory
WHERE content @1@ 'search terms'
ORDER BY relevance DESC
LIMIT 10;
```

The `@1@` operator binds to `search::score(1)`. Use `@2@` for a second search
field binding to `search::score(2)`.

## HNSW Vector Search

```surql
-- Define index (384-dim cosine similarity)
DEFINE INDEX IF NOT EXISTS memory_embedding ON memory
  FIELDS embedding HNSW DIMENSION 384 DIST COSINE;

-- Query by vector similarity
SELECT *, vector::similarity::cosine(embedding, $query_embedding) AS sim
FROM memory
WHERE embedding != NONE
ORDER BY sim DESC
LIMIT 10;
```

Distance options: `COSINE`, `EUCLIDEAN`, `MANHATTAN`.

## Hybrid Search (BM25 + HNSW)

SurrealDB does not have a built-in `search::rrf()` that combines BM25 and HNSW
in a single query automatically. Combine scores manually:

```surql
SELECT *,
  search::score(1) AS bm25_score,
  vector::similarity::cosine(embedding, $embedding) AS vec_score
FROM memory
WHERE content @1@ $query AND status = 'active'
ORDER BY (search::score(1) * 0.3 + vector::similarity::cosine(embedding, $embedding) * 0.3 + memory_strength * 0.4) DESC
LIMIT $limit;
```

## Common Patterns

### Idempotent Schema (IF NOT EXISTS)

All DDL must use `IF NOT EXISTS` for idempotent startup:

```surql
DEFINE TABLE IF NOT EXISTS memory SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS content ON memory TYPE string;
DEFINE INDEX IF NOT EXISTS memory_scope ON memory FIELDS scope;
DEFINE EVENT IF NOT EXISTS lifecycle ON TABLE memory WHEN ...;
```

### Namespace / Database Hierarchy

```surql
USE NS memory DB project_abc;  -- switch context
```

SurrealDB's hierarchy: Instance > Namespace > Database > Table.
Engram maps: memory (ns) > session/project/user (db) > memory/entity/etc (table).

### Events

```surql
DEFINE EVENT IF NOT EXISTS memory_lifecycle ON TABLE memory
  WHEN $before.status != $after.status
THEN {
  CREATE retrieval_log SET
    memory_id = $after.id,
    event_type = 'lifecycle_transition',
    old_status = $before.status,
    new_status = $after.status;
};
```

`$before` = row state before update. `$after` = row state after update.
Events fire on every matching UPDATE, not just status transitions.

### Parameterized Queries

Always use `$variable` bindings, never string interpolation:

```surql
-- Correct
SELECT * FROM memory WHERE scope = $scope AND importance >= $threshold;

-- Wrong (injection risk)
SELECT * FROM memory WHERE scope = '${scope}';
```

### Array Operations

```surql
-- Union (deduplicated merge)
UPDATE memory SET tags = array::union(tags, $new_tags);

-- Contains check
SELECT * FROM memory WHERE tags CONTAINS 'auth';
SELECT * FROM memory WHERE tags CONTAINSANY ['auth', 'jwt'];

-- Length
SELECT * FROM memory WHERE array::len(tags) > 0;
```

### Time Operations

```surql
-- Duration arithmetic
SELECT * FROM memory WHERE created_at > time::now() - 7d;
SELECT * FROM memory WHERE last_accessed_at < time::now() - 30d;

-- Duration extraction
duration::hours(time::now() - last_accessed_at)
duration::days(time::now() - created_at)
```

### Math Operations

```surql
math::pow(0.999, 24)       -- exponentiation
math::exp(-0.693 * x)      -- natural exponential
math::min(1.0, x + 0.1)    -- clamping
math::max(importance, 0.1)  -- floor
```

### Aggregation

```surql
-- Group and count
SELECT memory_type, count() AS cnt FROM memory GROUP BY memory_type;

-- Group all (single aggregate row)
SELECT count() FROM memory GROUP ALL;
```

## Engram Schema Quick Reference

| Table | Type | Key Fields |
|-------|------|-----------|
| `memory` | SCHEMAFULL | content, memory_type, scope, tags, embedding, importance, memory_strength (computed), status |
| `entity` | SCHEMAFULL | name, entity_type, description, embedding, mention_count |
| `relates_to` | RELATION entity->entity | relation_type, weight, confidence |
| `consolidation_queue` | SCHEMAFULL | memory_id, reason, priority, status |
| `retrieval_log` | SCHEMAFULL | query, strategy, results_count, memory_ids, was_useful |
| `evolution_state` | SCHEMAFULL | key (unique), value (flexible object) |

## Anti-Patterns

- Do NOT use `ON DUPLICATE KEY UPDATE` — use `UPSERT ... WHERE`
- Do NOT use `AUTO_INCREMENT` — SurrealDB generates record IDs automatically
- Do NOT use `JOIN` — use graph traversal (`->relates_to->`) or subqueries
- Do NOT use `LIMIT offset, count` — use `LIMIT count START offset`
- Do NOT use `IF EXISTS` for drops — use `REMOVE TABLE IF EXISTS`
- Do NOT assume `NULL` — SurrealDB uses `NONE` for absent values
