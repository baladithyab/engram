---
name: surrealql-reference
description: |
  Use this skill when you need to write SurrealQL queries or schema definitions.
  Triggers on: "SurrealQL", "SurrealDB query", "surql", "DEFINE", "SELECT FROM", "CREATE TABLE",
  "RELATE", "full-text search", "vector search", "HNSW", "graph traversal", "computed field",
  "memory strength decay", "knowledge graph", "edge queries", "record link", "UPSERT", "BM25",
  "search operator", "@1@", "SPLIT", "FETCH".

  Use this skill to understand exact SurrealQL syntax for the surrealdb-memory plugin.
---

# SurrealQL Reference — Comprehensive Syntax Guide

This skill covers **SurrealDB 3.0 specific syntax** that differs from standard SQL. Focus on the "gotchas" -- things a Postgres/MySQL developer would get wrong.

---

## CRITICAL DIFFERENCES FROM SQL

### 1. No JOINs Required
In SQL, you join tables. In SurrealQL, you traverse record links directly:

```surql
-- SQL style (won't work in SurrealQL)
SELECT a.name, b.title FROM author a JOIN article b ON a.id = b.author_id;

-- SurrealQL style (correct)
SELECT name, ->wrote->article.title AS articles FROM author;
-- or with FETCH
SELECT *, ->wrote->article.title FROM author FETCH wrote;
```

### 2. `@N@` Full-Text Search Operator
The `@1@` operator references a numbered full-text search index:

```surql
-- With index 1 defined: DEFINE INDEX ft_title ON book FIELDS title FULLTEXT ANALYZER en BM25;
SELECT search::score(1) AS score, search::highlight('<b>', '</b>', 1) AS title
FROM book
WHERE title @1@ 'rust web framework'
ORDER BY score DESC;
```

**Key gotcha:** The number `@N@` must match the index definition order. First index is `@1@`, second is `@2@`.

### 3. Graph Traversal with Arrow Operators
Multi-hop graph queries replace nested subqueries:

```surql
-- One hop: who did this person write?
SELECT ->wrote->article FROM person:tobie;

-- Reverse: who wrote this article?
SELECT <-wrote<-person FROM article:surreal;

-- Two hops: friends of friends
SELECT ->knows->person->knows->person FROM person:tobie;

-- Bidirectional: both directions
SELECT <->sister_city<->city FROM city:calgary;
```

### 4. COMPUTED vs VALUE vs DEFAULT
Three different ways to derive data:

```surql
-- DEFAULT: runs once at write time, stored
DEFINE FIELD created_at ON memory TYPE datetime DEFAULT time::now();

-- VALUE: runs at write time (alias for Future), stored
DEFINE FIELD slug ON article TYPE string VALUE string::slug(title);

-- COMPUTED: runs every read, NOT stored (v3.0 preferred)
DEFINE FIELD age ON person COMPUTED time::year(time::now()) - time::year(born);
```

**Gotcha:** You cannot mix `COMPUTED` with `VALUE`, `DEFAULT`, `READONLY`, `ASSERT`, `REFERENCE`, or `FLEXIBLE`.

### 5. Record Links vs RELATE vs REFERENCE
Three ways to model relationships:

```surql
-- Record link (simple pointer)
DEFINE FIELD author ON book TYPE record<person>;
SELECT author.name FROM book;  -- author's name resolved automatically

-- RELATE (explicit edge with properties)
RELATE user:alice->purchased->product:laptop SET quantity = 2, price = 999.99;

-- REFERENCE (bidirectional with cascade rules)
DEFINE FIELD author ON article TYPE record<user> REFERENCE ON DELETE CASCADE;
-- Now user can use: DEFINE FIELD articles ON user COMPUTED <~article;
```

### 6. SPLIT vs GROUP BY
They cannot be combined in 3.0:

```surql
-- SPLIT: flatten arrays into separate rows
SELECT * FROM person SPLIT emails;

-- GROUP BY: aggregate (cannot combine with SPLIT)
SELECT count(), country FROM person GROUP BY country;

-- Workaround: use subquery
SELECT * FROM (SELECT * FROM person SPLIT emails) WHERE active = true;
```

### 7. `ONLY` Keyword
Returns a single object instead of an array:

```surql
-- Returns [{ id: person:tobie, ... }]
SELECT * FROM person:tobie;

-- Returns { id: person:tobie, ... }
SELECT * FROM ONLY person:tobie;

-- Same with CREATE
CREATE ONLY person:tobie SET name = 'Tobie';
```

---

## STATEMENTS CHEAT SHEET

### SELECT Syntax (Full)

```surql
SELECT [VALUE] @fields [AS @alias] [OMIT @fields]
  FROM [ONLY] @targets
  [WITH [NOINDEX | INDEX @indexes]]
  [WHERE @conditions]
  [SPLIT [ON] @field, ...]
  [GROUP [ALL | [BY] @field, ...]]
  [ORDER [BY] RAND() | @field [COLLATE] [NUMERIC] [ASC | DESC], ...]
  [LIMIT [BY] @limit]
  [START [AT] @start]
  [FETCH @fields ...]
  [TIMEOUT @duration]
  [EXPLAIN [FULL]];
```

**Key features:**
- `VALUE` returns flat array instead of array of objects
- `OMIT` excludes specific fields
- `FETCH` eagerly resolves record links
- `SPLIT` flattens arrays into rows
- `ONLY` returns single object not array

### UPSERT Syntax

```surql
UPSERT @target SET @field = @value [, ...]
  [RETURN [NONE | BEFORE | AFTER | DIFF]];

-- Examples
UPSERT person:tobie SET name = 'Tobie', age = 35;
UPSERT memory:abc123 MERGE { importance = 0.8 };
UPSERT evolution_state SET key = 'decay_rates', value = { episodic: 1.0 }, updated_at = time::now()
  WHERE key = 'decay_rates';
```

**Gotcha:** UPSERT in SurrealDB doesn't have `WHERE` conditions in the standard syntax. For conditional upsert-with-where, build logic in a DEFINE FUNCTION or use subqueries.

### CREATE Syntax

```surql
CREATE [ONLY] @target [SET @field = @value | CONTENT @object] [RETURN ...]
  [TIMEOUT @duration];

-- Examples
CREATE person:tobie SET name = 'Tobie', age = 35;
CREATE person:rand() SET name = 'Auto ID';
CREATE person:ulid() SET name = 'ULID';
CREATE |person:1..100| SET count = <int>id.id();  -- batch create
CREATE person CONTENT { name: { first: 'Tobie' }, age: 35 };
```

**ID Types:**
- No suffix: generates auto ID
- `:rand()` or `:(auto)`
- `:uuid()`
- `:ulid()` (time-sortable)
- `:[array]` (composite key for time-series)

### RELATE Syntax

```surql
RELATE [ONLY] @from -> @edge_table -> @to
  [CONTENT @value | SET @field = @value ...]
  [RETURN ...]
  [TIMEOUT @duration];

-- Examples
RELATE user:alice->purchased->product:laptop SET quantity = 2;
RELATE person:one->wrote->[blog:1, book:1, comment:1];  -- multiple targets
LET $devs = (SELECT * FROM user WHERE tags CONTAINS 'developer');
RELATE company:acme->employs->$devs UNIQUE;
```

**Edge table must be TYPE RELATION:**
```surql
DEFINE TABLE purchased TYPE RELATION FROM user TO product SCHEMAFULL;
```

### DEFINE FIELD Syntax

```surql
DEFINE FIELD [IF NOT EXISTS | OVERWRITE] @field ON TABLE @table
  TYPE @type
  [DEFAULT @value | VALUE @expression | COMPUTED @expression]
  [ASSERT @validation]
  [READONLY]
  [FLEXIBLE]
  [REFERENCE [ON DELETE CASCADE|REJECT|IGNORE|UNSET|THEN @expr]]
  [PERMISSIONS ...]
  ;
```

**Type examples:**
```surql
DEFINE FIELD name ON memory TYPE string;
DEFINE FIELD tags ON memory TYPE array<string> DEFAULT [];
DEFINE FIELD importance ON memory TYPE float DEFAULT 0.5;
DEFINE FIELD memory_type ON memory TYPE string ASSERT $value IN ['episodic', 'semantic', 'procedural', 'working'];
DEFINE FIELD embedding ON memory TYPE option<array<float>>;
DEFINE FIELD metadata ON memory TYPE option<object> FLEXIBLE;
DEFINE FIELD author ON book TYPE record<person> REFERENCE ON DELETE CASCADE;

-- Computed field (not stored, evaluated on read)
DEFINE FIELD memory_strength ON memory COMPUTED
  importance * math::pow(
    IF memory_type = 'procedural' THEN 0.999
    ELSE IF memory_type = 'semantic' THEN 0.995
    ELSE IF memory_type = 'episodic' THEN 0.99
    ELSE 0.95
    END,
    duration::hours(time::now() - last_accessed_at)
  );

-- VALUE field (computed on write, stored)
DEFINE FIELD updated_at ON memory TYPE datetime VALUE time::now();
```

### DEFINE INDEX Syntax

```surql
DEFINE INDEX [IF NOT EXISTS] @name ON TABLE @table
  FIELDS @field [, ...]
  [UNIQUE]
  [FULLTEXT ANALYZER @analyzer BM25 [HIGHLIGHTS]]
  [HNSW DIMENSION @dim DIST @distance [@params]]
  [CONCURRENTLY]
  ;
```

**Examples:**
```surql
-- Standard index
DEFINE INDEX memory_scope ON memory FIELDS scope;

-- Unique index
DEFINE INDEX evolution_key ON evolution_state FIELDS key UNIQUE;

-- Full-text search (BM25)
DEFINE INDEX memory_content_search ON memory
  FIELDS content
  FULLTEXT ANALYZER memory_analyzer BM25;

-- HNSW vector index
DEFINE INDEX memory_embedding ON memory
  FIELDS embedding
  HNSW DIMENSION 384 DIST COSINE;

-- High-performance vector config
DEFINE INDEX idx_vec ON vectors
  FIELDS embedding
  HNSW DIMENSION 128 EFC 250 TYPE F32 DIST MANHATTAN
    M 6 M0 12 LM 0.5
    EXTEND_CANDIDATES KEEP_PRUNED_CONNECTIONS;
```

**Vector distance metrics:** `COSINE`, `EUCLIDEAN`, `MANHATTAN`

### DEFINE EVENT Syntax

```surql
DEFINE EVENT [IF NOT EXISTS] @name ON TABLE @table
  WHEN @condition
  THEN @action
  ;

-- Examples (from mcp/src/schema.ts)
DEFINE EVENT memory_lifecycle ON TABLE memory WHEN
  $before.status != $after.status
THEN {
  CREATE retrieval_log SET
    memory_id = $after.id,
    event_type = 'lifecycle_transition',
    old_status = $before.status,
    new_status = $after.status;
};

-- Auto-queue memories for consolidation when unaccessed
DEFINE EVENT memory_decay_check ON memory WHEN $after.status = 'active' THEN {
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

**Variables:** `$before`, `$after`, `$value`, `$event` (CREATE/UPDATE/DELETE)

### DEFINE TABLE Syntax

```surql
DEFINE TABLE [IF NOT EXISTS | OVERWRITE] @table
  [SCHEMAFULL | SCHEMALESS]
  [TYPE [NORMAL | RELATION FROM @from TO @to] | DROP]
  [PERMISSIONS ...]
  [CHANGEFEED @duration]
  ;

-- Examples
DEFINE TABLE memory SCHEMAFULL;

DEFINE TABLE relates_to TYPE RELATION FROM entity TO entity SCHEMAFULL;

DEFINE TABLE consolidation_queue SCHEMAFULL;

-- View table
DEFINE TABLE monthly_sales AS
  SELECT count() AS orders, time::format(created_at, '%Y-%m') AS month, math::sum(price) AS total
  FROM order
  GROUP BY month;
```

**Type options:**
- `SCHEMAFULL` (default for typed): fields must be defined
- `SCHEMALESS`: flexible schema
- `TYPE RELATION FROM X TO Y`: edge table (no records, just edges)
- `DROP`: accepts writes but discards data (useful for events)

### DEFINE ANALYZER Syntax

```surql
DEFINE ANALYZER [IF NOT EXISTS] @name
  [FUNCTION fn::@preprocessor]
  TOKENIZERS @tokenizer [, ...]
  FILTERS @filter [, ...];

-- Example (from mcp/src/schema.ts)
DEFINE ANALYZER memory_analyzer
  TOKENIZERS blank, class
  FILTERS ascii, lowercase, snowball(english);

-- Custom preprocessor
DEFINE FUNCTION fn::stripHtml($html: string) {
  RETURN string::replace($html, /<[^>]*>/, "");
};

DEFINE ANALYZER html_search
  FUNCTION fn::stripHtml
  TOKENIZERS blank, class
  FILTERS lowercase;
```

**Tokenizers:** `blank`, `camel`, `class`, `punct`
**Filters:** `ascii`, `lowercase`, `uppercase`, `snowball(lang)`, `edgengram(min,max)`, `ngram(min,max)`

---

## OPERATORS: NON-SQL BEHAVIOR

### Containment Operators

| Operator | Unicode | Example | Meaning |
|----------|---------|---------|---------|
| `CONTAINS` | `∋` | `tags CONTAINS 'important'` | Value contains another |
| `CONTAINSANY` | `⊃` | `tags CONTAINSANY ["x", "y"]` | Contains any of values |
| `CONTAINSALL` | `⊇` | `tags CONTAINSALL ["x", "y"]` | Contains all values |
| `INSIDE` / `IN` | `∈` | `"admin" IN tags` or `"admin" INSIDE tags` | Value inside another |
| `ANYINSIDE` | `⊂` | `["a", "b"] ANYINSIDE tags` | Any value inside |
| `ALLINSIDE` | `⊆` | `["a", "b"] ALLINSIDE tags` | All values inside |

```surql
-- Examples
SELECT * FROM person WHERE tags CONTAINSANY ["developer", "admin"];
SELECT * FROM memory WHERE tags CONTAINSALL ["high_priority", "semantic"];
SELECT * FROM user WHERE "viewer" IN roles;
```

### Fuzzy Matching

| Operator | Description |
|----------|-------------|
| `?=` | Any value in set equals (fuzzy) |
| `*=` | All values in set equal |
| `~` | Fuzzy match (all) |
| `?~` | Fuzzy match (any) |
| `*~` | Fuzzy match (all) |

```surql
UPSERT person:test SET sport +?= 'tennis' RETURN sport;
```

### Full-Text Search
```surql
-- Index reference number after @@
WHERE title @1@ 'search term'
WHERE content @2@ 'multi word query'
```

### Vector Operators (KNN)
```surql
-- KNN search with HNSW index (8 = K, COSINE = distance metric)
WHERE embedding <|8,COSINE|> $query_vector
```

---

## FUNCTIONS: SURREALDB-SPECIFIC

### Vector Functions

```surql
-- Similarity (returns 0-1, 1 = identical)
vector::similarity::cosine([1, 2], [2, 4]);  -- 1.0 (parallel)

-- Distance
vector::distance::euclidean([0, 0], [3, 4]);  -- 5
vector::distance::cosine([1, 0], [0, 1]);
vector::distance::manhattan([0, 0], [3, 4]);  -- 7

-- Element-wise
vector::add([1, 2], [3, 4]);  -- [4, 6]
vector::magnitude([3, 4]);      -- 5
vector::normalize([3, 4]);      -- [0.6, 0.8]
```

### Search Functions (Full-Text)

```surql
-- Score: relevance (higher = better match)
search::score(1);  -- for index @1@

-- Highlight: surround matches with markers
search::highlight('<b>', '</b>', 1);  -- for index @1@

-- Offsets: byte positions of matches
search::offsets(1);  -- for index @1@
```

### Array Functions (Key Methods)

```surql
-- Set operations
array::union([1, 2], [2, 3]);      -- [1, 2, 3]
array::intersect([1,2,3], [2,3,4]); -- [2, 3]
array::complement([1,2,3], [2]);     -- [1, 3]

-- Aggregation
array::fold([1,2,3,4,5], 0, |$acc, $val| $acc + $val);  -- 15

-- Boolean
array::all([true, true]);
array::any([false, true]);  -- true
```

### Duration Functions

```surql
duration::days(90h30m);   -- days component
duration::hours(90h30m);  -- hours component
duration::mins(1h30m);    -- minutes
duration::secs(1h30m30s); -- seconds
```

### Time Functions

```surql
time::now();
time::round(time::now(), 1h);    -- round to nearest hour
time::format(d"2026-02-23T10:30:00Z", '%Y-%m-%d'); -- "2026-02-23"
time::month(d"2026-02-23");       -- 2
time::year(d"2026-02-23");        -- 2026

-- Arithmetic
time::now() - born > 18y;  -- older than 18 years
```

---

## GOTCHAS & COMMON MISTAKES

### 1. Exponential Decay Formula
In `mcp/src/schema.ts`, memory strength uses powers, not constants:

```surql
-- CORRECT: exponential decay
DEFINE FIELD memory_strength ON memory VALUE
  importance * math::pow(
    decay_rate,
    duration::hours(time::now() - last_accessed_at)
  );

-- WRONG: linear decay (would lose all memories too fast)
importance - (hours_since_access * decay_factor);
```

### 2. FLEXIBLE Type
`FLEXIBLE` on an object field allows any keys, not stricter checking:

```surql
-- Allows any object, not just specific keys
DEFINE FIELD metadata ON memory TYPE option<object> FLEXIBLE;

-- Without FLEXIBLE, only defined fields allowed in SCHEMAFULL table
```

### 3. SPLIT Cannot Mix with GROUP BY
```surql
-- WRONG: will error in 3.0
SELECT * FROM person SPLIT emails GROUP BY country;

-- RIGHT: use subquery
SELECT * FROM (SELECT * FROM person SPLIT emails) WHERE active = true;
```

### 4. Search Index Numbers
```surql
-- Index @1@ refers to FIRST search index defined
DEFINE INDEX ft_title ON book FIELDS title FULLTEXT ANALYZER en BM25;
DEFINE INDEX ft_content ON book FIELDS content FULLTEXT ANALYZER en BM25;

-- In WHERE clause:
WHERE title @1@ 'term'          -- searches ft_title
WHERE content @2@ 'term'        -- searches ft_content
```

### 5. Record Links Auto-Resolve
```surql
-- author is record<user>, auto-resolves to full object
SELECT author.name FROM book;  -- works! no explicit FETCH needed

-- But FETCH speeds up multi-level fetches
SELECT * FROM post FETCH author, comments;
```

### 6. RELATE Creates Full Records
```surql
-- This creates a record in the 'purchased' table with fields
RELATE user:alice->purchased->product:laptop
  SET quantity = 2, price = 999.99, at = time::now();

-- Not just a pointer; it's a full edge record with data
SELECT * FROM purchased WHERE in = user:alice;
-- Returns: { in: user:alice, out: product:laptop, quantity: 2, price: 999.99, at: ... }
```

### 7. `IN` Range Syntax
```surql
-- Inclusive range
SELECT * FROM person WHERE age IN 18..=65;

-- NOT the same as SQL IN
SELECT * FROM person WHERE id IN (1, 2, 3);  -- this is also valid
```

### 8. NONE vs NULL
```surql
-- NONE: field doesn't exist
SELECT * FROM person WHERE email IS NONE;

-- NULL: field exists but is explicitly null
SELECT * FROM person WHERE email IS NULL;

-- Useful in computed fields
DEFINE FIELD full_name ON person COMPUTED
  (first_name ?? '') + ' ' + (last_name ?? '');  -- coalesce
```

---

## EXAMPLE: Memory Plugin Schema

From `/mcp/src/schema.ts`, here's how all pieces fit together:

```surql
-- 1. Analyzer for full-text search
DEFINE ANALYZER memory_analyzer TOKENIZERS blank, class
  FILTERS ascii, lowercase, snowball(english);

-- 2. Main memory table (SCHEMAFULL)
DEFINE TABLE memory SCHEMAFULL;

DEFINE FIELD content ON memory TYPE string;
DEFINE FIELD memory_type ON memory TYPE string
  ASSERT $value IN ['episodic', 'semantic', 'procedural', 'working'];
DEFINE FIELD importance ON memory TYPE float DEFAULT 0.5;
DEFINE FIELD status ON memory TYPE string DEFAULT 'active'
  ASSERT $value IN ['active', 'consolidated', 'archived', 'forgotten'];

-- 3. Computed field: exponential decay with type-specific half-lives
DEFINE FIELD memory_strength ON memory COMPUTED
  importance * math::pow(
    IF memory_type = 'procedural' THEN 0.999
    ELSE IF memory_type = 'semantic' THEN 0.995
    ELSE IF memory_type = 'episodic' THEN 0.99
    ELSE 0.95 END,
    duration::hours(time::now() - last_accessed_at)
  );

-- 4. Indexes: standard, full-text, and vector
DEFINE INDEX memory_scope ON memory FIELDS scope;
DEFINE INDEX memory_content_search ON memory
  FIELDS content FULLTEXT ANALYZER memory_analyzer BM25;
DEFINE INDEX memory_embedding ON memory
  FIELDS embedding HNSW DIMENSION 384 DIST COSINE;

-- 5. Entity table for knowledge graph
DEFINE TABLE entity SCHEMAFULL;
DEFINE INDEX entity_embedding ON entity
  FIELDS embedding HNSW DIMENSION 384 DIST COSINE;

-- 6. Relation table (edge)
DEFINE TABLE relates_to TYPE RELATION FROM entity TO entity SCHEMAFULL;

-- 7. Events for lifecycle automation
DEFINE EVENT memory_lifecycle ON memory WHEN
  $before.status != $after.status
THEN {
  CREATE retrieval_log SET
    memory_id = $after.id,
    event_type = 'lifecycle_transition',
    old_status = $before.status,
    new_status = $after.status;
};

-- 8. Seeding config via UPSERT
UPSERT evolution_state SET
  key = 'decay_half_lives',
  value = { working: 0.042, episodic: 1.0, semantic: 7.0, procedural: 30.0 },
  updated_at = time::now()
WHERE key = 'decay_half_lives';
```

---

## QUICK REFERENCE: Gotchas for SQL Developers

| SQL | SurrealQL | Gotcha |
|-----|-----------|--------|
| `JOIN ... ON` | `->arrow->notation` or `FETCH` | No JOINs; use graph traversal |
| `HAVING` | Subquery with `WHERE` | No HAVING; use subqueries |
| `LIMIT 10 OFFSET 20` | `LIMIT 10 START 20` | Syntax different |
| `CREATE OR UPDATE` | `UPSERT` | Native upsert syntax |
| `TRIGGER` | `DEFINE EVENT ... THEN` | Similar concept, different syntax |
| `AUTO_INCREMENT` | `:ulid()` or `:rand()` | Multiple ID generation strategies |
| `CHECK constraint` | `ASSERT` | Validation on field definition |
| `COMPUTED column` | `COMPUTED` (v3.0) | Calculated on read, not stored |
| `GENERATED column` | `VALUE` | Calculated on write, stored |
| `DEFAULT NOW()` | `DEFAULT time::now()` | Function call, not constant |
| `SEARCH ... MATCH` | `@N@ operator` with `search::score()` | Full-text via operators |
| `Array operations` | `SPLIT` | Flatten array to rows |
| `Subquery select` | `VALUE` in SELECT | Return scalar from subquery |

---

## Resources

- **SurrealQL Deep Dive:** `docs/research/surrealql-reference.md`
- **Advanced Features:** `docs/research/surrealdb-advanced-features.md`
- **Memory Model:** `docs/architecture/memory-model.md`
- **Schema:** `mcp/src/schema.ts`

