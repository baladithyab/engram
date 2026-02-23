# Knowledge Graph Design

> **Status:** Living document
> **Date:** 2026-02-23
> **See also:** [Overview](overview.md) | [Memory Model](memory-model.md)
> **Research:** [docs/research/graphiti-surrealdb-mapping.md](../research/graphiti-surrealdb-mapping.md) | [docs/research/lightrag-surrealdb-mapping.md](../research/lightrag-surrealdb-mapping.md) | [docs/research/surrealdb-feature-mapping.md](../research/surrealdb-feature-mapping.md)

---

## Overview

The knowledge graph extends the flat memory table with structured entity-relationship
modeling. While the `memory` table stores text-based memories, the knowledge graph
captures *entities* (files, functions, modules, libraries, people, concepts) and
*relationships* between them as first-class SurrealDB graph structures.

The design is inspired by two systems:
- **Graphiti** (Zep) -- temporal knowledge graph with entity deduplication, edge
  invalidation, and community detection
- **LightRAG** (HKU) -- dual-level retrieval combining entity-specific (low-level) and
  thematic (high-level) search paths

SurrealDB's native `RELATE` and `TYPE RELATION` tables make this possible without a
separate graph database.

---

## Entity Types

Entities represent the significant "things" Claude encounters while working in a
codebase. Each entity has a type, a canonical name, and metadata.

| Entity Type | Examples | Source |
|-------------|----------|--------|
| `file` | `src/index.ts`, `package.json` | File Read/Write hooks |
| `function` | `registerMemoryTools()`, `initSchema()` | Code analysis |
| `module` | `mcp/src/`, `hooks/scripts/` | Directory structure |
| `library` | `surrealdb`, `@modelcontextprotocol/sdk` | package.json, imports |
| `concept` | `memory consolidation`, `BM25 search` | Semantic extraction |
| `convention` | `SCHEMAFULL tables`, `kebab-case files` | Pattern recognition |
| `error_pattern` | `CORS origin mismatch`, `SurrealDB timeout` | Error debugging |
| `person` | Team members, code owners | Git blame, comments |
| `config` | Environment variables, feature flags | Config files |

### Entity Schema

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

-- Indexes
DEFINE INDEX IF NOT EXISTS entity_name ON entity FIELDS name;
DEFINE INDEX IF NOT EXISTS entity_type_idx ON entity FIELDS entity_type;

-- Vector search on entity names/descriptions (Phase 2)
-- DEFINE INDEX IF NOT EXISTS entity_embedding_hnsw ON entity
--     FIELDS embedding HNSW DIMENSION 384 DIST COSINE;
```

---

## Relationship Modeling with RELATE

SurrealDB's `RELATE` statement creates graph edges as first-class records. The
`relates_to` table is defined as `TYPE RELATION FROM entity TO entity`, which means:

- Every edge has an explicit `in` (source entity) and `out` (target entity)
- Edges carry their own fields (relationship type, weight, confidence, timestamps)
- Graph traversal uses `->relates_to->` arrow syntax
- Edges can be queried, updated, and deleted independently

### Core Relationship Table

```surql
DEFINE TABLE IF NOT EXISTS relates_to TYPE RELATION FROM entity TO entity SCHEMAFULL;

DEFINE FIELD IF NOT EXISTS relation_type ON relates_to TYPE string;
DEFINE FIELD IF NOT EXISTS weight ON relates_to TYPE float DEFAULT 0.5;
DEFINE FIELD IF NOT EXISTS confidence ON relates_to TYPE float DEFAULT 0.7;
DEFINE FIELD IF NOT EXISTS scope ON relates_to TYPE string;
DEFINE FIELD IF NOT EXISTS created_at ON relates_to TYPE datetime DEFAULT time::now();
```

### Common Relationship Types

| Relation Type | From | To | Example |
|--------------|------|-----|---------|
| `imports` | file | library | `index.ts` imports `surrealdb` |
| `contains` | module | file | `mcp/src/` contains `tools.ts` |
| `calls` | function | function | `main()` calls `initSchema()` |
| `depends_on` | library | library | `@mcp/sdk` depends on `zod` |
| `implements` | file | concept | `tools.ts` implements `store_memory` |
| `has_convention` | module | convention | `hooks/` has convention `set -uo pipefail` |
| `triggers` | error_pattern | error_pattern | `CORS mismatch` triggers `401 Unauthorized` |
| `fixed_by` | error_pattern | function | `SurrealDB timeout` fixed by `reconnect()` |
| `configured_by` | library | config | `surrealdb` configured by `SURREAL_MODE` env |

### Creating Relationships

```surql
-- File imports a library
RELATE entity:index_ts->relates_to->entity:surrealdb SET
    relation_type = 'imports',
    weight = 0.8,
    confidence = 0.9,
    scope = 'project';

-- Module contains a file
RELATE entity:mcp_src->relates_to->entity:tools_ts SET
    relation_type = 'contains',
    weight = 1.0,
    confidence = 1.0,
    scope = 'project';

-- Error pattern fixed by a function
RELATE entity:cors_error->relates_to->entity:add_cors_headers SET
    relation_type = 'fixed_by',
    weight = 0.7,
    confidence = 0.8,
    scope = 'project';
```

---

## Temporal Edges (Inspired by Graphiti)

Graphiti's key innovation is tracking *when* facts become true and when they stop being
true. We adopt this pattern for relationships that change over time.

### Temporal Fields

```surql
-- Extended relates_to table with temporal tracking
DEFINE FIELD IF NOT EXISTS valid_at ON relates_to TYPE option<datetime>;
DEFINE FIELD IF NOT EXISTS invalid_at ON relates_to TYPE option<datetime>;
```

| Field | Purpose |
|-------|---------|
| `valid_at` | When this relationship became true (world time) |
| `invalid_at` | When this relationship stopped being true (`NONE` = still valid) |
| `created_at` | When this edge was created in the graph (system time) |

### Example: Tracking Dependency Changes

```surql
-- January: project uses Express
RELATE entity:api_server->relates_to->entity:express SET
    relation_type = 'depends_on',
    valid_at = d'2026-01-15T00:00:00Z',
    confidence = 1.0,
    scope = 'project';

-- February: migrated to Hono
-- 1. Invalidate the old relationship
UPDATE relates_to SET invalid_at = d'2026-02-10T00:00:00Z'
    WHERE in = entity:api_server
    AND out = entity:express
    AND relation_type = 'depends_on'
    AND invalid_at IS NONE;

-- 2. Create the new relationship
RELATE entity:api_server->relates_to->entity:hono SET
    relation_type = 'depends_on',
    valid_at = d'2026-02-10T00:00:00Z',
    confidence = 1.0,
    scope = 'project';
```

### Point-in-Time Queries

Query the state of the knowledge graph at any historical point:

```surql
-- What dependencies did the API server have in January 2026?
SELECT out.name AS dependency FROM relates_to
    WHERE in = entity:api_server
    AND relation_type = 'depends_on'
    AND valid_at <= d'2026-01-31T00:00:00Z'
    AND (invalid_at IS NONE OR invalid_at > d'2026-01-31T00:00:00Z');
```

---

## Entity Deduplication

When entities are extracted from different sessions or contexts, duplicates are common.
The deduplication strategy prevents the graph from accumulating redundant nodes.

### Deduplication Pipeline

1. **Exact name match:** Before creating an entity, check if one with the same `name`
   and `entity_type` already exists.
2. **Fuzzy match (Phase 2):** Use embedding similarity to find entities with similar
   names (e.g., "surrealdb" vs "SurrealDB" vs "surrealdb npm package").
3. **Merge:** If a match is found, update the existing entity instead of creating a new
   one. Increment `mention_count`, update `description` if the new one is better, and
   merge metadata.

```surql
-- Deduplication: upsert by name + type
DEFINE FUNCTION fn::upsert_entity(
    $name: string,
    $entity_type: string,
    $description: string,
    $scope: string
) {
    LET $existing = (
        SELECT * FROM entity
        WHERE name = $name AND entity_type = $entity_type
        LIMIT 1
    );

    IF array::len($existing) > 0 {
        -- Update existing entity
        UPDATE $existing[0].id SET
            mention_count += 1,
            description = IF string::len($description) > string::len(description)
                { $description } ELSE { description },
            updated_at = time::now()
        ;
        RETURN $existing[0].id;
    } ELSE {
        -- Create new entity
        LET $new = (CREATE entity SET
            name = $name,
            entity_type = $entity_type,
            description = $description,
            scope = $scope
        );
        RETURN $new[0].id;
    };
};
```

### Embedding-Based Deduplication (Phase 2)

```surql
-- Find potentially duplicate entities by embedding similarity
SELECT id, name, entity_type,
    vector::similarity::cosine(embedding, $query_embedding) AS similarity
FROM entity
WHERE entity_type = $entity_type
    AND vector::similarity::cosine(embedding, $query_embedding) > 0.90
ORDER BY similarity DESC
LIMIT 5;
```

Entities with similarity > 0.90 are candidates for merging. The merge decision is
confirmed by the `memory-consolidator` agent to avoid false positives.

---

## Graph Querying Patterns

### 1. Direct Relationship Lookup

Find all entities related to a specific entity:

```surql
-- What does index.ts import?
SELECT out.name, out.entity_type, relation_type, weight
FROM relates_to
WHERE in = entity:index_ts
    AND relation_type = 'imports'
    AND invalid_at IS NONE;
```

### 2. Reverse Relationship Lookup

Find all entities that relate to a specific entity:

```surql
-- What files import the surrealdb library?
SELECT in.name, in.entity_type, relation_type
FROM relates_to
WHERE out = entity:surrealdb
    AND relation_type = 'imports'
    AND invalid_at IS NONE;
```

### 3. Graph Traversal (Arrow Syntax)

SurrealDB's arrow syntax enables multi-hop traversal:

```surql
-- One hop: what does index.ts directly depend on?
SELECT ->relates_to->entity.name AS dependencies
FROM entity:index_ts;

-- Two hops: what are the transitive dependencies?
SELECT ->relates_to->entity->relates_to->entity.name AS transitive_deps
FROM entity:index_ts;
```

### 4. Subgraph Extraction

Extract a neighborhood around an entity:

```surql
-- Get entity and all its 1-hop neighbors with relationship details
SELECT
    name,
    entity_type,
    ->relates_to->(entity WHERE invalid_at IS NONE) AS outgoing,
    <-relates_to<-(entity WHERE invalid_at IS NONE) AS incoming
FROM entity:index_ts;
```

### 5. Path Finding

Find how two entities are connected:

```surql
-- Are these two entities connected within 3 hops?
SELECT ->relates_to->entity->relates_to->entity->relates_to->entity
FROM entity:auth_module
WHERE ->relates_to->entity->relates_to->entity->relates_to->entity
    CONTAINS entity:jwt_library;
```

### 6. Entity Search by Type

```surql
-- Find all error patterns in the project
SELECT name, description, mention_count, confidence
FROM entity
WHERE entity_type = 'error_pattern'
    AND scope = 'project'
ORDER BY mention_count DESC;
```

### 7. Most Connected Entities

```surql
-- Find the most connected entities (highest degree)
SELECT
    name,
    entity_type,
    count(->relates_to) AS outgoing_count,
    count(<-relates_to) AS incoming_count,
    count(->relates_to) + count(<-relates_to) AS total_connections
FROM entity
ORDER BY total_connections DESC
LIMIT 10;
```

### 8. Hybrid Memory + Graph Query

Combine text search on memories with graph traversal on entities:

```surql
-- Find memories about a topic, then expand via the knowledge graph
LET $memories = (
    SELECT *, search::score(1) AS relevance
    FROM memory
    WHERE content @1@ 'authentication'
        AND status = 'active'
    ORDER BY relevance DESC
    LIMIT 5
);

-- For each memory's tags, find related entities
LET $entities = (
    SELECT * FROM entity
    WHERE name IN $memories[0].tags
);

-- Traverse one hop from those entities
SELECT ->relates_to->entity.* FROM $entities;
```

---

## Dual-Level Retrieval (Inspired by LightRAG)

LightRAG's key contribution is separating retrieval into two levels:

- **Low-level (entity-specific):** Find specific entities matching the query, then
  retrieve their direct relationships. Best for factual queries like "what does file X
  import?"
- **High-level (thematic):** Find relationship patterns and entity clusters that match
  the query's theme. Best for conceptual queries like "how does the authentication
  system work?"

### Low-Level Retrieval

```surql
-- Query: "surrealdb client"
-- 1. Find matching entities
LET $entities = (
    SELECT * FROM entity
    WHERE name @@ 'surrealdb client'
        OR description @@ 'surrealdb client'
    ORDER BY mention_count DESC
    LIMIT 5
);

-- 2. Get their direct relationships
SELECT
    in.name AS source,
    relation_type,
    out.name AS target,
    weight,
    confidence
FROM relates_to
WHERE in IN $entities.id OR out IN $entities.id
    AND invalid_at IS NONE
ORDER BY weight DESC;
```

### High-Level Retrieval

```surql
-- Query: "how does memory persistence work?"
-- 1. Find entities by type clusters
LET $relevant_types = ['concept', 'module', 'convention'];

LET $entities = (
    SELECT * FROM entity
    WHERE entity_type IN $relevant_types
        AND (description @@ 'memory persistence'
             OR name @@ 'memory persistence')
    ORDER BY mention_count DESC
    LIMIT 10
);

-- 2. Find the subgraph connecting them
SELECT
    in.name, in.entity_type,
    relation_type,
    out.name, out.entity_type
FROM relates_to
WHERE (in IN $entities.id OR out IN $entities.id)
    AND invalid_at IS NONE
ORDER BY weight DESC
LIMIT 20;
```

### Combined Retrieval with Reciprocal Rank Fusion (Phase 2)

```surql
-- Combine BM25 text search on memories with graph-based entity search
-- using search::rrf for unified ranking

LET $text_results = (
    SELECT id, content, search::score(1) AS score
    FROM memory
    WHERE content @1@ $query AND status = 'active'
    ORDER BY score DESC LIMIT 10
);

LET $graph_results = (
    SELECT id, name AS content, mention_count AS score
    FROM entity
    WHERE name @@ $query OR description @@ $query
    ORDER BY score DESC LIMIT 10
);

-- RRF fusion merges the two ranked lists
-- (actual search::rrf syntax applies to combined HNSW + BM25 indexes)
```

---

## Integration with Memory Table

Entities are linked to the memories that reference them via a `mentions` relation table:

```surql
DEFINE TABLE IF NOT EXISTS mentions TYPE RELATION FROM memory TO entity SCHEMAFULL;

DEFINE FIELD IF NOT EXISTS created_at ON mentions TYPE datetime DEFAULT time::now();

-- Example: link a memory to entities it mentions
RELATE memory:ulid123->mentions->entity:surrealdb;
RELATE memory:ulid123->mentions->entity:index_ts;
```

This allows bidirectional queries:
- "What entities does this memory reference?" -- `SELECT ->mentions->entity FROM memory:ulid123`
- "What memories mention this entity?" -- `SELECT <-mentions<-memory FROM entity:surrealdb`
