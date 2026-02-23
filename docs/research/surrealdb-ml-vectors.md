# SurrealML and AI/Vector Capabilities

> Research compiled 2026-02-23 | Covers SurrealDB 2.x and 3.0

SurrealDB positions itself as an **AI-native multi-model database** that unifies vector search, graph traversal, full-text search, and relational queries in a single transactional engine. Rather than requiring a separate vector database (Pinecone, Weaviate, Qdrant) plus a relational database plus a graph database, SurrealDB provides all three alongside native ML inference and embedding support.

This document covers three pillars of SurrealDB's AI story:
1. **SurrealML** -- in-database machine learning model storage and inference
2. **Vector Search** -- HNSW indexes, KNN operators, similarity/distance functions
3. **AI-Native Architecture** -- hybrid search, RAG patterns, Surrealism extensions, agent memory

---

## Table of Contents

- [[#SurrealML Overview]]
- [[#The .surml Model Format]]
- [[#Supported Frameworks]]
- [[#Training and Packaging a Model (Python)]]
- [[#Deploying Models to SurrealDB]]
- [[#In-Database Inference with ml:: Functions]]
- [[#Vector Search Overview]]
- [[#Storing Vector Embeddings]]
- [[#Defining Vector Indexes]]
- [[#The KNN Operator]]
- [[#Vector Functions Reference]]
- [[#Full-Text Search Integration]]
- [[#Hybrid Search -- Fusing Results]]
- [[#RAG Patterns in SurrealDB]]
- [[#In-Database Embedding Generation]]
- [[#Surrealism -- WASM Extensions for AI]]
- [[#Framework Integrations]]
- [[#SurrealDB 3.0 AI Agent Memory]]
- [[#Limitations and Considerations]]

---

## SurrealML Overview

SurrealML is a feature that allows you to **store trained machine learning models** in SurrealDB and **run inference** directly within SurrealQL queries. It does not aim to *train* models -- there are mature libraries for that. Instead, SurrealML bridges the gap between training (Python/Rust) and production inference (inside the database).

Key principles:
- Models are stored in a custom binary format called `.surml`
- The inference engine is written in **Rust** using the embedded **ONNX Runtime** (v1.16.0)
- The same Rust code runs whether you call inference from Python, Rust, or inside SurrealDB
- No language-dependent dependencies at inference time -- all execution happens via ONNX
- SurrealML is an optional compile-time feature (`surrealml`) in the SurrealDB binary

The `surrealml` Python package provides bindings to the Rust core for model packaging and local inference. The `surrealml-core` Rust crate handles all storage, loading, and execution.

---

## The .surml Model Format

A `.surml` file is a self-contained binary that packages:

1. **Header (metadata)** -- variable-length JSON-like structure containing:
   - Model name and version (e.g., `house-price-prediction`, `0.0.1`)
   - Description text
   - Input column names and their ordering
   - Output column names
   - Normaliser definitions (z-score, linear scaling, min-max)
   - Input dimensions (auto-detected during model tracing)
   - Origin marker (local, database, or undefined)

2. **ONNX protobuf weights** -- the remainder of the file after the header

### File structure (binary layout)

```
[ 4 bytes: header length (u32) ][ header bytes (JSON-ish) ][ ONNX protobuf weights ]
```

The loader reads the first 4 bytes to determine header size, parses the header for metadata, then loads the remaining bytes into the ONNX Runtime C++ library for inference.

### Why ONNX?

ONNX (Open Neural Network Exchange) is a framework-agnostic model representation. By converting all models to ONNX before packaging into `.surml`, SurrealML achieves:
- **Zero language dependencies** -- no Python, no framework-specific serialization
- **Cross-language execution** -- same model runs in Python, Rust, or SurrealDB
- **Framework interoperability** -- PyTorch, TensorFlow, scikit-learn models all become ONNX
- **Version safety** -- no Python version or framework version lock-in

---

## Supported Frameworks

| Framework | Support | Conversion Path |
|-----------|---------|-----------------|
| **scikit-learn** | Native | sklearn model -> ONNX -> `.surml` |
| **PyTorch** | Native | PyTorch model -> torch.onnx.export -> `.surml` |
| **TensorFlow** | Native | TF model -> tf2onnx -> `.surml` |
| **ONNX** | Direct | ONNX model -> `.surml` (no conversion needed) |

All three major frameworks are supported through the `surrealml` Python package, which handles the ONNX conversion automatically during the save step.

> **Note:** As of early 2025, there is community interest in importing large pre-trained models (LLaMA, DeepSeek, etc.) but SurrealML is currently designed for traditional ML models, not multi-billion-parameter LLMs. The ONNX Runtime handles inference for models of moderate size.

---

## Training and Packaging a Model (Python)

### Installation

```bash
# Full install (sklearn + PyTorch)
pip install "git+https://github.com/surrealdb/surrealml.git#subdirectory=clients/python"

# sklearn only
pip install "git+https://github.com/surrealdb/surrealml.git#subdirectory=clients/python[sklearn]"

# PyTorch only
pip install "git+https://github.com/surrealdb/surrealml.git#subdirectory=clients/python[torch]"
```

### Example: sklearn Linear Regression

```python
from sklearn.linear_model import LinearRegression
from surrealml import SurMlFile, Engine
import numpy as np

# Train a simple model
X_train = np.array([[500, 1], [1000, 2], [1500, 3], [2000, 4]])
y_train = np.array([150000, 250000, 350000, 450000])
model = LinearRegression()
model.fit(X_train, y_train)

# Package into .surml
file = SurMlFile(
    model=model,
    name="house-price-prediction",
    inputs=X_train,          # used to trace input dimensions
    engine=Engine.SKLEARN
)

# Add metadata
file.add_version("0.0.1")
file.add_description("Predicts house price from sqft and floors")

# Define named columns (maps dict keys to input order)
file.add_column("squarefoot")
file.add_column("num_floors")

# Add normalisers (applied automatically during buffered compute)
file.add_normaliser("squarefoot", "z_score", sqft_mean, sqft_std)
file.add_normaliser("num_floors", "z_score", floors_mean, floors_std)

# Define output
file.add_output("house_price", "z_score", y_mean, y_std)

# Save
file.save(path="./house-price.surml")
```

### Local inference (Python)

```python
# Load and run locally
loaded = SurMlFile.load(path="./house-price.surml", engine=Engine.SKLEARN)

# Raw compute (you handle normalisation)
result = loaded.raw_compute([500.0, 1.0])

# Buffered compute (normalisation applied from header)
result = loaded.buffered_compute({"squarefoot": 500.0, "num_floors": 1.0})
```

---

## Deploying Models to SurrealDB

### Upload via Python SDK

```python
from surrealml import SurMlFile

SurMlFile.upload(
    path="./house-price.surml",
    url="http://localhost:8000",
    chunk_size=36864,
    namespace="production",
    database="myapp",
    username="root",
    password="secret"
)
```

### Upload via CLI

```bash
surreal import --conn http://localhost:8000 \
    --user root --pass root \
    --ns production --db myapp \
    house-price.surml
```

### Upload via HTTP API

```bash
curl -X POST http://localhost:8000/ml/import \
    -H "surreal-ns: production" \
    -H "surreal-db: myapp" \
    -H "Authorization: Basic cm9vdDpyb290" \
    --data-binary @house-price.surml
```

### Export a model

```bash
# HTTP endpoint
curl http://localhost:8000/ml/export/house-price-prediction/0.0.1 \
    -H "surreal-ns: production" \
    -H "surreal-db: myapp" \
    -o exported-model.surml

# CLI
surreal export --conn http://localhost:8000 \
    --user root --pass root \
    --ns production --db myapp \
    house-price-prediction-0.0.1.surml
```

---

## In-Database Inference with ml:: Functions

Once a `.surml` model is imported, you call it from SurrealQL using the `ml::` function syntax:

```surql
-- Syntax: ml::<model-name><version>(input)
```

### Raw compute (array or number input)

```surql
-- Pass raw numeric inputs (you handle normalisation)
RETURN ml::house-price-prediction<0.0.1>([500.0, 1.0]);
-- Returns: 150000
```

### Buffered compute (object input)

```surql
-- Pass named fields (normalisation applied from .surml header)
RETURN ml::house-price-prediction<0.0.1>({
    squarefoot: 500.0,
    num_floors: 1.0
});
-- Returns: 250000
```

### Inference over entire tables

```surql
-- Create sample data
CREATE house_listing SET squarefoot_col = 500.0, num_floors_col = 1.0;
CREATE house_listing SET squarefoot_col = 1000.0, num_floors_col = 2.0;
CREATE house_listing SET squarefoot_col = 1500.0, num_floors_col = 3.0;

-- Infer predicted prices for all rows
SELECT *,
    ml::house-price-prediction<0.0.1>({
        squarefoot: squarefoot_col,
        num_floors: num_floors_col
    }) AS price_prediction
FROM house_listing;
```

### How inference works internally

1. SurrealDB retrieves the model definition by name and version
2. Permission checks are applied
3. Input arguments are evaluated:
   - **Object input** -> buffered compute (normalisers from header applied)
   - **Number or array input** -> raw compute (direct tensor conversion)
4. Computation executes in a **blocking task** using the embedded ONNX Runtime
5. Output tensor is converted back to a SurrealDB `Value`

---

## Vector Search Overview

SurrealDB provides native vector search capabilities that make it usable as a **vector database** without external dependencies. Key features:

- First-class `array<float>` type for storing embeddings
- **HNSW** (Hierarchical Navigable Small World) index for approximate nearest neighbour search
- **Brute force** KNN for exact nearest neighbour search on small datasets
- Comprehensive distance and similarity functions
- KNN operator (`<|K, ...|>`) integrated into `WHERE` clauses
- Hybrid search fusion with full-text search results

---

## Storing Vector Embeddings

Embeddings are stored as arrays of floats within record fields:

```surql
-- Simple embedding storage
CREATE document:1 SET
    text = "Graph databases are great.",
    embedding = [0.10, 0.20, 0.30, 0.40, 0.50];

-- Schema-enforced embedding field
DEFINE TABLE documents SCHEMAFULL;
DEFINE FIELD content ON documents TYPE string;
DEFINE FIELD metadata ON documents TYPE object FLEXIBLE;
DEFINE FIELD embedding ON documents TYPE array<float>;

-- High-dimensional embedding (e.g., OpenAI text-embedding-3-large)
CREATE documents:paper1 SET
    content = "Attention is all you need...",
    metadata = { source: "arxiv", year: 2017 },
    embedding = [0.0123, -0.0456, 0.0789, ...];  -- 3072 dimensions
```

There are no strict limitations on embedding dimensionality. Common dimensions:
- 384 (MiniLM, all-MiniLM-L6-v2)
- 768 (BERT, sentence-transformers)
- 1536 (OpenAI text-embedding-ada-002)
- 3072 (OpenAI text-embedding-3-large)

---

## Defining Vector Indexes

### HNSW Index (recommended for production)

HNSW provides efficient approximate nearest neighbour search with logarithmic time complexity: O(log N) vs O(N) for brute force.

```surql
-- Basic HNSW index
DEFINE INDEX idx_embedding ON documents
    FIELDS embedding
    HNSW DIMENSION 3072 DIST COSINE;

-- Full parameter specification
DEFINE INDEX idx_embedding ON documents
    FIELDS embedding
    HNSW
        DIMENSION 3072    -- must match your embedding size
        DIST COSINE       -- distance metric
        TYPE F32          -- vector element type
        EFC 150           -- ef_construction: build-time accuracy
        M 12;             -- max connections per node
```

#### HNSW Parameters

| Parameter | Default | Options | Description |
|-----------|---------|---------|-------------|
| `DIMENSION` | (required) | any integer | Must match embedding dimensionality |
| `DIST` | `EUCLIDEAN` | `EUCLIDEAN`, `COSINE`, `MANHATTAN` | Distance function for index |
| `TYPE` | `F64` | `F64`, `F32`, `I64`, `I32`, `I16` | Vector element storage type |
| `EFC` | `150` | any integer | ef_construction -- larger = more accurate index, slower build |
| `M` | `12` | any integer | Max connections per node -- larger = more accurate, more memory |
| `M0` | `24` | (auto-computed) | Max connections in the lowest layer |
| `LM` | `~0.4024` | (auto-computed) | Level generation multiplier |

> **SurrealDB 3.0:** HNSW uses a bounded memory cache (default 256 MiB) configurable via `SURREAL_HNSW_CACHE_SIZE` environment variable.

#### Background index building (3.0)

```surql
-- DEFER builds the index in the background (useful for large datasets)
DEFINE INDEX idx_embedding ON documents
    FIELDS embedding
    HNSW DIMENSION 768 DIST COSINE
    DEFER;

-- CONCURRENTLY allows reads during index construction
DEFINE INDEX idx_embedding ON documents
    FIELDS embedding
    HNSW DIMENSION 768 DIST COSINE
    CONCURRENTLY;
```

### MTree Index (alternative)

Some SurrealDB documentation and examples also reference MTree indexes:

```surql
DEFINE INDEX idx_product_embedding ON product
    FIELDS details_embedding
    MTREE DIMENSION 768 DIST COSINE TYPE F32;
```

> **Note:** HNSW is generally preferred over MTree for vector search workloads. MTree appears in older docs and some specific use cases.

---

## The KNN Operator

The `<|K, ...|>` operator performs K-Nearest Neighbour search inside `WHERE` clauses:

### Syntax variants

```surql
-- Using HNSW index (index distance function)
WHERE embedding <|K|> $query_vector

-- Using HNSW index with explicit effort parameter
WHERE embedding <|K, EF|> $query_vector

-- Brute force with explicit distance metric
WHERE embedding <|K, DISTANCE_METRIC|> $query_vector
```

### Cheat sheet

| Query Syntax | Behaviour |
|-------------|-----------|
| `<\|2\|>` | Uses the distance function defined in the HNSW index |
| `<\|2, 10\|>` | HNSW with effort=10 (higher = more accurate, slower) |
| `<\|2, 100\|>` | HNSW with effort=100 |
| `<\|2, EUCLIDEAN\|>` | Brute force with Euclidean distance |
| `<\|2, COSINE\|>` | Brute force with cosine distance |
| `<\|2, MANHATTAN\|>` | Brute force with Manhattan distance |
| `<\|2, MINKOWSKI, 3\|>` | Brute force with Minkowski (p=3) |
| `<\|2, CHEBYSHEV\|>` | Brute force with Chebyshev distance |
| `<\|2, HAMMING\|>` | Brute force with Hamming distance |

### Practical examples

```surql
-- Define index and data
DEFINE INDEX hnsw_docs ON documents FIELDS embedding HNSW DIMENSION 768 DIST COSINE;

CREATE documents:1 SET content = "Machine learning fundamentals",
    embedding = [0.12, 0.45, ...];  -- 768-dim
CREATE documents:2 SET content = "Database indexing strategies",
    embedding = [0.33, 0.21, ...];
CREATE documents:3 SET content = "Neural network architectures",
    embedding = [0.15, 0.43, ...];

-- Query: find 5 nearest neighbours using HNSW
LET $query = [0.14, 0.44, ...];  -- 768-dim query embedding

SELECT id, content, vector::distance::knn() AS distance
FROM documents
WHERE embedding <|5, 100|> $query
ORDER BY distance;

-- Brute force cosine (exact, no index needed)
SELECT id, content, vector::distance::knn() AS distance
FROM documents
WHERE embedding <|5, COSINE|> $query
ORDER BY distance;
```

### Filtering with KNN

Vector search can be combined with standard `WHERE` predicates:

```surql
-- Find similar actors who have won an Oscar
DEFINE INDEX hnsw_actors ON actor FIELDS embedding HNSW DIMENSION 4;

SELECT id, name, vector::distance::knn() AS distance
FROM actor
WHERE flag = true                       -- filter: Oscar winner
  AND embedding <|2, 40|> $my_face      -- KNN: top 2 similar
ORDER BY distance;
```

---

## Vector Functions Reference

SurrealDB provides a comprehensive `vector::` function library for numerical computation.

### Basic Vector Operations

| Function | Description | Example |
|----------|-------------|---------|
| `vector::add(a, b)` | Element-wise addition | `vector::add([1,2,3], [4,5,6])` -> `[5,7,9]` |
| `vector::subtract(a, b)` | Element-wise subtraction | `vector::subtract([4,5,6], [1,2,3])` -> `[3,3,3]` |
| `vector::multiply(a, b)` | Element-wise multiplication | `vector::multiply([2,3], [4,5])` -> `[8,15]` |
| `vector::divide(a, b)` | Element-wise division | `vector::divide([6,8], [2,4])` -> `[3,2]` |
| `vector::scale(v, n)` | Scalar multiplication | `vector::scale([1,2,3], 2)` -> `[2,4,6]` |
| `vector::dot(a, b)` | Dot product | `vector::dot([1,2,3], [4,5,6])` -> `32` |
| `vector::cross(a, b)` | Cross product (3D only) | `vector::cross([1,2,3], [4,5,6])` -> `[-3,6,-3]` |
| `vector::magnitude(v)` | Vector length/norm | `vector::magnitude([3,4])` -> `5` |
| `vector::normalize(v)` | Unit vector | `vector::normalize([3,4])` -> `[0.6, 0.8]` |
| `vector::angle(a, b)` | Angle between vectors (radians) | `vector::angle([5,10,15], [10,5,20])` -> `0.3677...` |
| `vector::project(a, b)` | Project a onto b | `vector::project([1,2,3], [4,5,6])` -> `[1.66..., 2.07..., 2.49...]` |

### Distance Functions

| Function | Description |
|----------|-------------|
| `vector::distance::euclidean(a, b)` | L2 distance (straight line) |
| `vector::distance::cosine(a, b)` | 1 - cosine similarity |
| `vector::distance::manhattan(a, b)` | L1 distance (city block) |
| `vector::distance::chebyshev(a, b)` | L-infinity distance |
| `vector::distance::hamming(a, b)` | Number of differing elements |
| `vector::distance::minkowski(a, b, p)` | Generalised Lp distance |
| `vector::distance::mahalanobis(a, b, cov)` | Mahalanobis distance (currently unimplemented) |
| `vector::distance::knn()` | Returns the KNN distance for the current row (use with KNN operator) |

### Similarity Functions

| Function | Description |
|----------|-------------|
| `vector::similarity::cosine(a, b)` | Cosine similarity (0 to 1) |
| `vector::similarity::jaccard(a, b)` | Jaccard similarity |
| `vector::similarity::pearson(a, b)` | Pearson correlation coefficient |
| `vector::similarity::spearman(a, b)` | Spearman rank correlation |

### Usage examples

```surql
-- Direct distance computation
RETURN vector::distance::euclidean([1, 2, 3], [-1, -2, -3]);
-- Returns: 7.483...

-- Cosine similarity between embeddings
RETURN vector::similarity::cosine(
    [0.12, 0.45, 0.78],
    [0.15, 0.42, 0.80]
);
-- Returns: ~0.999

-- Method syntax (arrays support vector methods)
RETURN [1, 2, 3].vector_add([4, 5, 6]);
-- Returns: [5, 7, 9]
```

---

## Full-Text Search Integration

SurrealDB has built-in full-text search with BM25 scoring, which can be combined with vector search for hybrid retrieval.

### Defining a full-text index

```surql
-- Define an analyzer
DEFINE ANALYZER simple TOKENIZERS class, punct FILTERS lowercase, ascii;

-- Define a full-text index with BM25
DEFINE INDEX idx_text ON documents
    FIELDS content
    FULLTEXT ANALYZER simple BM25;
```

### Full-text search query

```surql
-- @1@ assigns a score index (1) for later retrieval
SELECT id, content, search::score(1) AS ft_score
FROM documents
WHERE content @1@ 'machine learning'
ORDER BY ft_score DESC;
```

---

## Hybrid Search -- Fusing Results

SurrealDB provides two fusion functions in the `search::` module to combine results from vector search and full-text search.

### search::linear (weighted linear combination)

Normalises scores from each result list and computes a weighted sum.

```surql
-- Step 1: Vector search
LET $qvec = [0.12, 0.18, 0.27];

LET $vs = SELECT id, vector::distance::knn() AS distance
    FROM documents
    WHERE embedding <|5, 100|> $qvec;

-- Step 2: Full-text search
LET $ft = SELECT id, search::score(1) AS ft_score
    FROM documents
    WHERE content @1@ 'graph databases'
    ORDER BY ft_score DESC
    LIMIT 5;

-- Step 3: Fuse with weighted linear combination
-- Parameters: [result lists], [weights], limit, normalisation_method
RETURN search::linear([$vs, $ft], [2.0, 1.0], 10, 'minmax');
```

**Score extraction priority:** `distance` > `ft_score` > `score` > rank-based fallback.

**Normalisation methods:**
- `'minmax'` -- scales scores to [0, 1] range
- `'zscore'` -- standardises to zero mean, unit variance

### search::rrf (Reciprocal Rank Fusion)

RRF combines ranked lists without requiring score normalisation. Effective when scores from different systems are not comparable.

```surql
-- Fuse using RRF
-- Parameters: [result lists], limit, k_constant (default 60)
RETURN search::rrf([$vs, $ft], 10, 60);
```

**RRF formula:** Score contribution = `1 / (k + rank + 1)` where rank is 0-based.

---

## RAG Patterns in SurrealDB

Retrieval-Augmented Generation is a natural fit for SurrealDB's multi-model architecture. Here is a complete RAG schema pattern:

### Schema setup

```surql
-- Document storage with embeddings
DEFINE TABLE documents SCHEMAFULL;
DEFINE FIELD content ON documents TYPE string;
DEFINE FIELD metadata ON documents TYPE object FLEXIBLE;
DEFINE FIELD embedding ON documents TYPE array<float>;

-- HNSW index for semantic search
DEFINE INDEX hnsw_embedding ON documents
    FIELDS embedding
    HNSW DIMENSION 3072 DIST COSINE;

-- Full-text index for keyword search
DEFINE ANALYZER doc_analyzer TOKENIZERS class, punct FILTERS lowercase, ascii;
DEFINE INDEX idx_content ON documents
    FIELDS content
    FULLTEXT ANALYZER doc_analyzer BM25;
```

### Hybrid search function

```surql
DEFINE FUNCTION fn::hybrid_search($query_text: string, $query_embedding: array, $k: int) {
    -- Semantic search (vector)
    LET $semantic = SELECT id, content,
        vector::distance::knn() AS distance
        FROM documents
        WHERE embedding <|$k, 100|> $query_embedding;

    -- Keyword search (BM25)
    LET $keyword = SELECT id, content,
        search::score(1) AS ft_score
        FROM documents
        WHERE content @1@ $query_text
        ORDER BY ft_score DESC
        LIMIT $k;

    -- Fuse results
    RETURN search::rrf([$semantic, $keyword], $k, 60);
};
```

### Event-driven embedding generation

```surql
-- Automatically generate embeddings when documents are created
DEFINE EVENT auto_embed ON TABLE documents
    WHEN $event = "CREATE"
    THEN {
        UPDATE $after.id SET
            embedding = fn::create_embeddings($after.content)
    };
```

### Graph-enriched RAG

SurrealDB's graph capabilities add context beyond flat document retrieval:

```surql
-- Documents can reference each other
RELATE documents:paper1 -> cites -> documents:paper2;
RELATE documents:paper1 -> cites -> documents:paper3;

-- Retrieve document + all papers it cites (graph traversal)
SELECT content, ->cites->documents.content AS referenced_papers
FROM documents:paper1;

-- Combine: find semantically similar docs, then traverse their graph
LET $similar = SELECT id, content, vector::distance::knn() AS distance
    FROM documents
    WHERE embedding <|3, 100|> $query_embedding
    ORDER BY distance;

-- For each similar doc, also get what it cites
SELECT *, ->cites->documents.content AS also_relevant
FROM $similar;
```

---

## In-Database Embedding Generation

SurrealDB supports generating embeddings entirely within the database, eliminating external API calls.

### Approach 1: Upload a word embedding model as data

Store a pre-trained embedding model (e.g., GloVe, fastText) as records and define a SurrealQL function that converts text to vectors by averaging word vectors:

```surql
-- Store word embeddings as records
DEFINE TABLE word_embedding SCHEMAFULL;
DEFINE FIELD word ON word_embedding TYPE string;
DEFINE FIELD embedding ON word_embedding TYPE array<float>;

-- Create a unique index on word for fast lookup
DEFINE INDEX idx_word ON word_embedding FIELDS word UNIQUE;

-- Load embeddings (bulk import)
CREATE word_embedding SET word = "machine", embedding = [0.12, -0.34, ...];
CREATE word_embedding SET word = "learning", embedding = [0.56, 0.78, ...];
-- ... thousands more

-- Define a function to convert sentences to vectors
DEFINE FUNCTION fn::sentence_to_vector($text: string) {
    LET $words = string::words(string::lowercase($text));
    LET $vectors = (
        SELECT embedding FROM word_embedding
        WHERE word IN $words
    );
    -- Average the word vectors
    -- (implementation depends on available array/vector functions)
    RETURN $averaged_vector;
};
```

### Approach 2: Auto-compute embeddings on write

```surql
-- Field that auto-computes embedding using a custom function
DEFINE FIELD embedding ON documents
    TYPE array<float>
    DEFAULT ALWAYS fn::content_to_vector(content);
```

This declarative approach means every `CREATE` or `UPDATE` automatically generates the embedding -- no external inference engine needed.

### Approach 3: Surrealism WASM plugin (SurrealDB 3.0)

With Surrealism, you can compile an embedding model into a WebAssembly module and run it inside SurrealDB with near-native performance. See [[#Surrealism -- WASM Extensions for AI]].

---

## Surrealism -- WASM Extensions for AI

Introduced in **SurrealDB 3.0**, Surrealism is an open-source extension framework that allows running **WebAssembly (WASM) plugins** directly inside SurrealDB.

### Architecture

- Write functions in Rust (or other WASM-compatible languages)
- Compile to WebAssembly
- Load into SurrealDB (hot-loadable, no restart needed)
- Call from SurrealQL like any other function
- Plugins execute within the same ACID transaction as the invoking query

### AI capabilities

Surrealism plugins can:
- **Call LLMs** (local or remote) directly from SurrealQL
- **Run embedding models** or GPU-accelerated inference next to the data
- **Process unstructured data** (images, audio, documents via vision models)
- **Perform sentiment analysis**, classification, tokenisation, translation
- **Generate embeddings** on INSERT and write results in the same transaction

### Example workflow

```surql
-- Load a WASM extension (conceptual -- syntax may evolve)
DEFINE EXTENSION my_embedder TYPE WASM;

-- Use it in queries
SELECT id, content,
    my_embedder::embed(content) AS embedding
FROM documents;

-- Or trigger on events
DEFINE EVENT embed_on_create ON TABLE documents
    WHEN $event = "CREATE"
    THEN {
        UPDATE $after.id SET
            embedding = my_embedder::embed($after.content)
    };
```

### Key properties

| Feature | Detail |
|---------|--------|
| Isolation | Each invocation runs in a fully sandboxed context |
| Performance | Near-native speed via WASM |
| Transactions | Participates in the same ACID transaction as the query |
| Hot-loading | Deploy/upgrade/rollback without restarting SurrealDB |
| Governance | Fine-grained permission control over who can load/invoke plugins |
| Future languages | JavaScript and Python support planned |

---

## Framework Integrations

SurrealDB integrates with major AI/ML frameworks as a vector store and data backend:

| Framework | Integration Type | Description |
|-----------|-----------------|-------------|
| **LangChain** | Vector store | SurrealDB as HNSW-backed vector store for LangChain RAG pipelines |
| **Llama Index** | Vector store | Native HNSW vector index as backing store for Llama Index |
| **CrewAI** | Memory store | Entity and short-term memory for AI agent orchestration |
| **Agno** | Shared memory | Multi-agent systems with shared memory, knowledge, reasoning |
| **Camel** | Vector storage | Multi-agent LLM systems with SurrealDB vector capabilities |
| **Dynamiq** | Vector storage | Multi-agent LLM systems |
| **Pydantic AI** | Data backend | Production-grade GenAI applications |
| **SmolAgents** | Vector search | Code-generating AI agents querying HNSW indexes |
| **Google Agent** | RAG storage | Intelligent agents in Google Cloud with SurrealDB vector storage |
| **Feast** | Feature store | ML pipeline feature store with vector search integration |
| **Dagster** | Orchestration | Data pipelines with SurrealDB vector search |
| **DeepEval** | Testing | LLM evaluation framework using vector capabilities |

### Embedding provider integrations

| Provider | Languages | Description |
|----------|-----------|-------------|
| **OpenAI** | Python, Rust | OpenAI's embedding API + SurrealDB vector search |
| **Mistral** | Python, Rust | Mistral AI's embedding models |
| **Ollama** | Python, Rust | Local embedding models |
| **Fastembed** | Python | Fast local embeddings |

---

## SurrealDB 3.0 AI Agent Memory

SurrealDB 3.0 is marketed as "the future of AI agent memory." Key 3.0 capabilities for AI:

### Context graphs

Agent memory is stored as **graph relationships** and semantic metadata directly in the database. When an agent interacts with data, it creates context graphs linking entities, decisions, and domain knowledge as database records.

```surql
-- Agent creates a context graph during interaction
CREATE context:session1 SET
    agent_id = "assistant-1",
    topic = "customer support",
    started = time::now();

-- Link to entities discussed
RELATE context:session1 -> discussed -> customer:alice;
RELATE context:session1 -> resolved -> ticket:T-1234;
RELATE context:session1 -> referenced -> document:kb-article-56;

-- Later: agent retrieves full context
SELECT *,
    ->discussed->customer.* AS customers,
    ->resolved->ticket.* AS tickets,
    ->referenced->document.content AS knowledge
FROM context:session1;
```

### MCP-based agent memory

SurrealDB 3.0 supports **Model Context Protocol (MCP)** for agent memory, allowing AI agents on MCP infrastructure to use SurrealDB as a persistent memory layer without custom middleware.

### Single-query multimodal retrieval

A single SurrealQL query can:
- Traverse graph relationships
- Perform vector similarity search
- Join structured records
- Execute ML inference
- All within one ACID transaction

```surql
-- Single query: find similar cases + traverse relationships + structured data
SELECT
    content,
    vector::distance::knn() AS similarity,
    ->relates_to->customer.name AS customer,
    ->tagged_with->category.name AS categories
FROM support_tickets
WHERE embedding <|5, 100|> $query_embedding
ORDER BY similarity;
```

### File support (3.0)

SurrealDB 3.0 handles structured records alongside **images, audio, and documents** -- all queryable within SurrealQL. Combined with Surrealism plugins for vision/audio models, this enables multimodal AI applications.

---

## Limitations and Considerations

### SurrealML limitations
- Designed for **traditional ML models** (regression, classification, small neural nets) -- not for multi-billion parameter LLMs
- Models must be convertible to ONNX format
- ONNX Runtime version is fixed at 1.16.0
- The `surrealml` feature must be enabled at compile time (may not be available in all distributions)
- Model size is limited by available memory (loaded entirely into RAM for inference)

### Vector search limitations
- HNSW is **approximate** -- may miss some nearest neighbours (tune EF for accuracy vs speed tradeoff)
- HNSW indexes consume significant memory (graph structure stored in RAM)
- Default memory cache is 256 MiB in SurrealDB 3.0 (configurable)
- `vector::distance::mahalanobis` is currently unimplemented
- No built-in product quantization or dimensionality reduction yet

### Practical considerations
- For large embedding models, generate embeddings externally (OpenAI, Ollama, etc.) and store the resulting vectors
- For small models (GloVe, fastText), in-database embedding generation works well
- HNSW parameters (`M`, `EFC`) should be tuned for your dataset size and accuracy requirements
- Use `DEFER` for background index building on large existing datasets
- Embedding dimensionality affects storage and search performance -- use the smallest dimension that meets accuracy needs

---

## Summary

| Capability | Status | Key Feature |
|-----------|--------|-------------|
| ML model storage (.surml) | Stable (2.x+) | ONNX-based, framework-agnostic |
| In-database inference (ml::) | Stable (2.x+) | PyTorch, sklearn, TF models |
| HNSW vector index | Stable (2.x+) | Approximate KNN, configurable |
| Brute force KNN | Stable (2.x+) | Exact search, multiple metrics |
| Vector functions | Stable (2.x+) | 20+ distance/similarity/math functions |
| Hybrid search fusion | Stable (2.x+) | search::linear, search::rrf |
| Full-text search (BM25) | Stable (2.x+) | Analyzers, tokenizers, highlights |
| Surrealism (WASM plugins) | New in 3.0 | AI logic inside the database |
| Agent memory / context graphs | New in 3.0 | MCP support, graph-based memory |
| File support (multimodal) | New in 3.0 | Images, audio, documents |
| Bounded HNSW cache | New in 3.0 | Configurable memory limit |
| DEFER index building | New in 3.0 | Background index construction |

SurrealDB's AI capabilities are not a bolt-on feature but a core architectural concern. The combination of vector search, graph traversal, full-text search, ML inference, and now WASM extensions in a single transactional database makes it a compelling option for teams building AI-native applications who want to reduce the number of moving parts in their data stack.

---

*See also: [[SurrealDB 3.0 Index]] (when available)*
