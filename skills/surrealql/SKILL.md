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

### VALUE vs DEFAULT vs COMPUTED

SurrealDB 3.0 has three ways to derive field values:

```surql
-- DEFAULT: applied when no value is provided on CREATE; accepts user-provided values
DEFINE FIELD IF NOT EXISTS created_at ON memory TYPE datetime DEFAULT time::now();

-- VALUE: ALWAYS overrides user-provided values on both CREATE and UPDATE
-- The result is stored on disk (evaluated at write time)
DEFINE FIELD IF NOT EXISTS updated_at ON memory TYPE datetime VALUE time::now();

-- COMPUTED: evaluated on every READ (query-time, not stored)
-- Replaces <future> which was removed in 3.0
DEFINE FIELD IF NOT EXISTS strength ON memory COMPUTED
  importance * math::pow(0.999, duration::hours(time::now() - last_accessed_at));
```

**Key difference:** `DEFAULT` only fills in missing values. `VALUE` overrides ALL
values on every write. `COMPUTED` recalculates on every read (not stored on disk).

**Our schema uses `VALUE` (not COMPUTED)** for `memory_strength` — this means the
decay score is calculated at write time and stored, not recalculated on reads.

### SCHEMAFULL vs SCHEMALESS

```surql
DEFINE TABLE IF NOT EXISTS memory SCHEMAFULL;   -- strict: only defined fields allowed
DEFINE TABLE IF NOT EXISTS scratch SCHEMALESS;   -- flexible: any fields allowed
```

Use `SCHEMAFULL` for core tables. Use `TYPE ... FLEXIBLE` for individual fields that need
to accept arbitrary data within a SCHEMAFULL table:

```surql
DEFINE FIELD IF NOT EXISTS metadata ON memory TYPE option<object> FLEXIBLE;
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

**SurrealDB 3.0 breaking change:** The keyword is `FULLTEXT ANALYZER`, not `SEARCH ANALYZER`.
The old `SEARCH ANALYZER` syntax was used in SurrealDB 2.x and will cause parse errors in 3.0.

```surql
-- Define analyzer
DEFINE ANALYZER IF NOT EXISTS memory_analyzer
  TOKENIZERS blank, class
  FILTERS ascii, lowercase, snowball(english);

-- Define search index (FULLTEXT, not SEARCH — SurrealDB 3.0+)
DEFINE INDEX IF NOT EXISTS memory_content_search ON memory
  FIELDS content FULLTEXT ANALYZER memory_analyzer BM25;

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

SurrealDB 3.0 provides `search::rrf()` and `search::linear()` for combining
FTS and vector scores. You can also combine scores manually for custom weighting:

```surql
-- Option 1: Manual weighted combination (more control)
SELECT *,
  search::score(1) AS bm25_score,
  vector::similarity::cosine(embedding, $embedding) AS vec_score
FROM memory
WHERE content @1@ $query AND status = 'active'
ORDER BY (search::score(1) * 0.3 + vector::similarity::cosine(embedding, $embedding) * 0.3 + memory_strength * 0.4) DESC
LIMIT $limit;

-- Option 2: search::rrf() — Reciprocal Rank Fusion (new in 3.0)
-- Signature: search::rrf($lists: array, $limit: int, $k: option<int>) -> array<object>
-- Takes arrays of pre-sorted result sets, NOT individual scores
-- LET $vs = SELECT id FROM memory WHERE embedding <|10,100|> $qvec;
-- LET $ft = SELECT id, search::score(1) AS score FROM memory WHERE content @1@ $query ORDER BY score DESC LIMIT 10;
-- RETURN search::rrf([$vs, $ft], 10, 60);
```

New search functions in 3.0:
- `search::rrf()` — Reciprocal Rank Fusion across multiple score sources
- `search::linear()` — Linear combination of scores
- `search::offsets()` — Token offset positions in matched text
- `search::highlight()` — Highlighted matching fragments
- `search::score(N)` — BM25 relevance score for index N

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
math::pow(0.999, 24)              -- exponentiation
math::pow(math::e, -0.693 * x)   -- natural exponential (math::exp does NOT exist)
math::min([1.0, x + 0.1])        -- clamping (takes array, not two scalars)
math::max([importance, 0.1])      -- floor (takes array, not two scalars)
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

## SurrealDB 3.0 Breaking Changes

These are the changes from 2.x → 3.0 that WILL cause errors if not addressed:

| Old (2.x) | New (3.0) | Impact |
|-----------|-----------|--------|
| `SEARCH ANALYZER` | `FULLTEXT ANALYZER` | FTS index definitions |
| `VALUE <future> { expr }` | `COMPUTED expr` | Query-time computed fields |
| Optional operator `?` | `.?` | Optional chaining syntax |
| `type::is::record()` | `type::is_record()` | `type::is::*` → underscore |
| Fuzzy operators `?~`, `*~` | `string::similarity::*` functions | Removed in 3.0 |
| Ranges `1..5` inclusive | `1..5` exclusive, `1..=5` inclusive | Upper bound now exclusive |

**Note:** `FLEXIBLE TYPE object` and `TYPE object FLEXIBLE` — both positions accepted in 3.0 docs.
The `~` operator (basic fuzzy match) still works but `?~` and `*~` are removed.
`string::is::*` functions were NOT renamed (only `type::is::*` was).

**2.0 changes (still apply, but NOT new in 3.0):** HTTP `surreal-` header prefix,
default bind `127.0.0.1`, `--unauthenticated` flag replacing `--auth`.

### New in 3.0

- `COMPUTED expr` replaces `VALUE <future> { expr }` for query-time calculated fields
- `FULLTEXT ANALYZER` replaces `SEARCH ANALYZER` for FTS indexes
- `@AND@` and `@OR@` operators inside full-text matches
- `search::rrf()`: Reciprocal Rank Fusion for combining FTS + vector scores
- `search::linear()`: linear weighted combination of search scores
- `search::offsets()`: token offset positions in matches
- `DEFINE TABLE ... TYPE NORMAL | RELATION | ANY`
- `DEFINE FIELD ... REFERENCE ON DELETE REJECT | CASCADE` (stabilized; experimental since v2.2.0)
- `DEFAULT ALWAYS`: re-applies default on UPDATE if value is NONE (since v2.2.0)
- `CONCURRENTLY` clause for non-blocking index builds
- `REBUILD INDEX` to rebuild indexes without dropping them

## Anti-Patterns

- Do NOT use `ON DUPLICATE KEY UPDATE` — use `UPSERT ... WHERE`
- Do NOT use `AUTO_INCREMENT` — SurrealDB generates record IDs automatically
- Do NOT use `JOIN` — use graph traversal (`->relates_to->`) or subqueries
- Do NOT use `LIMIT offset, count` — use `LIMIT count START offset`
- Do NOT use `IF EXISTS` for drops — use `REMOVE TABLE IF EXISTS`
- Do NOT assume `NULL` — SurrealDB uses `NONE` for absent values
- Do NOT use `SEARCH ANALYZER` — use `FULLTEXT ANALYZER` (changed in SurrealDB 3.0)
- Do NOT use `VALUE <future> { ... }` — use `COMPUTED expr` (futures removed in 3.0)
- Do NOT use `?` for optional chaining — use `.?` in 3.0
- Do NOT use `?~` or `*~` fuzzy operators — removed in 3.0; use `string::similarity::*` functions
- Do NOT use `type::is::record()` — renamed to `type::is_record()` in 3.0 (but `string::is::*` was NOT renamed)
- Do NOT use `math::exp()` — it does not exist; use `math::pow(math::e, x)` instead
- Do NOT use `math::min(a, b)` with two scalars — use `math::min([a, b])` (takes array)
- Do NOT use `RELATE ... UNIQUE` — UNIQUE is not a RELATE keyword; use `DEFINE INDEX ... UNIQUE` on the edge table
- Do NOT call `signin()` in embedded mode — surrealkv:// runs in-process with full access
- Do NOT write to undeclared fields on `SCHEMAFULL` tables — they will error at runtime
- Do NOT use `VALUE` and `DEFAULT` on the same field — VALUE always overrides, making DEFAULT pointless
- Event parameters are `$before`, `$after`, `$value`, `$event` — there is no `$input` parameter
