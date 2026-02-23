# LightRAG Architecture and SurrealDB Mapping

> **Paper:** "LightRAG: Simple and Fast Retrieval-Augmented Generation" (Guo et al., 2024)
> **Authors:** Zirui Guo, Lianghao Xia, Yanhua Yu, Tu Ao, Chao Huang — Data Intelligence Lab, University of Hong Kong
> **Published:** EMNLP 2025 Findings (arXiv: 2410.05779)
> **Repository:** [HKUDS/LightRAG](https://github.com/HKUDS/LightRAG)
> **Related:** [[SurrealDB Agentic Memory Index]], [[Graphiti Architecture and SurrealDB Mapping]], [[MemEvolve Architecture and SurrealDB Mapping]]

---

## 1. Overview — What LightRAG Solves

Traditional RAG systems treat documents as flat, isolated chunks and rely solely on vector similarity for retrieval. This breaks down for queries requiring understanding of **how concepts connect** across documents. Microsoft's GraphRAG addressed this with community-based graph traversal, but at high computational cost (full graph reconstruction on updates, expensive community summarization).

LightRAG provides a lighter alternative by combining:

1. **Graph-based text indexing** — LLM-extracted entities and relationships form a knowledge graph
2. **Dual-level retrieval** — low-level (entity-specific) and high-level (thematic) retrieval paths
3. **Incremental updates** — new documents integrate without rebuilding the entire graph
4. **Deduplication** — map-reduce description merging prevents redundant nodes
5. **Hybrid retrieval** — vector search + graph structure for both breadth and depth

The result is 10-30x cheaper than GraphRAG for equivalent tasks, with comparable or better retrieval quality on multi-hop reasoning queries.

---

## 2. Architecture Deep Dive

### 2.1 Pipeline Overview

LightRAG operates in two phases:

```
INDEXING PHASE                          RETRIEVAL PHASE
─────────────────                       ─────────────────
Documents                               User Query
    │                                       │
    ▼                                       ▼
Chunking (segment into pieces)          Keyword Extraction (LLM)
    │                                       │
    ▼                                   ┌───┴───┐
Entity/Relationship Extraction (LLM)    │       │
    │                                   ▼       ▼
    ▼                              ll_keywords  hl_keywords
Deduplication (merge descriptions)      │       │
    │                                   ▼       ▼
    ▼                              Query        Query
Profiling (generate KV summaries)  entities_vdb relationships_vdb
    │                                   │       │
    ├──▶ Knowledge Graph (nodes/edges)  ▼       ▼
    ├──▶ Entity Vector DB (embeddings)  Get     Get
    ├──▶ Relationship Vector DB         Nodes   Edges
    └──▶ Chunk Vector DB                │       │
                                        ▼       ▼
                                   One-hop   Related
                                   Neighbors Entities
                                        │       │
                                        └───┬───┘
                                            ▼
                                    Token Truncation
                                            │
                                            ▼
                                    LLM Answer Generation
```

### 2.2 Graph-Based Text Indexing

The indexing pipeline is formally represented as:

```
D̂ = (V̂, Ê) = Dedupe ∘ Prof(V, E),    V, E = ∪_{Di∈D} Recog(Di)
```

Where:
- **Recog(Di)** — LLM extracts entities (nodes V) and relationships (edges E) from each document chunk Di
- **Prof(V, E)** — Profiling generates key-value summaries for each entity and relationship
- **Dedupe** — Merges duplicate entities/relationships via description summarization

#### Step 1: Chunking

Documents are segmented into manageable pieces. Each chunk gets a unique `chunk_id` and is stored in both a KV store (`text_chunks`) and a vector database (`chunks_vdb`) with its embedding.

#### Step 2: Entity and Relationship Extraction

An LLM is prompted to extract structured tuples from each chunk:

**Entity format:** `entity<|#|>entity_name<|#|>entity_type<|#|>entity_description`
**Relationship format:** `relation<|#|>source_entity<|#|>target_entity<|#|>relationship_keywords<|#|>relationship_description`

The delimiter `<|#|>` is `DEFAULT_TUPLE_DELIMITER`. Results are parsed, sanitized, and validated:
- Entity names are normalized (uppercase, trimmed)
- Self-loops are rejected
- Names exceeding 500 characters are truncated
- Entity types are standardized

#### Step 3: Deduplication (Map-Reduce Summarization)

When multiple chunks reference the same entity or relationship, their descriptions must be merged. The `_handle_entity_relation_summary` function implements this:

1. If only one description exists, no LLM call is needed
2. If total tokens fit within `summary_context_size` and the list is small (<=2), descriptions are joined directly
3. If limits are exceeded, descriptions are split into chunks (map phase), each summarized by an LLM (reduce phase)
4. This iterates until tokens are within limits or only two descriptions remain

This is fundamentally different from GraphRAG's community detection — it operates at the individual entity/relationship level rather than computing global community structure.

#### Step 4: Profiling

Each entity and relationship gets a rich profile stored as a key-value pair containing:
- Names and descriptions
- Source chunk references
- Excerpts from original text

These profiles become the values retrieved during the query phase.

### 2.3 Entity Node Data Structure

Each entity node in the knowledge graph contains:

| Field | Type | Description |
|-------|------|-------------|
| `entity_name` | string | Unique identifier (normalized, uppercase) |
| `entity_type` | string | Category (PERSON, ORGANIZATION, EVENT, etc.) |
| `description` | string | Merged description from all source chunks |
| `source_id` | string | Concatenated chunk IDs where entity was found |
| `file_path` | string | Original document path |
| `created_at` | datetime | Timestamp of creation |
| `keywords` | string | Optional associated keywords |

### 2.4 Relationship Edge Data Structure

Each relationship edge contains:

| Field | Type | Description |
|-------|------|-------------|
| `src_id` | string | Source entity name |
| `tgt_id` | string | Target entity name |
| `keywords` | string | Keywords summarizing the relationship |
| `description` | string | Merged description of the relationship |
| `source_id` | string | Concatenated chunk IDs |
| `file_path` | string | Original document path |
| `created_at` | datetime | Timestamp of creation |
| `weight` | float | Strength/importance of the relationship |

### 2.5 Incremental Updates

When new documents are inserted via `insert()`:

1. New chunks are upserted into `chunks_vdb` and `text_chunks`
2. For each extracted entity:
   - Check if the node exists in the graph via `has_node()`
   - If it exists, merge descriptions using map-reduce summarization
   - `upsert_node()` updates the graph; entity is upserted into `entities_vdb`
3. For each extracted relationship:
   - Check if source/target nodes exist; create with "UNKNOWN" type if missing
   - `upsert_edge()` updates the graph; relationship is upserted into `relationships_vdb`
4. Source ID lists are managed with configurable limits (`max_source_ids_per_entity`, `max_source_ids_per_relation`) using FIFO or KEEP strategies

This avoids the full graph reconstruction that GraphRAG requires, making it suitable for dynamic, continuously-updated knowledge bases.

---

## 3. Dual-Level Retrieval System

### 3.1 Query Flow

When a query arrives, LightRAG processes it through these stages:

#### Stage 1: Keyword Extraction

The LLM extracts two types of keywords from the query:
- **Low-level keywords (`ll_keywords`)** — specific entities, names, technical terms (e.g., "Mechazilla", "SpaceX")
- **High-level keywords (`hl_keywords`)** — broader themes, concepts (e.g., "sustainability", "space exploration innovation")

If keywords are pre-supplied in `QueryParam`, the LLM call is skipped.

#### Stage 2: Dual-Level Search

**Low-level retrieval (`_get_node_data`):**
1. Query `entities_vdb` with `ll_keywords` → top-k entities by cosine similarity
2. Batch-fetch node data and node degrees from the knowledge graph
3. Rank entities by similarity score, enriched with graph degree (structural importance)
4. Call `_find_most_related_edges_from_entities` → one-hop neighbor edges, sorted by degree and weight

**High-level retrieval (`_get_edge_data`):**
1. Query `relationships_vdb` with `hl_keywords` → top-k relationships by cosine similarity
2. Batch-fetch edge data from the knowledge graph
3. Call `_find_most_related_entities_from_relationships` → entities at the endpoints of these relationships

#### Stage 3: Result Merging (Hybrid Mode)

In hybrid mode, both retrieval paths run in parallel:
1. Local entities + global entities are merged via round-robin with deduplication
2. Local relations + global relations are merged with deduplication
3. Token truncation is applied per configurable budgets

#### Stage 4: Chunk Assembly

For each entity and relationship, related text chunks are retrieved via `source_id`:
- Two strategies: **WEIGHT** (weighted polling by chunk occurrence) or **VECTOR** (similarity to query)
- Chunks are deduplicated and occurrence-counted
- Optional reranking via a reranker model

#### Stage 5: Answer Generation

The assembled context (entities + relationships + chunks) is sent to the LLM with the original query for answer generation.

### 3.2 Retrieval Modes

| Mode | Low-level | High-level | Chunks | Description |
|------|-----------|------------|--------|-------------|
| `local` | Yes | No | From entities | Entity-focused, precise answers |
| `global` | No | Yes | From relations | Theme-focused, broad synthesis |
| `hybrid` | Yes | Yes | From both | Full dual-level (default) |
| `naive` | No | No | Direct vector | Plain vector RAG (no KG) |
| `mix` | Yes | Yes | All three | Hybrid + direct chunk search |

### 3.3 Token Budget System

LightRAG manages context length with a three-level token budget:

1. **`max_entity_tokens`** — cap on total entity description tokens
2. **`max_relation_tokens`** — cap on total relationship description tokens
3. **`max_total_tokens`** — hard limit for entire context (entities + relations + chunks + system prompt)

Remaining chunk budget = `max_total_tokens` - entity tokens - relation tokens - system prompt tokens.

---

## 4. Storage Architecture

### 4.1 Pluggable Backend Design

LightRAG uses four storage interfaces, each with multiple backend implementations:

```
StorageNameSpace (base)
├── BaseKVStorage          → JsonKV, PG, Redis, Mongo
├── BaseVectorStorage      → NanoVectorDB, PG, Milvus, Faiss, Qdrant, Mongo
├── BaseGraphStorage       → NetworkX, Neo4j, PG+AGE, Memgraph, Mongo
└── BaseDocStatusStorage   → JsonDocStatus, PG, Mongo, Redis
```

### 4.2 BaseGraphStorage Interface

The graph storage interface defines these operations:

| Method | Signature | Purpose |
|--------|-----------|---------|
| `has_node` | `(node_id: str) → bool` | Check if entity exists |
| `has_edge` | `(src: str, tgt: str) → bool` | Check if relationship exists |
| `node_degree` | `(node_id: str) → int` | Count of connected edges |
| `edge_degree` | `(src: str, tgt: str) → int` | Sum of endpoint degrees |
| `get_node` | `(node_id: str) → dict` | Retrieve entity properties |
| `get_edge` | `(src: str, tgt: str) → dict` | Retrieve relationship properties |
| `get_node_edges` | `(node_id: str) → list[tuple]` | All edges for a node |
| `upsert_node` | `(node_id: str, data: dict)` | Insert or update entity |
| `upsert_edge` | `(src: str, tgt: str, data: dict)` | Insert or update relationship |
| `delete_node` | `(node_id: str)` | Remove entity |
| `remove_edges` | `(edges: list[tuple])` | Remove multiple relationships |
| `get_all_labels` | `() → list[str]` | All entity names in graph |

Nodes are identified by `node_id` (the entity name). Edges are identified by `(source_node_id, target_node_id)` pairs.

### 4.3 BaseVectorStorage Interface

| Method | Signature | Purpose |
|--------|-----------|---------|
| `query` | `(vector: list[float], k: int, filters?) → results` | Cosine similarity search |
| `upsert` | `(data: dict)` | Insert or update embeddings |
| `delete` | `(ids: list[str])` | Remove vectors |
| `get_vectors_by_ids` | `(ids: list[str]) → vectors` | Retrieve specific vectors |

### 4.4 Supported Backends

| Category | Default | Production Options |
|----------|---------|-------------------|
| KV Store | JsonKVStorage (file) | PostgreSQL, Redis, MongoDB |
| Vector Store | NanoVectorDB (file) | PostgreSQL pgvector, Milvus, Faiss, Qdrant, MongoDB |
| Graph Store | NetworkX (memory) | Neo4j, PostgreSQL+AGE, Memgraph, MongoDB |
| Doc Status | JsonDocStatus (file) | PostgreSQL, MongoDB, Redis |

---

## 5. SurrealDB Mapping — Unified Storage for LightRAG

SurrealDB's multi-model architecture can serve as **all four storage layers simultaneously** — a significant advantage over LightRAG's current architecture where each layer requires a separate backend.

### 5.1 Feature Mapping

| LightRAG Component | Current Backends | SurrealDB Equivalent |
|---------------------|-----------------|---------------------|
| Entity nodes | NetworkX / Neo4j | Records in `entity` table |
| Relationships | NetworkX / Neo4j | `RELATE entity→rel_type→entity` with edge metadata |
| Entity embeddings | NanoVectorDB / Milvus | `DEFINE INDEX ... HNSW` on entity.embedding field |
| Relationship embeddings | NanoVectorDB / Milvus | `DEFINE INDEX ... HNSW` on relationship edge embedding field |
| Text chunks | JSON KV / PostgreSQL | Records in `chunk` table |
| Chunk embeddings | NanoVectorDB / Milvus | `DEFINE INDEX ... HNSW` on chunk.embedding field |
| Document status | JSON / PostgreSQL | Records in `doc_status` table |
| LLM response cache | JSON KV / Redis | Records in `llm_cache` table |
| Low-level retrieval | Vector search → graph traversal | Vector `<\|k\|>` + `→rel→entity` graph traversal |
| High-level retrieval | Vector search on relationships | Vector `<\|k\|>` on edge embeddings + BM25 on descriptions |
| Hybrid retrieval | Application-level merge | `search::rrf()` or `search::linear()` fusion |
| Deduplication | Application code + LLM | `UPSERT` + computed similarity |
| Incremental updates | `upsert_node` / `upsert_edge` | `UPSERT` + `DEFINE EVENT` for cascading updates |
| Workspace isolation | Varies by backend | Namespace/database scoping |

### 5.2 Key Advantages of SurrealDB for LightRAG

1. **Unified storage** — One database replaces 4 separate backends (KV + vector + graph + status)
2. **Native graph edges** — `RELATE` creates first-class edge records with metadata, matching LightRAG's edge data model exactly
3. **Built-in hybrid search** — `search::rrf()` and `search::linear()` fuse vector + BM25 results at the database level, eliminating application-level merging
4. **HNSW vector indexes** — Native vector search with cosine distance, no external vector DB needed
5. **BM25 full-text search** — Entity and relationship descriptions searchable with relevance scoring
6. **UPSERT semantics** — Direct match for LightRAG's incremental update pattern
7. **DEFINE EVENT** — Trigger re-indexing or description re-summarization on entity/relationship changes
8. **Record links** — Chunks can directly reference entities via record IDs, enabling O(1) lookups
9. **Graph traversal in queries** — `→edge→entity` syntax for one-hop neighbor retrieval, native to SurrealQL

---

## 6. Complete SurrealQL Schema

### 6.1 Analyzers and Core Tables

```surql
-- ============================================================
-- LightRAG-style Knowledge Graph Schema for SurrealDB
-- ============================================================

-- Namespace and database
DEFINE NAMESPACE IF NOT EXISTS lightrag;
USE NS lightrag;
DEFINE DATABASE IF NOT EXISTS knowledge;
USE DB knowledge;

-- ============================================================
-- TEXT ANALYZERS
-- ============================================================

-- General-purpose analyzer for entity/relationship descriptions
DEFINE ANALYZER entity_analyzer
    TOKENIZERS class, camel
    FILTERS lowercase, ascii, snowball(english);

-- Keyword analyzer for relationship keywords and entity types
DEFINE ANALYZER keyword_analyzer
    TOKENIZERS class, blank
    FILTERS lowercase, ascii;

-- ============================================================
-- DOCUMENT AND CHUNK TABLES
-- ============================================================

-- Source documents
DEFINE TABLE document SCHEMAFULL;
DEFINE FIELD name           ON document TYPE string;
DEFINE FIELD file_path      ON document TYPE string;
DEFINE FIELD content_hash   ON document TYPE string;
DEFINE FIELD status         ON document TYPE string
    ASSERT $value IN ["pending", "chunking", "extracting", "indexing", "completed", "failed"];
DEFINE FIELD chunk_count    ON document TYPE int DEFAULT 0;
DEFINE FIELD created_at     ON document TYPE datetime DEFAULT time::now();
DEFINE FIELD updated_at     ON document TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_doc_hash ON document FIELDS content_hash UNIQUE;
DEFINE INDEX idx_doc_status ON document FIELDS status;

-- Text chunks
DEFINE TABLE chunk SCHEMAFULL;
DEFINE FIELD content         ON chunk TYPE string;
DEFINE FIELD document        ON chunk TYPE record<document>;
DEFINE FIELD chunk_index     ON chunk TYPE int;
DEFINE FIELD token_count     ON chunk TYPE int;
DEFINE FIELD embedding       ON chunk TYPE array<float>;
DEFINE FIELD created_at      ON chunk TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_chunk_embedding ON chunk
    FIELDS embedding HNSW DIMENSION 1536 DIST COSINE TYPE F32;

DEFINE INDEX idx_chunk_fulltext ON chunk
    FIELDS content SEARCH ANALYZER entity_analyzer BM25;

-- ============================================================
-- ENTITY TABLE (Knowledge Graph Nodes)
-- ============================================================

DEFINE TABLE entity SCHEMAFULL;
DEFINE FIELD name            ON entity TYPE string;
DEFINE FIELD entity_type     ON entity TYPE string;
DEFINE FIELD description     ON entity TYPE string;
DEFINE FIELD description_embedding ON entity TYPE array<float>;
DEFINE FIELD source_chunks   ON entity TYPE array<record<chunk>> DEFAULT [];
DEFINE FIELD source_documents ON entity TYPE array<record<document>> DEFAULT [];
DEFINE FIELD file_paths      ON entity TYPE array<string> DEFAULT [];
DEFINE FIELD keywords        ON entity TYPE option<string>;
DEFINE FIELD degree          ON entity TYPE int DEFAULT 0;
DEFINE FIELD description_count ON entity TYPE int DEFAULT 1;
DEFINE FIELD created_at      ON entity TYPE datetime DEFAULT time::now();
DEFINE FIELD updated_at      ON entity TYPE datetime DEFAULT time::now();

-- Vector index on entity description embeddings (low-level retrieval)
DEFINE INDEX idx_entity_embedding ON entity
    FIELDS description_embedding HNSW DIMENSION 1536 DIST COSINE TYPE F32;

-- Full-text index on entity descriptions (keyword matching)
DEFINE INDEX idx_entity_description ON entity
    FIELDS description SEARCH ANALYZER entity_analyzer BM25 HIGHLIGHTS;

-- Full-text index on entity names
DEFINE INDEX idx_entity_name_ft ON entity
    FIELDS name SEARCH ANALYZER keyword_analyzer BM25;

-- Unique index on normalized entity name
DEFINE INDEX idx_entity_name ON entity FIELDS name UNIQUE;

-- Index on entity type for filtering
DEFINE INDEX idx_entity_type ON entity FIELDS entity_type;

-- ============================================================
-- RELATIONSHIP EDGES (Knowledge Graph Edges)
-- ============================================================

-- Relationship edge table — TYPE RELATION ensures graph semantics
DEFINE TABLE relates_to TYPE RELATION IN entity OUT entity SCHEMAFULL ENFORCED;
DEFINE FIELD keywords        ON relates_to TYPE string;
DEFINE FIELD description     ON relates_to TYPE string;
DEFINE FIELD description_embedding ON relates_to TYPE array<float>;
DEFINE FIELD source_chunks   ON relates_to TYPE array<record<chunk>> DEFAULT [];
DEFINE FIELD source_documents ON relates_to TYPE array<record<document>> DEFAULT [];
DEFINE FIELD file_paths      ON relates_to TYPE array<string> DEFAULT [];
DEFINE FIELD weight          ON relates_to TYPE float DEFAULT 1.0;
DEFINE FIELD description_count ON relates_to TYPE int DEFAULT 1;
DEFINE FIELD created_at      ON relates_to TYPE datetime DEFAULT time::now();
DEFINE FIELD updated_at      ON relates_to TYPE datetime DEFAULT time::now();

-- Vector index on relationship description embeddings (high-level retrieval)
DEFINE INDEX idx_rel_embedding ON relates_to
    FIELDS description_embedding HNSW DIMENSION 1536 DIST COSINE TYPE F32;

-- Full-text index on relationship descriptions
DEFINE INDEX idx_rel_description ON relates_to
    FIELDS description SEARCH ANALYZER entity_analyzer BM25 HIGHLIGHTS;

-- Full-text index on relationship keywords
DEFINE INDEX idx_rel_keywords ON relates_to
    FIELDS keywords SEARCH ANALYZER keyword_analyzer BM25;

-- Unique constraint: one edge per entity pair
DEFINE INDEX idx_rel_unique ON relates_to FIELDS in, out UNIQUE;

-- ============================================================
-- LLM RESPONSE CACHE
-- ============================================================

DEFINE TABLE llm_cache SCHEMAFULL;
DEFINE FIELD cache_key       ON llm_cache TYPE string;
DEFINE FIELD cache_type      ON llm_cache TYPE string;
DEFINE FIELD response        ON llm_cache TYPE string;
DEFINE FIELD model           ON llm_cache TYPE string;
DEFINE FIELD token_count     ON llm_cache TYPE int;
DEFINE FIELD created_at      ON llm_cache TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_cache_key ON llm_cache FIELDS cache_key, cache_type UNIQUE;

-- ============================================================
-- EVENTS: Automated re-indexing on changes
-- ============================================================

-- When an entity is updated, refresh its updated_at timestamp
DEFINE EVENT entity_updated ON entity WHEN $event = "UPDATE" THEN {
    UPDATE $after.id SET updated_at = time::now();
};

-- When a relationship is created or updated, increment degree on connected entities
DEFINE EVENT rel_created ON relates_to WHEN $event = "CREATE" THEN {
    UPDATE $after.in SET degree += 1, updated_at = time::now();
    UPDATE $after.out SET degree += 1, updated_at = time::now();
};

DEFINE EVENT rel_deleted ON relates_to WHEN $event = "DELETE" THEN {
    UPDATE $before.in SET degree -= 1, updated_at = time::now();
    UPDATE $before.out SET degree -= 1, updated_at = time::now();
};
```

### 6.2 Core Operations

#### Entity UPSERT (Incremental Update)

```surql
-- Upsert an entity — merges into existing record if name matches
-- This maps directly to LightRAG's upsert_node()
UPSERT entity:{string::slug($entity_name)} SET
    name = $entity_name,
    entity_type = $entity_type,
    description = $description,
    description_embedding = $embedding,
    source_chunks += [chunk:$chunk_id],
    source_documents += [document:$doc_id],
    file_paths += [$file_path],
    description_count += 1,
    updated_at = time::now();
```

#### Relationship UPSERT

```surql
-- Create or update a relationship edge
-- This maps to LightRAG's upsert_edge()
RELATE entity:{string::slug($src_name)}
    ->relates_to->
    entity:{string::slug($tgt_name)}
SET
    keywords = $keywords,
    description = $description,
    description_embedding = $embedding,
    source_chunks += [chunk:$chunk_id],
    source_documents += [document:$doc_id],
    file_paths += [$file_path],
    weight = $weight,
    description_count += 1,
    updated_at = time::now();
```

#### Low-Level Retrieval (Entity-Specific)

```surql
-- Step 1: Find entities by vector similarity to low-level keywords
LET $query_vec = $ll_keyword_embedding;

LET $matched_entities = SELECT
    id,
    name,
    entity_type,
    description,
    degree,
    vector::distance::knn() AS distance
FROM entity
WHERE description_embedding <|10,100|> $query_vec
ORDER BY distance;

-- Step 2: Get one-hop neighbor relationships for matched entities
-- (This is what _find_most_related_edges_from_entities does)
LET $related_edges = SELECT
    id,
    in.name AS src_name,
    out.name AS tgt_name,
    keywords,
    description,
    weight
FROM relates_to
WHERE in IN $matched_entities.id OR out IN $matched_entities.id
ORDER BY weight DESC, (
    SELECT degree FROM entity WHERE id = relates_to.in
).degree DESC
LIMIT 20;

-- Step 3: Get source chunks for context
SELECT content
FROM chunk
WHERE id IN array::flatten($matched_entities.source_chunks)
LIMIT 10;
```

#### High-Level Retrieval (Thematic)

```surql
-- Step 1: Find relationships by vector similarity to high-level keywords
LET $query_vec = $hl_keyword_embedding;

LET $matched_rels = SELECT
    id,
    in.name AS src_name,
    out.name AS tgt_name,
    keywords,
    description,
    weight,
    vector::distance::knn() AS distance
FROM relates_to
WHERE description_embedding <|10,100|> $query_vec
ORDER BY distance;

-- Step 2: Get entities at the endpoints of matched relationships
-- (This is _find_most_related_entities_from_relationships)
LET $related_entities = SELECT *
FROM entity
WHERE id IN array::flatten([
    $matched_rels.map(|$r| $r.in),
    $matched_rels.map(|$r| $r.out)
]);

-- Step 3: Get source chunks from relationships
SELECT content
FROM chunk
WHERE id IN array::flatten($matched_rels.source_chunks)
LIMIT 10;
```

#### Hybrid Retrieval with Fusion

```surql
-- Hybrid mode: combine low-level and high-level results using RRF
LET $query_vec = $query_embedding;

-- Vector search on entities (low-level path)
LET $entity_vec = SELECT id
FROM entity
WHERE description_embedding <|10,100|> $query_vec;

-- Full-text search on entity descriptions
LET $entity_ft = SELECT id, search::score(1) AS score
FROM entity
WHERE description @1@ $query_text
ORDER BY score DESC
LIMIT 10;

-- Fuse entity results with Reciprocal Rank Fusion
LET $fused_entities = search::rrf([$entity_vec, $entity_ft], 10, 60);

-- Vector search on relationships (high-level path)
LET $rel_vec = SELECT id
FROM relates_to
WHERE description_embedding <|10,100|> $query_vec;

-- Full-text search on relationship keywords + descriptions
LET $rel_ft = SELECT id, search::score(1) AS score
FROM relates_to
WHERE keywords @1@ $query_text OR description @1@ $query_text
ORDER BY score DESC
LIMIT 10;

-- Fuse relationship results
LET $fused_rels = search::rrf([$rel_vec, $rel_ft], 10, 60);
```

#### Graph Traversal for Context Expansion

```surql
-- Given an entity, traverse the knowledge graph for context
-- One-hop neighbors (what LightRAG does with get_node_edges)
SELECT
    ->relates_to->entity.name AS outgoing_entities,
    ->relates_to.keywords AS outgoing_keywords,
    ->relates_to.description AS outgoing_descriptions,
    <-relates_to<-entity.name AS incoming_entities,
    <-relates_to.keywords AS incoming_keywords,
    <-relates_to.description AS incoming_descriptions
FROM entity:{string::slug($entity_name)};

-- Two-hop traversal for richer context
SELECT
    ->relates_to->entity->relates_to->entity.name AS two_hop_entities
FROM entity:{string::slug($entity_name)};
```

### 6.3 Deduplication with SurrealDB

```surql
-- Find potential duplicate entities by embedding similarity
LET $entity_embedding = $new_entity_embedding;
LET $candidates = SELECT
    id, name, description, description_embedding,
    vector::distance::knn() AS distance
FROM entity
WHERE description_embedding <|5,100|> $entity_embedding
    AND distance < 0.15;  -- similarity threshold

-- If a match is found, merge descriptions
-- (In practice, the LLM-based map-reduce summarization happens in application code,
-- but the dedup detection + upsert happens in SurrealDB)
IF array::len($candidates) > 0 {
    LET $existing = $candidates[0];
    UPDATE $existing.id SET
        description = $merged_description,  -- LLM-merged in application
        description_embedding = $merged_embedding,
        source_chunks += $new_source_chunks,
        description_count += 1,
        updated_at = time::now();
} ELSE {
    CREATE entity SET
        name = $entity_name,
        entity_type = $entity_type,
        description = $description,
        description_embedding = $entity_embedding,
        source_chunks = $source_chunks,
        created_at = time::now();
};
```

---

## 7. Architecture Comparison: LightRAG vs GraphRAG

| Aspect | GraphRAG (Microsoft) | LightRAG (HKUDS) |
|--------|---------------------|-------------------|
| Graph construction | Entity extraction → community detection → community summaries | Entity extraction → deduplication → profiling |
| Update strategy | Full rebuild required | Incremental upsert |
| Retrieval | Community traversal (global) | Dual-level: entity (local) + theme (global) |
| Cost | ~$4 per document graph | ~$0.15 per document graph |
| Query types | Best for global/thematic | Both specific and thematic |
| Graph structure | Communities with hierarchy | Flat entity-relationship graph |
| Deduplication | Implicit in community merging | Explicit map-reduce on descriptions |

---

## 8. Implementation Considerations for SurrealDB

### 8.1 What Stays in Application Code

Even with SurrealDB handling storage, these operations remain in application code:

- **LLM calls** for entity/relationship extraction (prompt engineering + parsing)
- **LLM calls** for keyword extraction from queries
- **Map-reduce description summarization** (requires LLM for merging descriptions)
- **Token budget management** (truncation logic for context assembly)
- **Answer generation** (final LLM call with assembled context)
- **Embedding generation** (calling embedding models for descriptions)

### 8.2 What Moves to SurrealDB

These operations shift from application code to the database:

- **Graph storage and traversal** — `RELATE` + arrow syntax replaces NetworkX/Neo4j
- **Vector search** — HNSW indexes replace NanoVectorDB/Milvus
- **Full-text search** — BM25 replaces custom keyword matching
- **Hybrid fusion** — `search::rrf()` replaces application-level merge logic
- **Deduplication detection** — vector similarity queries find candidates
- **Incremental updates** — `UPSERT` handles insert-or-update atomically
- **Degree tracking** — `DEFINE EVENT` auto-updates node degrees on edge changes
- **Workspace isolation** — namespace/database scoping replaces per-backend isolation logic
- **Source chunk tracking** — record links (array of `record<chunk>`) replace concatenated ID strings

### 8.3 Embedding Dimension Configuration

The schema above uses `DIMENSION 1536` (OpenAI `text-embedding-3-small`). Adjust for your model:

| Model | Dimensions |
|-------|-----------|
| OpenAI text-embedding-3-small | 1536 |
| OpenAI text-embedding-3-large | 3072 |
| Cohere embed-v4 | 1024 |
| Amazon Titan Embed v2 | 1024 |
| Ollama nomic-embed-text | 768 |

### 8.4 Performance Considerations

- **HNSW parameters**: Default M=12, EFC=150 in SurrealDB. For large knowledge graphs (>100k entities), consider increasing EFC for better recall at the cost of index build time.
- **Graph traversal depth**: One-hop is native and fast. Multi-hop (2+) requires nested arrow syntax and may need query optimization.
- **BM25 + vector fusion**: `search::rrf()` runs both searches and fuses server-side — this is faster than making separate queries and merging in application code.
- **Batch operations**: SurrealDB supports multi-record `INSERT` and `UPSERT` which maps well to LightRAG's batch entity/relationship processing.
- **Memory cache**: HNSW uses a bounded LRU cache (default 256 MiB, configurable via `SURREAL_HNSW_CACHE_SIZE`).

---

## 9. Comparison with Other Frameworks on SurrealDB

| Feature | LightRAG on SurrealDB | [[Graphiti Architecture and SurrealDB Mapping\|Graphiti on SurrealDB]] | [[MemEvolve Architecture and SurrealDB Mapping\|MemEvolve on SurrealDB]] |
|---------|----------------------|----------------------|------------------------|
| Primary model | Knowledge graph + dual retrieval | Temporal knowledge graph | Evolving episodic memory |
| Graph type | Entity → relates_to → Entity | Entity → edge(time) → Entity | Episode → evolves_to → Episode |
| Vector search | Entity + relationship embeddings | Entity + edge embeddings | Memory embeddings |
| Full-text | Entity descriptions, relationship keywords | Edge descriptions | Memory content |
| Temporal | No (static timestamps only) | Yes (valid_from/valid_to on edges) | Yes (decay, reinforcement) |
| Incremental | Yes (upsert + merge descriptions) | Yes (temporal edge versioning) | Yes (memory consolidation) |
| Multi-hop | One-hop standard, multi-hop possible | Multi-hop with temporal filtering | Associative chains |

---

## 10. References

- Guo, Z., Xia, L., Yu, Y., Ao, T., & Huang, C. (2024). *LightRAG: Simple and Fast Retrieval-Augmented Generation.* arXiv:2410.05779. Published at EMNLP 2025 Findings.
- [HKUDS/LightRAG GitHub Repository](https://github.com/HKUDS/LightRAG)
- [LightRAG Project Page](https://lightrag.github.io/)
- [SurrealDB Vector Search Documentation](https://surrealdb.com/docs/surrealdb/models/vector)
- [SurrealDB Graph Database Documentation](https://surrealdb.com/docs/surrealdb/models/graph)
- [SurrealDB Search Functions (RRF, Linear)](https://surrealdb.com/docs/surrealql/functions/database/search)
- [SurrealDB RELATE Statement](https://surrealdb.com/docs/surrealql/statements/relate)
- [SurrealDB DEFINE EVENT](https://surrealdb.com/docs/surrealql/statements/define/event)
- [Neo4j Blog: Under the Covers with LightRAG](https://neo4j.com/blog/developer/under-the-covers-with-lightrag-extraction/)
