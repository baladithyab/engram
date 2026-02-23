# Graphiti Architecture and SurrealDB Mapping

> **Project:** [getzep/graphiti](https://github.com/getzep/graphiti) — open-source temporal knowledge graph framework
> **By:** Zep AI — also powers Zep Cloud's knowledge graph memory
> **Language:** Python (graphiti_core library + FastAPI MCP server)
> **Default Backend:** FalkorDB (also supports Neo4j, Kuzu, Amazon Neptune)
> **Related:** [[SurrealDB Agentic Memory Index]], [[LightRAG Architecture and SurrealDB Mapping]], [[MemEvolve Architecture and SurrealDB Mapping]]

---

## 1. Overview — What Graphiti Solves

Most AI memory systems treat knowledge as static: they store facts without tracking *when* those facts became true or when they stopped being true. When an agent learns "Alice works at Acme Corp" and later learns "Alice joined Beta Inc," the old fact silently disappears or creates a contradiction. RAG systems compound this problem by treating documents as isolated chunks without understanding how entities and their relationships evolve over time.

Graphiti addresses this with a **temporal knowledge graph** that:

1. **Incremental construction** — ingests episodes (conversations, documents, JSON) one at a time without requiring full graph recomputation
2. **Temporal validity tracking** — every fact (edge) carries `valid_at` / `invalid_at` timestamps, enabling point-in-time queries ("Where did Alice work in January 2024?")
3. **LLM-driven extraction** — uses structured-output LLM calls to extract entities, relationships, and facts from unstructured text
4. **Entity deduplication** — matches extracted entities against existing graph nodes to prevent duplicate entries
5. **Edge invalidation** — when contradictory facts arrive, older edges are soft-invalidated (marked with `invalid_at`) rather than deleted, preserving history
6. **Hybrid retrieval** — combines semantic similarity (vector cosine), BM25 full-text search, and graph traversal (BFS) with configurable reranking strategies
7. **Community detection** — uses the Leiden algorithm to cluster strongly connected entities, enabling high-level synthesized summaries

The key architectural distinction from systems like [[LightRAG Architecture and SurrealDB Mapping|LightRAG]] is that Graphiti is **episode-centric and temporal**. Where LightRAG processes documents to build a static knowledge graph, Graphiti processes a stream of time-stamped episodes and maintains a living graph where facts have lifespans.

---

## 2. Architecture Deep Dive

### 2.1 High-Level Data Flow

```
INGESTION PHASE                              RETRIEVAL PHASE
─────────────────                            ─────────────────
Episode arrives                              User Query
(text / message / JSON)                          │
    │                                            ▼
    ▼                                      Embed query (vector)
Retrieve recent episodes                         │
(temporal context window)                   ┌────┴────┐
    │                                       │         │
    ▼                                       ▼         ▼
Build LLM context:                     Similarity   BM25
  - episode_content                    Search       Search
  - candidate nodes                    (vectors)    (fulltext)
  - previous_episodes                       │         │
  - edge_type_signatures                    └────┬────┘
  - reference_time                               │
    │                                            ▼
    ▼                                       BFS Graph
LLM: Extract entities + edges              Traversal
(structured output)                        (optional)
    │                                            │
    ├──▶ Deduplicate entities                    ▼
    │    (match against existing)           Reranking:
    │                                       - RRF (Reciprocal Rank Fusion)
    ├──▶ Invalidate contradicted edges      - MMR (Maximal Marginal Relevance)
    │    (set invalid_at on old facts)      - Cross-Encoder
    │                                       - Node Distance
    ├──▶ Save EntityNodes (MERGE by uuid)        │
    │                                            ▼
    ├──▶ Save EntityEdges (with temporal    SearchResults:
    │    metadata: valid_at/invalid_at)       - edges (facts)
    │                                         - nodes (entities)
    ├──▶ Save EpisodicNode (raw content)      - communities (summaries)
    │
    ├──▶ Create MENTIONS edges
    │    (episode → entities it references)
    │
    └──▶ Create OCCURRED_AFTER edge
         (temporal ordering between episodes)
```

### 2.2 Episode Ingestion Pipeline

Episodes are the atomic unit of data ingestion. Each episode represents a single piece of information arriving at a specific point in time.

**Episode types:**
- `text` — unstructured prose (articles, documents, notes)
- `message` — conversational data formatted as `{role/name}: {message}` pairs
- `json` — structured data (compact enough to fit within LLM context windows)

**Ingestion methods:**
- `add_episode()` — single episode with full edge invalidation support
- `add_episode_bulk()` — batch ingestion (faster but skips edge invalidation; recommended only for populating empty graphs)

**The ingestion pipeline for each episode:**

1. **Retrieve temporal context** — fetch the last N episodes where `valid_at <= reference_time`, ordered chronologically. This provides the LLM with conversational/temporal context.
2. **Build extraction context** — assemble a context dict containing: `episode_content`, `nodes` (candidate entities from the graph), `previous_episodes`, `reference_time`, `edge_types` (from edge type signature map), and `custom_extraction_instructions`.
3. **LLM extraction** — call `llm_client.generate_response(prompt_library.extract_edges.edge(context))` to extract entities and relationships. The LLM returns structured output parsed into `ExtractedEdge` / `ExtractedEdges` types.
4. **Entity deduplication** — compare extracted entities against existing graph entities using `filter_existing_duplicate_of_edges()`. Duplicates are tracked via `RELATES_TO` edges named `IS_DUPLICATE_OF` between entity nodes.
5. **Edge invalidation** — when new facts contradict existing ones, the older edge's `invalid_at` field is set (soft invalidation). The old fact remains queryable for historical point-in-time queries.
6. **Persistence** — save new/updated EntityNodes (MERGE by uuid), EntityEdges (with temporal fields), EpisodicNode (raw content), MENTIONS edges (linking episode to referenced entities), and OCCURRED_AFTER edges (temporal ordering).

### 2.3 Entity Extraction and Deduplication

The extraction pipeline relies on structured-output-capable LLMs (default: OpenAI). The system sends carefully constructed prompts that include:

- The episode content being processed
- Nearby candidate nodes already in the graph
- Previous episodes for temporal context
- Edge type signatures defining expected relationship patterns
- Custom extraction instructions (user-configurable)

**Deduplication strategy:**
- Extracted entities are compared against existing graph entities
- Duplicate relationships are modeled as `RELATES_TO` edges with `name: 'IS_DUPLICATE_OF'`
- For Neo4j: `MATCH (n:Entity {uuid: $src})-[r:RELATES_TO {name: 'IS_DUPLICATE_OF'}]->(m:Entity {uuid: $dst})`
- For Kuzu: uses intermediate `RelatesToNode_` nodes due to property limitations on edges
- Embedding similarity is involved in the matching process (via `create_entity_edge_embeddings`)

### 2.4 Temporal Model

Graphiti's temporal model uses four distinct timestamps across two conceptual layers:

**System-level (when the graph learned something):**
- `created_at` — when the node/edge was created in the graph
- `expired_at` — when the edge record was superseded in the system

**World-level (when the fact was true in reality):**
- `valid_at` — when the relationship became factually true (from the episode's `reference_time`)
- `invalid_at` — when the relationship ceased to be true (set when contradictory information arrives)

**Example scenario:**
```
Timeline: ─────────────────────────────────────────────────────────▶

Jan 2024: Episode ingested: "Alice works at Acme Corp"
  → EntityEdge created:
      fact: "Alice works at Acme Corp"
      valid_at: 2024-01-15T00:00:00Z
      invalid_at: null
      created_at: 2024-01-15T10:30:00Z

Mar 2024: Episode ingested: "Alice joined Beta Inc last month"
  → Old edge updated:
      invalid_at: 2024-02-01T00:00:00Z    ← soft-invalidated
  → New EntityEdge created:
      fact: "Alice works at Beta Inc"
      valid_at: 2024-02-01T00:00:00Z
      invalid_at: null
      created_at: 2024-03-10T14:00:00Z

Point-in-time query: "Where did Alice work in January 2024?"
  → Returns "Acme Corp" (valid_at <= Jan, invalid_at > Jan OR null at that time)
```

### 2.5 Community Detection

Graphiti uses the **Leiden algorithm** to detect communities of strongly connected entity nodes.

- **Building:** `await graphiti.build_communities()` runs Leiden on the entity graph, creating `CommunityNode` objects. Each community's `summary` field aggregates summaries from all member entities.
- **Incremental updates:** When `update_communities=True` is passed to `add_episode()`, new nodes are placed into communities based on the most represented community among their neighbors (inspired by label propagation).
- **Rebuilding:** `build_communities()` removes all existing communities before generating new ones. Periodic rebuilding is recommended for optimal grouping.
- **Storage:** CommunityNodes are connected to their members via `HAS_MEMBER` edges.

### 2.6 Hybrid Search System

Graphiti's search system supports four entity scopes (edges, nodes, episodes, communities) with multiple retrieval methods and reranking strategies.

**Retrieval methods:**
| Method | Description | Query Pattern |
|--------|-------------|---------------|
| Cosine Similarity | Semantic vector search on embeddings | Match entities/edges, compute cosine against `name_embedding` / `fact_embedding`, filter by `min_score` |
| BM25 Full-Text | Lexical keyword matching | Fulltext index on `name + summary` (nodes) or `name + fact` (edges) |
| BFS Traversal | Graph walk from origin nodes | `MATCH path = (origin)-[:RELATES_TO\|MENTIONS*1..depth]->(target)` |

**Reranking strategies:**
| Reranker | How It Works | Best For |
|----------|-------------|----------|
| RRF (Reciprocal Rank Fusion) | Merges ranked lists: `score[uuid] += 1/(rank + k)` | General-purpose fusion of multiple retrievers |
| MMR (Maximal Marginal Relevance) | Balances relevance with diversity using embedding distance | Reducing redundancy in results |
| Cross-Encoder | Jointly encodes query + result for fine-grained scoring | Highest accuracy reranking |
| Node Distance | Scores by graph proximity to a focal node | Entity-specific queries ("tell me about Alice") |
| Episode Mentions | Scores by frequency of mentions across episodes | Recency/importance weighting |

**15 pre-built search recipes** combine these methods:
- `COMBINED_HYBRID_SEARCH_RRF` — all scopes with RRF reranking
- `EDGE_HYBRID_SEARCH_NODE_DISTANCE` — fact search with graph proximity
- `NODE_HYBRID_SEARCH_MMR` — entity search with diversity
- etc.

**Key constants:**
```python
RELEVANT_SCHEMA_LIMIT = 10
DEFAULT_MIN_SCORE = 0.6
MAX_SEARCH_DEPTH = 3        # BFS max depth
DEFAULT_MMR_LAMBDA = 0.5    # relevance vs. diversity tradeoff
DEFAULT_SEARCH_LIMIT = 10
```

---

## 3. Complete Neo4j Data Model

### 3.1 Node Labels and Properties

#### EntityNode (label: `Entity`)

| Property | Type | Description |
|----------|------|-------------|
| `uuid` | string | Primary identifier (uuid4) |
| `name` | string | Canonical entity name |
| `entity_type` | string | Type classification |
| `summary` | string | LLM-generated summary of entity |
| `name_embedding` | list[float] | Vector embedding of name |
| `created_at` | datetime | System creation timestamp |
| `group_id` | string | Graph partition identifier |
| `labels` | list[string] | Additional classification labels |
| `attributes` | dict | Arbitrary additional properties |

**Save query pattern:**
```cypher
MERGE (n:Entity {uuid: $uuid})
SET n.uuid = $uuid, n.name = $name, n.name_embedding = $name_embedding,
    n.summary = $summary, n.created_at = $created_at
```

#### EpisodicNode (label: `Episodic`)

| Property | Type | Description |
|----------|------|-------------|
| `uuid` | string | Primary identifier (uuid4) |
| `name` | string | Episode identifier |
| `content` | string | Raw episode data |
| `source` | EpisodeType | `message` / `text` / `json` |
| `source_description` | string | Context about data source |
| `valid_at` | datetime | When episode occurred (reference_time) |
| `created_at` | datetime | System creation timestamp |
| `group_id` | string | Graph partition identifier |
| `labels` | list[string] | Additional labels |
| `entity_edges` | list[string] | Referenced entity edge UUIDs |

**Retrieval query:**
```cypher
MATCH (e:Episodic)
WHERE e.valid_at <= $reference_time
  AND e.group_id IN $group_ids
RETURN e.uuid, e.name, e.content, e.valid_at, e.created_at, e.source
ORDER BY e.valid_at DESC
LIMIT $num_episodes
```

**With saga filtering:**
```cypher
MATCH (s:Saga {name: $saga_name, group_id: $group_id})-[:HAS_EPISODE]->(e:Episodic)
WHERE e.valid_at <= $reference_time
RETURN e.uuid, e.name, e.content, e.valid_at
ORDER BY e.valid_at DESC
LIMIT $num_episodes
```

#### CommunityNode (label: `Community`)

| Property | Type | Description |
|----------|------|-------------|
| `uuid` | string | Primary identifier |
| `name` | string | Community name |
| `summary` | string | Aggregated member summaries |
| `name_embedding` | list[float] | Vector embedding |
| `created_at` | datetime | Creation timestamp |
| `group_id` | string | Graph partition |

### 3.2 Relationship Types and Properties

#### RELATES_TO (EntityEdge — entity-to-entity facts)

| Property | Type | Description |
|----------|------|-------------|
| `uuid` | string | Edge identifier |
| `name` | string | Relationship name (e.g., "WORKS_AT", "IS_DUPLICATE_OF") |
| `fact` | string | Textual description of the fact |
| `fact_embedding` | list[float] | Vector embedding of fact text |
| `episodes` | list[string] | Source episode UUIDs |
| `valid_at` | datetime | When fact became true in reality |
| `invalid_at` | datetime \| null | When fact stopped being true |
| `expired_at` | datetime \| null | When edge was superseded in system |
| `created_at` | datetime | System creation timestamp |
| `group_id` | string | Graph partition |
| `attributes` | dict | Arbitrary additional properties |

#### MENTIONS (EpisodicEdge — episode-to-entity provenance)

| Property | Type | Description |
|----------|------|-------------|
| `uuid` | string | Edge identifier |
| `group_id` | string | Graph partition |
| `created_at` | datetime | Creation timestamp |

Direction: `(Episodic)-[:MENTIONS]->(Entity)`

#### OCCURRED_AFTER (temporal ordering between episodes)

Direction: `(Episodic)-[:OCCURRED_AFTER]->(Episodic)`

#### HAS_MEMBER (community membership)

| Property | Type | Description |
|----------|------|-------------|
| `uuid` | string | Edge identifier |
| `group_id` | string | Graph partition |
| `created_at` | datetime | Creation timestamp |

Direction: `(Community)-[:HAS_MEMBER]->(Entity)`

#### HAS_EPISODE (saga-to-episode grouping)

Direction: `(Saga)-[:HAS_EPISODE]->(Episodic)`

### 3.3 Indexes

From startup logs and issue reports, Graphiti creates these indexes:

| Index Name | Target | Purpose |
|------------|--------|---------|
| `created_at_episodic_index` | Episodic.created_at | Temporal ordering of episodes |
| `invalid_at_edge_index` | RELATES_TO.invalid_at | Filtering active vs invalidated edges |
| `mention_uuid` | MENTIONS.uuid | Fast lookup of mention edges |
| `has_member_uuid` | HAS_MEMBER.uuid | Fast lookup of community membership |
| `community_uuid` | Community.uuid | Fast community lookup |

Additionally, vector indexes are created for `name_embedding` (on Entity/Community nodes) and `fact_embedding` (on RELATES_TO edges) to enable similarity search. The fulltext indexes support BM25 search on `name + summary` and `name + fact` fields.

---

## 4. Component-by-Component SurrealDB Mapping

### 4.1 Mapping Strategy Overview

| Graphiti (Neo4j) | SurrealDB Equivalent | Notes |
|------------------|---------------------|-------|
| Node labels (`Entity`, `Episodic`, `Community`) | Tables (`entity`, `episode`, `community`) | SurrealDB tables = Neo4j labels |
| `MERGE (n:Entity {uuid: $uuid})` | `UPSERT entity:$uuid SET ...` | Native UPSERT replaces MERGE |
| `RELATES_TO` relationship | `relates_to` edge table via `RELATE` | `TYPE RELATION IN entity OUT entity` |
| `MENTIONS` relationship | `mentions` edge table | `TYPE RELATION IN episode OUT entity` |
| `OCCURRED_AFTER` relationship | `occurred_after` edge table | `TYPE RELATION IN episode OUT episode` |
| `HAS_MEMBER` relationship | `has_member` edge table | `TYPE RELATION IN community OUT entity` |
| `HAS_EPISODE` relationship | `has_episode` edge table | `TYPE RELATION IN saga OUT episode` |
| Cypher `MATCH path = (n)-[:REL*1..3]->(m)` | SurrealQL `n.{1..3}->rel->m` | Recursive graph traversal |
| Cypher `(n)<-[:REL]-(m)` | SurrealQL `SELECT <-rel<-entity FROM n` | Reverse traversal |
| Neo4j vector index | `DEFINE INDEX ... HNSW DIMENSION N DIST COSINE` | Native HNSW support |
| Neo4j fulltext index | `DEFINE INDEX ... FULLTEXT ANALYZER ... BM25` | Native BM25 support |
| `DETACH DELETE` | `DELETE entity:$uuid` (cascades via relations) | SurrealDB handles relation cleanup |
| Node properties (flat) | Record fields (typed) | Richer type system in SurrealDB |
| `group_id` partitioning | Namespaces or field-based filtering | Multiple options available |

### 4.2 Key SurrealDB Advantages for Graphiti's Use Case

**Multi-model in one engine:** SurrealDB combines document store, graph database, and vector database in a single engine. Graphiti currently requires Neo4j (graph) + potentially separate vector storage. With SurrealDB, entities, edges, embeddings, and full-text indexes all live in one system.

**Native temporal types:** SurrealDB has first-class `datetime` types with timezone support, eliminating the ISO 8601 string parsing issues Graphiti encounters (e.g., the Kuzu timezone bug requiring `ensure_utc` workarounds).

**UPSERT as a primitive:** SurrealDB's `UPSERT` statement directly replaces Neo4j's `MERGE` pattern, with cleaner syntax and atomic behavior.

**Edge tables with rich metadata:** SurrealDB's `RELATE` statement creates edge records that are full-fledged records with their own table, fields, and indexes — matching Graphiti's need for metadata-rich edges (temporal fields, embeddings, fact text).

**Recursive traversal:** SurrealQL's `@.{1..N}->rel->target` syntax provides native recursive graph traversal, replacing Cypher's `*1..N` variable-length path patterns.

**Built-in hybrid search:** SurrealDB supports both HNSW vector indexes and BM25 full-text indexes natively, with built-in fusion functions (`search::linear`) that implement the RRF/linear combination Graphiti currently builds in Python.

### 4.3 Potential Challenges

**In-memory HNSW:** SurrealDB's HNSW index currently operates in-memory. For large knowledge graphs with millions of embeddings, this requires sufficient RAM. Persistence for HNSW is under development.

**No native community detection:** SurrealDB does not have a built-in Leiden/Louvain algorithm. Community detection would need to be implemented in application code (Python) using libraries like `leidenalg` + `igraph`, reading the graph structure from SurrealDB and writing community assignments back.

**Relationship property indexing:** While SurrealDB edge tables support fields and indexes, the index creation patterns differ from Neo4j. Relationship-level fulltext indexes (e.g., BM25 on `relates_to.fact`) are supported but require explicit `DEFINE INDEX` statements on the edge table.

---

## 5. Complete SurrealQL Schema

### 5.1 Node Tables

```sql
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- ENTITY NODE TABLE
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DEFINE TABLE entity SCHEMAFULL;

DEFINE FIELD name             ON entity TYPE string;
DEFINE FIELD entity_type      ON entity TYPE string      DEFAULT '';
DEFINE FIELD summary          ON entity TYPE string      DEFAULT '';
DEFINE FIELD name_embedding   ON entity TYPE option<array<float>>;
DEFINE FIELD created_at       ON entity TYPE datetime    DEFAULT time::now();
DEFINE FIELD group_id         ON entity TYPE string;
DEFINE FIELD labels           ON entity TYPE array<string> DEFAULT [];
DEFINE FIELD attributes       ON entity TYPE object      FLEXIBLE;

-- Indexes for entity lookup and search
DEFINE INDEX idx_entity_group    ON entity FIELDS group_id;
DEFINE INDEX idx_entity_name     ON entity FIELDS name;
DEFINE INDEX idx_entity_created  ON entity FIELDS created_at;

-- Vector index for semantic similarity search on entity names
-- Dimension depends on embedding model (1536 for OpenAI text-embedding-3-small,
-- 3072 for text-embedding-3-large)
DEFINE INDEX idx_entity_name_embedding ON entity
    FIELDS name_embedding HNSW DIMENSION 1536 DIST COSINE TYPE F32;

-- Full-text index for BM25 search on entity name + summary
DEFINE ANALYZER entity_analyzer
    TOKENIZERS class, camel
    FILTERS lowercase, ascii, snowball(english);

DEFINE INDEX idx_entity_fulltext ON entity
    FIELDS name FULLTEXT ANALYZER entity_analyzer BM25;

DEFINE INDEX idx_entity_summary_fulltext ON entity
    FIELDS summary FULLTEXT ANALYZER entity_analyzer BM25;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- EPISODE NODE TABLE
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DEFINE TABLE episode SCHEMAFULL;

DEFINE FIELD name               ON episode TYPE string;
DEFINE FIELD content             ON episode TYPE string;
DEFINE FIELD source              ON episode TYPE string
    ASSERT $value IN ['message', 'text', 'json'];
DEFINE FIELD source_description  ON episode TYPE string   DEFAULT '';
DEFINE FIELD valid_at            ON episode TYPE datetime;
DEFINE FIELD created_at          ON episode TYPE datetime  DEFAULT time::now();
DEFINE FIELD group_id            ON episode TYPE string;
DEFINE FIELD labels              ON episode TYPE array<string> DEFAULT [];
DEFINE FIELD entity_edges        ON episode TYPE array<string> DEFAULT [];

-- Indexes for episode retrieval
DEFINE INDEX idx_episode_group     ON episode FIELDS group_id;
DEFINE INDEX idx_episode_valid_at  ON episode FIELDS valid_at;
DEFINE INDEX idx_episode_created   ON episode FIELDS created_at;
DEFINE INDEX idx_episode_source    ON episode FIELDS source;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- COMMUNITY NODE TABLE
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DEFINE TABLE community SCHEMAFULL;

DEFINE FIELD name             ON community TYPE string;
DEFINE FIELD summary          ON community TYPE string    DEFAULT '';
DEFINE FIELD name_embedding   ON community TYPE option<array<float>>;
DEFINE FIELD created_at       ON community TYPE datetime  DEFAULT time::now();
DEFINE FIELD group_id         ON community TYPE string;

-- Vector index for community similarity search
DEFINE INDEX idx_community_name_embedding ON community
    FIELDS name_embedding HNSW DIMENSION 1536 DIST COSINE TYPE F32;

DEFINE INDEX idx_community_group ON community FIELDS group_id;

-- Full-text index for community search
DEFINE INDEX idx_community_fulltext ON community
    FIELDS summary FULLTEXT ANALYZER entity_analyzer BM25;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- SAGA TABLE (groups episodes into narrative arcs)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DEFINE TABLE saga SCHEMAFULL;

DEFINE FIELD name       ON saga TYPE string;
DEFINE FIELD group_id   ON saga TYPE string;
DEFINE FIELD created_at ON saga TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_saga_name_group ON saga FIELDS name, group_id UNIQUE;
```

### 5.2 Edge Tables (Graph Relations)

```sql
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- RELATES_TO — entity-to-entity fact edges (the core of the knowledge graph)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DEFINE TABLE relates_to TYPE RELATION IN entity OUT entity SCHEMAFULL;

DEFINE FIELD name            ON relates_to TYPE string;
DEFINE FIELD fact            ON relates_to TYPE string;
DEFINE FIELD fact_embedding  ON relates_to TYPE option<array<float>>;
DEFINE FIELD episodes        ON relates_to TYPE array<string>   DEFAULT [];
DEFINE FIELD valid_at        ON relates_to TYPE option<datetime>;
DEFINE FIELD invalid_at      ON relates_to TYPE option<datetime>;
DEFINE FIELD expired_at      ON relates_to TYPE option<datetime>;
DEFINE FIELD created_at      ON relates_to TYPE datetime        DEFAULT time::now();
DEFINE FIELD group_id        ON relates_to TYPE string;
DEFINE FIELD attributes      ON relates_to TYPE object          FLEXIBLE;

-- Temporal indexes for fact validity queries
DEFINE INDEX idx_relates_valid_at   ON relates_to FIELDS valid_at;
DEFINE INDEX idx_relates_invalid_at ON relates_to FIELDS invalid_at;
DEFINE INDEX idx_relates_expired_at ON relates_to FIELDS expired_at;
DEFINE INDEX idx_relates_group      ON relates_to FIELDS group_id;
DEFINE INDEX idx_relates_name       ON relates_to FIELDS name;

-- Vector index for semantic fact search
DEFINE INDEX idx_relates_fact_embedding ON relates_to
    FIELDS fact_embedding HNSW DIMENSION 1536 DIST COSINE TYPE F32;

-- Full-text index for BM25 fact search
DEFINE INDEX idx_relates_fact_fulltext ON relates_to
    FIELDS fact FULLTEXT ANALYZER entity_analyzer BM25;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- MENTIONS — episode-to-entity provenance edges
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DEFINE TABLE mentions TYPE RELATION IN episode OUT entity SCHEMAFULL;

DEFINE FIELD created_at ON mentions TYPE datetime DEFAULT time::now();
DEFINE FIELD group_id   ON mentions TYPE string;

DEFINE INDEX idx_mentions_group ON mentions FIELDS group_id;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- OCCURRED_AFTER — temporal ordering between episodes
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DEFINE TABLE occurred_after TYPE RELATION IN episode OUT episode SCHEMAFULL;

DEFINE FIELD created_at ON occurred_after TYPE datetime DEFAULT time::now();
DEFINE FIELD group_id   ON occurred_after TYPE string;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- HAS_MEMBER — community-to-entity membership
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DEFINE TABLE has_member TYPE RELATION IN community OUT entity SCHEMAFULL;

DEFINE FIELD created_at ON has_member TYPE datetime DEFAULT time::now();
DEFINE FIELD group_id   ON has_member TYPE string;

DEFINE INDEX idx_has_member_group ON has_member FIELDS group_id;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- HAS_EPISODE — saga-to-episode grouping
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DEFINE TABLE has_episode TYPE RELATION IN saga OUT episode SCHEMAFULL;

DEFINE FIELD created_at ON has_episode TYPE datetime DEFAULT time::now();
DEFINE FIELD group_id   ON has_episode TYPE string;
```

### 5.3 Utility Functions

```sql
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- HELPER FUNCTIONS
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Reciprocal Rank Fusion for merging ranked result lists
DEFINE FUNCTION fn::rrf($result_lists: array, $rank_const: int) {
    LET $scores = {};
    FOR $result_list IN $result_lists {
        FOR $i IN 0..array::len($result_list) {
            LET $uuid = $result_list[$i];
            LET $current = $scores[$uuid] ?? 0;
            LET $scores[$uuid] = $current + 1.0 / ($i + $rank_const);
        };
    };
    RETURN $scores;
};

-- Hybrid search combining vector + BM25 results
DEFINE FUNCTION fn::hybrid_search_entities($query_text: string, $query_vec: array<float>, $group_ids: array<string>, $limit: int) {
    -- Semantic search via HNSW
    LET $semantic = (
        SELECT id, name, summary,
               vector::similarity::cosine(name_embedding, $query_vec) AS score
        FROM entity
        WHERE name_embedding <|($limit * 2), 100|> $query_vec
          AND group_id IN $group_ids
        ORDER BY score DESC
    );

    -- Full-text search via BM25
    LET $fulltext = (
        SELECT id, name, summary, search::score(1) AS score
        FROM entity
        WHERE name @1@ $query_text
          AND group_id IN $group_ids
        ORDER BY score DESC
        LIMIT $limit * 2
    );

    RETURN {
        semantic: $semantic,
        fulltext: $fulltext
    };
};

-- Hybrid search on fact edges
DEFINE FUNCTION fn::hybrid_search_facts(
    $query_text: string,
    $query_vec: array<float>,
    $group_ids: array<string>,
    $limit: int
) {
    -- Semantic search on fact embeddings
    LET $semantic = (
        SELECT id, name, fact, valid_at, invalid_at, in AS source_node, out AS target_node,
               vector::similarity::cosine(fact_embedding, $query_vec) AS score
        FROM relates_to
        WHERE fact_embedding <|($limit * 2), 100|> $query_vec
          AND group_id IN $group_ids
          AND invalid_at IS NONE
        ORDER BY score DESC
    );

    -- Full-text search on fact text
    LET $fulltext = (
        SELECT id, name, fact, valid_at, invalid_at, in AS source_node, out AS target_node,
               search::score(1) AS score
        FROM relates_to
        WHERE fact @1@ $query_text
          AND group_id IN $group_ids
          AND invalid_at IS NONE
        ORDER BY score DESC
        LIMIT $limit * 2
    );

    RETURN {
        semantic: $semantic,
        fulltext: $fulltext
    };
};
```

---

## 6. Query Pattern Translations

### 6.1 Episode Retrieval (Temporal Context Window)

**Neo4j (Cypher):**
```cypher
MATCH (e:Episodic)
WHERE e.valid_at <= $reference_time
  AND e.group_id IN $group_ids
RETURN e.uuid, e.name, e.content, e.valid_at, e.created_at, e.source
ORDER BY e.valid_at DESC
LIMIT $num_episodes
```

**SurrealDB (SurrealQL):**
```sql
SELECT * FROM episode
WHERE valid_at <= $reference_time
  AND group_id IN $group_ids
ORDER BY valid_at DESC
LIMIT $num_episodes;
```

### 6.2 Episode Retrieval with Saga Filter

**Neo4j:**
```cypher
MATCH (s:Saga {name: $saga_name, group_id: $group_id})-[:HAS_EPISODE]->(e:Episodic)
WHERE e.valid_at <= $reference_time
RETURN e.uuid, e.name, e.content, e.valid_at
ORDER BY e.valid_at DESC
LIMIT $num_episodes
```

**SurrealDB:**
```sql
SELECT out.* FROM has_episode
WHERE in.name = $saga_name
  AND in.group_id = $group_id
  AND out.valid_at <= $reference_time
ORDER BY out.valid_at DESC
LIMIT $num_episodes;

-- Or with graph traversal syntax:
SELECT ->has_episode->episode.*
FROM saga
WHERE name = $saga_name AND group_id = $group_id
LIMIT $num_episodes;
```

### 6.3 Entity Save (MERGE → UPSERT)

**Neo4j:**
```cypher
MERGE (n:Entity {uuid: $uuid})
SET n.uuid = $uuid, n.name = $name,
    n.name_embedding = $name_embedding,
    n.summary = $summary, n.created_at = $created_at
```

**SurrealDB:**
```sql
UPSERT entity:$uuid SET
    name            = $name,
    entity_type     = $entity_type,
    summary         = $summary,
    name_embedding  = $name_embedding,
    created_at      = $created_at,
    group_id        = $group_id,
    labels          = $labels,
    attributes      = $attributes;
```

### 6.4 Entity Edge Save (Fact with Temporal Metadata)

**Neo4j:**
```cypher
MERGE (n:Entity {uuid: $source_uuid})-[r:RELATES_TO {uuid: $edge_uuid}]->(m:Entity {uuid: $target_uuid})
SET r.name = $name, r.fact = $fact, r.fact_embedding = $fact_embedding,
    r.valid_at = $valid_at, r.invalid_at = $invalid_at,
    r.created_at = $created_at, r.group_id = $group_id
```

**SurrealDB:**
```sql
RELATE entity:$source_uuid->relates_to:$edge_uuid->entity:$target_uuid
    SET name           = $name,
        fact           = $fact,
        fact_embedding = $fact_embedding,
        episodes       = $episodes,
        valid_at       = $valid_at,
        invalid_at     = $invalid_at,
        created_at     = $created_at,
        group_id       = $group_id,
        attributes     = $attributes;
```

### 6.5 Edge Invalidation (Soft-Delete)

**Neo4j:**
```cypher
MATCH ()-[r:RELATES_TO {uuid: $edge_uuid}]->()
SET r.invalid_at = $invalidation_time, r.expired_at = $now
```

**SurrealDB:**
```sql
UPDATE relates_to:$edge_uuid SET
    invalid_at = $invalidation_time,
    expired_at = time::now();
```

### 6.6 Entity Deletion with Cascade

**Neo4j:**
```cypher
MATCH (n:Entity {uuid: $uuid})
OPTIONAL MATCH (n)-[r]-()
WITH collect(r.uuid) AS edge_uuids, n
DETACH DELETE n
RETURN edge_uuids
```

**SurrealDB:**
```sql
-- Collect affected edge IDs first
LET $edge_uuids = (
    SELECT VALUE id FROM relates_to
    WHERE in = entity:$uuid OR out = entity:$uuid
);

-- Delete the entity (SurrealDB auto-cleans relation endpoints)
DELETE entity:$uuid;

-- If needed, explicitly delete orphaned edges
DELETE $edge_uuids;

RETURN $edge_uuids;
```

### 6.7 Duplicate Detection Query

**Neo4j:**
```cypher
MATCH (n:Entity {uuid: $src_uuid})-[r:RELATES_TO {name: 'IS_DUPLICATE_OF'}]->(m:Entity {uuid: $dst_uuid})
RETURN n, r, m
```

**SurrealDB:**
```sql
SELECT * FROM relates_to
WHERE in = entity:$src_uuid
  AND out = entity:$dst_uuid
  AND name = 'IS_DUPLICATE_OF';

-- Or via graph traversal:
SELECT ->relates_to[WHERE name = 'IS_DUPLICATE_OF']->entity
FROM entity:$src_uuid;
```

### 6.8 BFS Graph Traversal (Edge Search)

**Neo4j:**
```cypher
UNWIND $bfs_origin_node_uuids AS origin_uuid
MATCH path = (origin {uuid: origin_uuid})-[:RELATES_TO|MENTIONS*1..3]->(:Entity)
UNWIND relationships(path) AS rel
MATCH (n:Entity)-[e:RELATES_TO {uuid: rel.uuid}]-(m:Entity)
WHERE e.group_id IN $group_ids
RETURN DISTINCT e.uuid, e.fact, e.name, n.uuid, m.uuid
LIMIT $limit
```

**SurrealDB:**
```sql
-- Recursive traversal from origin nodes up to depth 3
LET $origins = SELECT VALUE id FROM entity WHERE id IN $bfs_origin_node_uuids;

-- Traverse outward through relates_to edges
SELECT @.{1..3}.{
    id,
    edges: ->relates_to[WHERE group_id IN $group_ids].*,
    neighbors: ->relates_to->entity
} FROM $origins
TIMEOUT 5s;

-- Alternative: direct edge collection approach
SELECT * FROM relates_to
WHERE group_id IN $group_ids
  AND (in IN $origins OR out IN $origins)
LIMIT $limit;
```

### 6.9 Vector Similarity Search (Entities)

**Neo4j (with vector plugin):**
```cypher
CALL db.index.vector.queryNodes('entity_name_embedding', $limit, $query_vector)
YIELD node AS n, score
WHERE n.group_id IN $group_ids AND score > $min_score
RETURN n.uuid, n.name, n.summary, score
ORDER BY score DESC
```

**SurrealDB:**
```sql
SELECT id, name, summary,
       vector::similarity::cosine(name_embedding, $query_vector) AS score
FROM entity
WHERE name_embedding <|$limit, 100|> $query_vector
  AND group_id IN $group_ids
ORDER BY score DESC;
```

### 6.10 Vector Similarity Search (Fact Edges)

**Neo4j:**
```cypher
CALL db.index.vector.queryRelationships('edge_fact_embedding', $limit, $query_vector)
YIELD relationship AS rel, score
MATCH (n:Entity)-[e:RELATES_TO {uuid: rel.uuid}]->(m:Entity)
WHERE e.group_id IN $group_ids AND score > $min_score
RETURN e.uuid, e.fact, e.name, e.valid_at, e.invalid_at, n.uuid, m.uuid, score
ORDER BY score DESC
```

**SurrealDB:**
```sql
SELECT id, name, fact, valid_at, invalid_at,
       in AS source_node, out AS target_node,
       vector::similarity::cosine(fact_embedding, $query_vector) AS score
FROM relates_to
WHERE fact_embedding <|$limit, 100|> $query_vector
  AND group_id IN $group_ids
  AND invalid_at IS NONE
ORDER BY score DESC;
```

### 6.11 BM25 Full-Text Search (Entities)

**Neo4j:**
```cypher
CALL db.index.fulltext.queryNodes('node_name_and_summary', $query_text)
YIELD node AS n, score
WHERE n.group_id IN $group_ids
RETURN n.uuid, n.name, n.summary, score
ORDER BY score DESC
LIMIT $limit
```

**SurrealDB:**
```sql
SELECT id, name, summary, search::score(1) AS score
FROM entity
WHERE name @1@ $query_text
  AND group_id IN $group_ids
ORDER BY score DESC
LIMIT $limit;
```

### 6.12 Hybrid Search with Built-in Fusion

SurrealDB provides native fusion functions that replace Graphiti's Python-side RRF:

```sql
-- Vector search results
LET $query_vec = $embedding;

LET $vs = SELECT id FROM relates_to
    WHERE fact_embedding <|20, 100|> $query_vec
      AND group_id IN $group_ids
      AND invalid_at IS NONE;

-- BM25 results
LET $ft = SELECT id, search::score(1) AS score
    FROM relates_to
    WHERE fact @1@ $query_text
      AND group_id IN $group_ids
      AND invalid_at IS NONE
    ORDER BY score DESC
    LIMIT 20;

-- Fuse with built-in linear combination (RRF-like)
search::linear([$vs, $ft], [2, 1], $limit, 'minmax');
```

### 6.13 Point-in-Time Temporal Query

**Neo4j (conceptual):**
```cypher
MATCH (n:Entity {name: 'Alice'})-[e:RELATES_TO]->(m:Entity)
WHERE e.valid_at <= $query_time
  AND (e.invalid_at IS NULL OR e.invalid_at > $query_time)
RETURN e.fact, m.name, e.valid_at
```

**SurrealDB:**
```sql
SELECT fact, out.name AS target, valid_at
FROM relates_to
WHERE in.name = 'Alice'
  AND valid_at <= $query_time
  AND (invalid_at IS NONE OR invalid_at > $query_time)
ORDER BY valid_at DESC;
```

### 6.14 Community Building and Membership

```sql
-- Create a community after running Leiden in application code
CREATE community:$community_id SET
    name         = $community_name,
    summary      = $aggregated_summary,
    name_embedding = $summary_embedding,
    group_id     = $group_id;

-- Link member entities
FOR $member_id IN $member_entity_ids {
    RELATE community:$community_id->has_member->entity:$member_id
        SET group_id = $group_id;
};

-- Query community members
SELECT ->has_member->entity.* FROM community:$community_id;

-- Find which community an entity belongs to
SELECT <-has_member<-community.* FROM entity:$entity_id;

-- Rebuild communities (delete all, then recreate)
DELETE community;
DELETE has_member;
```

### 6.15 Maintenance: Delete Nodes by Group

**Neo4j:**
```cypher
MATCH (n:Entity) WHERE n.group_id IN $group_ids DETACH DELETE n
```

**SurrealDB:**
```sql
-- Delete all entities in specified groups
DELETE entity WHERE group_id IN $group_ids;

-- Delete related edges (may need explicit cleanup)
DELETE relates_to WHERE group_id IN $group_ids;
DELETE mentions WHERE group_id IN $group_ids;
```

### 6.16 Node Distance Reranking

**Neo4j:**
```cypher
UNWIND $node_uuids AS node_uuid
MATCH (center:Entity {uuid: $center_uuid})-[:RELATES_TO]-(n:Entity {uuid: node_uuid})
RETURN 1 AS score, node_uuid AS uuid
```

**SurrealDB:**
```sql
-- Direct neighbors of center node (distance = 1)
SELECT out AS uuid, 1 AS score
FROM relates_to
WHERE in = entity:$center_uuid
  AND out IN $node_ids;

-- Bidirectional check
SELECT
    IF in = entity:$center_uuid { out } ELSE { in } AS uuid,
    1 AS score
FROM relates_to
WHERE (in = entity:$center_uuid OR out = entity:$center_uuid)
  AND (in IN $node_ids OR out IN $node_ids);
```

---

## 7. Architecture Comparison Summary

### 7.1 Feature Parity Matrix

| Feature | Graphiti + Neo4j | Graphiti + SurrealDB | Status |
|---------|-----------------|---------------------|--------|
| Entity nodes with embeddings | Neo4j node properties | SurrealDB record fields + HNSW index | Full parity |
| Temporal edges (valid_at/invalid_at) | Relationship properties | Edge table fields | Full parity |
| Episode provenance (MENTIONS) | Relationship type | Edge table (TYPE RELATION) | Full parity |
| Temporal ordering (OCCURRED_AFTER) | Relationship type | Edge table (TYPE RELATION) | Full parity |
| Community detection (Leiden) | External library + Neo4j GDS | External library + SurrealDB reads/writes | Full parity |
| Community storage (HAS_MEMBER) | Relationship type | Edge table (TYPE RELATION) | Full parity |
| Vector similarity search | Neo4j vector index | HNSW index (DIST COSINE) | Full parity |
| BM25 full-text search | Neo4j fulltext index | FULLTEXT ANALYZER + BM25 | Full parity |
| Hybrid search fusion | Python-side RRF | Native `search::linear` + Python | Improved |
| Variable-length path traversal | Cypher `*1..N` | SurrealQL `@.{1..N}->` | Full parity |
| MERGE/UPSERT | Cypher MERGE | SurrealQL UPSERT | Full parity |
| Entity deduplication | RELATES_TO {name: 'IS_DUPLICATE_OF'} | relates_to edge with name field | Full parity |
| Group-based partitioning | group_id property filtering | group_id field + optional namespaces | Improved |
| ACID transactions | Neo4j transactions | SurrealDB transactions | Full parity |
| Relationship-level vector index | Neo4j 5.x vector on relationships | HNSW on edge table fields | Full parity |

### 7.2 What SurrealDB Does Better

1. **Unified storage engine** — entities, edges, embeddings, full-text indexes, and document data all in one database. No separate vector store needed.
2. **Native UPSERT** — cleaner than Neo4j's MERGE semantics, with atomic insert-or-update behavior.
3. **Edge tables as first-class citizens** — SurrealDB edge tables are full records with their own schemas, indexes, and query capabilities. Neo4j relationships have more limited indexing.
4. **Built-in hybrid search fusion** — `search::linear()` provides native RRF/minmax/zscore fusion, reducing Python-side code.
5. **Richer type system** — `datetime`, `option<T>`, `array<float>`, `object FLEXIBLE` provide stronger typing than Neo4j properties.
6. **Record links + graph edges** — SurrealDB supports both lightweight record links and full graph edges, allowing optimization per relationship type.
7. **No separate driver per backend** — one SurrealDB driver replaces the need for Graphiti's `GraphDriver` abstraction over Neo4j/FalkorDB/Kuzu/Neptune.

### 7.3 What Requires Workarounds

1. **Community detection** — must be done in application code (Python with `leidenalg`), reading adjacency from SurrealDB and writing results back. No native GDS equivalent.
2. **HNSW persistence** — currently in-memory. For large graphs, plan for sufficient RAM or use MTREE index as a persistent alternative (with different performance characteristics).
3. **Cross-encoder reranking** — still needs to be done application-side (same as with Neo4j).
4. **Bulk import performance** — for initial large-scale graph population, SurrealDB's RELATE statement processes one edge at a time (though batching with arrays creates cartesian products, requiring careful use).

---

## 8. Implementation Roadmap

### Phase 1: Core Schema and CRUD

1. Deploy SurrealDB schema from Section 5
2. Implement entity UPSERT operations
3. Implement episode creation and temporal retrieval
4. Implement RELATE operations for all edge types
5. Test point-in-time temporal queries

### Phase 2: Search Infrastructure

1. Configure HNSW indexes for entity and fact embeddings
2. Configure BM25 fulltext indexes
3. Implement hybrid search using SurrealDB's native `search::linear` fusion
4. Implement BFS traversal using recursive SurrealQL
5. Port reranking strategies (RRF is native; MMR, cross-encoder, node-distance in Python)

### Phase 3: Advanced Features

1. Implement edge invalidation pipeline
2. Implement entity deduplication with IS_DUPLICATE_OF edges
3. Port community detection (Leiden in Python, read/write via SurrealDB)
4. Implement group-based partitioning and multi-tenant isolation
5. Add LIVE SELECT for real-time graph change streaming

### Phase 4: Production Hardening

1. Benchmark HNSW performance at scale (measure RAM requirements)
2. Evaluate MTREE as persistent fallback for vector search
3. Implement connection pooling and concurrency limits
4. Add monitoring for index health (HNSW corruption recovery)
5. Test transaction isolation under concurrent episode ingestion

---

## 9. References

- [getzep/graphiti GitHub](https://github.com/getzep/graphiti) — source code
- [Graphiti MCP Server README](https://github.com/getzep/graphiti/blob/main/mcp_server/README.md) — server configuration
- [Zep Graph Overview](https://help.getzep.com/graph-overview) — temporal knowledge graph concepts
- [Graphiti Core Concepts: Episodes](https://help.getzep.com/graphiti/core-concepts/adding-episodes) — episode ingestion
- [Graphiti Core Concepts: Communities](https://help.getzep.com/graphiti/core-concepts/communities) — Leiden community detection
- [Graphiti Searching](https://help.getzep.com/graphiti/working-with-data/searching) — hybrid search and rerankers
- [SurrealDB Graph Model](https://surrealdb.com/docs/surrealdb/models/graph) — RELATE and graph traversal
- [SurrealDB Vector Model](https://surrealdb.com/docs/surrealdb/models/vector) — HNSW and vector search
- [SurrealDB DEFINE INDEX](https://surrealdb.com/docs/surrealql/statements/define/indexes) — index types including HNSW and BM25
- [SurrealDB RELATE Statement](https://surrealdb.com/docs/surrealql/statements/relate) — edge creation and graph queries
- [SurrealDB Search Functions](https://surrealdb.com/docs/surrealql/functions/database/search) — hybrid search fusion
- [SurrealDB UPSERT Statement](https://surrealdb.com/docs/surrealql/statements/upsert) — insert-or-update semantics
