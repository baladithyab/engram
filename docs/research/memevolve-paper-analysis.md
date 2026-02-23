# MemEvolve Paper Analysis — Meta-Evolution of Agent Memory Systems

> **Paper:** "MemEvolve: Meta-Evolution of Agent Memory Systems" (Zhang et al., 2025)
> **Authors:** Guibin Zhang, Haotian Ren, Chong Zhan, Zhenhong Zhou, Junhao Wang, He Zhu, Wangchunshu Zhou, Shuicheng Yan — OPPO AI Agent Team, LV-NUS Lab
> **Published:** 21 December 2025 (arXiv: 2512.18746)
> **Repository:** [bingreeky/MemEvolve](https://github.com/bingreeky/MemEvolve)
> **Related:** [[SurrealDB Agentic Memory Index]], [[LightRAG Architecture and SurrealDB Mapping]], [[Graphiti Architecture and SurrealDB Mapping]], [[Agentic Memory Frameworks Survey]]

---

## 1. Core Thesis — From Fixed Memory to Self-Improving Architecture

Most LLM-based agents treat memory as a fixed scaffolding: a predetermined system of encode-store-retrieve operations that never changes regardless of what the agent learns. The agent improves by accumulating better *content* within the memory, but the *architecture* governing how it encodes, stores, retrieves, and manages that content remains static.

MemEvolve argues this is fundamentally limiting. The analogy is a student who always takes the same kind of notes using the same study method regardless of the subject. MemEvolve proposes **meta-evolution**: jointly evolving both the experiential knowledge *and* the memory architecture itself. The architecture adapts to the task domain — memorizing specific facts for one class of tasks, abstracting patterns for another, favoring recency for navigation or deep hierarchical organization for reasoning.

The core claim: intelligence requires not just knowledge accumulation but **structural plasticity** — the ability to reorganize cognitive architecture in response to environmental demands. The path to more general AI agents runs through autonomous meta-adaptation of memory systems, not merely scaling model parameters.

---

## 2. EvolveLab — The Modular Design Space

Before evolving memory architectures, you need a way to *describe* them in composable terms. EvolveLab is a unified codebase that decomposes any memory system into four fundamental modules — the **EURM framework** (Encode, Update/Store, Retrieve, Manage):

### 2.1 The Four Modules

```
MEMORY ARCHITECTURE (EURM Decomposition)
═══════════════════════════════════════════

    Raw Experience                  Current Task Context
         │                                │
         ▼                                │
    ┌─────────┐                           │
    │ ENCODE  │ ← Transforms trajectories │
    │   (E)   │   into structured         │
    └────┬────┘   representations         │
         │                                │
         ▼                                ▼
    ┌─────────┐                     ┌───────────┐
    │ UPDATE/ │ ← Integrates into   │ RETRIEVE  │ ← Selects relevant
    │ STORE   │   persistent store  │    (R)    │   memories for
    │   (U)   │                     └─────┬─────┘   current query
    └────┬────┘                           │
         │                                │
         ▼                                ▼
    ┌─────────────────────────────────────────┐
    │              MEMORY STATE               │
    │   (episodes, abstractions, skills...)   │
    └────────────────────┬────────────────────┘
                         │
                         ▼
                    ┌─────────┐
                    │ MANAGE  │ ← Consolidation,
                    │   (G)   │   pruning, conflict
                    └─────────┘   resolution
```

**Encode (E)** — Transforms raw agent experiences (observations, actions, rewards, trajectories) into structured memory representations. This can range from verbatim trajectory storage to LLM-based abstraction that extracts task-relevant patterns from execution traces. Example: converting a failed web navigation attempt into a compact failure-pattern representation.

**Update/Store (U)** — Determines how encoded experiences integrate with persistent memory. Policies include: discarding redundant entries, storing as episodic memories (specific instances), or abstracting into semantic memories (generalized patterns). The storage policy balances memory capacity with informativeness.

**Retrieve (R)** — Selects relevant memories given the current task context. Methods range from similarity-based retrieval (vector embeddings), to rule-based filtering (task type matching), to recency-weighted selection, to hybrid approaches.

**Manage (G)** — Performs offline lifecycle operations: consolidating episodic memories into semantic abstractions, pruning outdated patterns, resolving contradictory guidance. Critical for long-term stability as memory grows.

Any memory architecture can be expressed as a specific combination of implementations across these four modules. This creates a **genotype** `g = (g_E, g_U, g_R, g_G)` — a formal specification that can be systematically evolved.

### 2.2 The 12 Baseline Systems

EvolveLab re-implements twelve representative memory architectures within this modular framework, providing both a standardized implementation substrate and a fair experimental arena:

| System | Core Approach | Primary EURM Strength |
|--------|--------------|----------------------|
| **ExpeL** | Stores trajectories with binary success labels; retrieves similar past attempts | U (labeled experience storage) |
| **Voyager** | Maintains executable skill library for open-world embodied agents | E (code-level encoding), U (skill storage) |
| **AWM (Agent Workflow Memory)** | Abstracts successful workflows into reusable templates | E (workflow abstraction) |
| **Dynamic Cheatsheet** | Builds adaptive reference documents that evolve with task distribution | U/G (living document updates) |
| **Reflexion** | Self-reflects on failures to generate improvement insights | E (failure analysis encoding) |
| **DILU** | Incremental learning from task demonstrations | E/R (demonstration retrieval) |
| **Generative Agents** | Full cognitive architecture with reflection, planning, retrieval | All four modules |
| **MEMP** | Prompt-based memory injection for few-shot learning | R (prompt injection) |
| **SkillWeaver** | Synthesizes reusable tool/skill code from experience | E/U (skill synthesis) |
| **MobileE** | Mobile agent experience storage and retrieval | U/R (mobile context) |
| **Agent-KB** | Knowledge base accumulation across episodes | U/G (knowledge base management) |
| **Evolver** | Iterative self-improvement through experience replay | G (iterative refinement) |

Each baseline instantiates the EURM modules differently, enabling controlled comparison of what component choices matter most for which tasks.

### 2.3 Evolved Systems

MemEvolve has produced two named evolved architectures:

- **Lightweight Memory** — An evolved system optimized for efficiency, demonstrating that evolution can discover compact yet effective designs
- **Cerebra Fusion Memory** — A more complex evolved system with hybrid retrieval strategies, showing evolution can also discover sophisticated multi-strategy approaches

---

## 3. The Dual-Loop Evolutionary Process

MemEvolve implements a **bilevel optimization** with nested inner and outer loops:

```
OUTER LOOP (Architectural Evolution)
══════════════════════════════════════════════════════════════
│                                                            │
│  Initialize population J^(0) = { baseline memory systems } │
│                                                            │
│  for k = 0 ... K_max:                                     │
│    ┌─────────────────────────────────────────────────┐     │
│    │  INNER LOOP (Experience Accumulation)            │     │
│    │  ─────────────────────────────────────────────── │     │
│    │  for each candidate j in J^(k):                  │     │
│    │    for each task trajectory τ:                    │     │
│    │      ε ← Encode_j(τ)          # encode          │     │
│    │      M ← Update_j(M, ε)       # store           │     │
│    │      c ← Retrieve_j(M, query) # retrieve        │     │
│    │      a ← agent_policy(c)      # act             │     │
│    │      record feedback f_j(τ)                      │     │
│    │    F_j^(k) ← aggregate({f_j(τ)})                │     │
│    └─────────────────────────────────────────────────┘     │
│                                                            │
│    SELECTION: P^(k) ← select_top_K(F_j^(k))              │
│    DIAGNOSIS: D ← diagnose_defects(p) for each parent p   │
│    DESIGN:    new_arch ← redesign(p.arch, D, seed=s)      │
│    J^(k+1) ← new architectures + elite preservation       │
══════════════════════════════════════════════════════════════
```

### 3.1 Inner Loop — Experience Evolution

For each candidate memory system at iteration k:
- Agents interact with tasks/environments using the current memory architecture
- Memory state M updates based on new experiences through the EURM pipeline
- Trajectory batches are generated and recorded
- **Performance feedback vectors** capture three dimensions:
  - Task success rates
  - Resource consumption (API costs)
  - Execution efficiency (latency/delay)

### 3.2 Outer Loop — Architectural Evolution

Uses feedback summaries from the inner loop to evolve the population of memory architectures through a three-stage "diagnose-and-design" process:

**Stage 1 — Selection.** Ranks candidates using Pareto multi-objective optimization balancing task performance, API cost, and execution delay. This ensures evolution does not optimize for accuracy alone at the expense of practical deployability.

**Stage 2 — Diagnosis.** For each selected parent architecture, the system analyzes execution logs and trajectory evidence to generate a **defect profile** identifying specific bottlenecks. Example diagnosis output:

```
Defect: Retrieval module returns irrelevant memories 43% of the time
Root cause: Embedding space conflates syntactically similar but semantically
            distinct tasks
Proposed mutation: Replace cosine similarity with learned task-specific
                   distance metric
```

**Stage 3 — Design (Mutation + Crossover).** Creates new descendant architectures by modifying components based on diagnosed defects:

**Mutation operators** target specific modules:
- *Encoding mutations:* Change abstraction granularity (token-level to semantic-level)
- *Storage mutations:* Modify retention policies ("keep all" to "keep top-k diverse")
- *Retrieval mutations:* Alter selection strategies (similarity to recency to hybrid)
- *Management mutations:* Adjust consolidation thresholds, pruning frequencies

**Crossover operators** combine architectures:
- *Module-wise crossover:* Swap entire EURM modules between parent architectures
- *Parameter crossover:* Blend hyperparameters (retrieval top-k, embedding dimensions)

A **creativity parameter** (0.0-1.0) controls the degree of innovation in system generation, balancing exploitation of known-good designs with exploration of novel architectures.

### 3.3 Tournament Process (Implementation)

The actual evolution proceeds through a tournament structure per round:

1. **Collect base logs** — Run current system on x tasks
2. **Generate candidates** — Create N new systems via independent analysis
3. **Tournament** — Evaluate N+1 systems on the same x tasks
4. **Finals** — Top t systems compete on expanded task set (y + new x)
5. **Selection** — Winner advances to next round

Checkpoints auto-save on errors; the process can resume from any round.

---

## 4. Key Results

### 4.1 Performance Improvements

| Framework + Backbone | Benchmark | Baseline | MemEvolve | Gain |
|---------------------|-----------|----------|-----------|------|
| Flash-Searcher + GPT-5-Mini | WebWalkerQA | ~61% | ~74.8% | **+17.06%** (pass@1) |
| SmolAgent + GPT-5-Mini | xBench-DS | ~51% | ~57% | +6% |
| Flash-Searcher + GPT-5-Mini | xBench-DS | ~55.8% | ~69.5% | +13.7% |
| Various | GAIA | 48.3% | 65.36% | +17.06% |

Consistent improvements of 3.54% to 17.06% across different frameworks and tasks.

### 4.2 Cross-Task Generalization

Memory systems evolved on synthetic TaskCraft benchmarks transfer effectively to more challenging real-world domains (WebWalkerQA, xBench-DS). The transferred systems consistently outperform all static baselines — evidence that evolution discovers generalizable memory principles rather than task-specific heuristics.

### 4.3 Cross-LLM Generalization

Architectures evolved with GPT-5-Mini transfer successfully to Kimi K2 and DeepSeek V3.2. This means the learned memory strategies are not coupled to specific model behaviors but capture general principles of effective information management.

### 4.4 Cross-Framework Generalization

Architectures evolved with Flash-Searcher transfer to different multi-agent systems (Cognitive Kernel-Pro, OWL), demonstrating framework-agnostic memory principles.

### 4.5 Memory Efficiency

- Static baselines: linear memory growth (10 MB to 450 MB over 1000 episodes)
- MemEvolve: sub-linear growth through learned consolidation (10 MB to 180 MB)
- **60% reduction** in storage while maintaining higher accuracy

### 4.6 Adversarial Robustness

| Attack Type | Static Memory | MemEvolve |
|------------|--------------|-----------|
| MINJA (memory injection) | 72% attack success | **31% attack success** |
| Reasoning-style poisoning | Collapses after 50 episodes | Maintains 89% after 200 episodes |

Evolved architectures learn to cross-validate retrieved memories against multiple sources, providing inherent resistance to adversarial manipulation.

---

## 5. Emergent Architectural Patterns

Evolution discovered specialized memory strategies without human guidance:

- **Navigation tasks:** Retrieval favored recency over semantic similarity — recent memories of URL patterns and navigation strategies were more useful than semantically similar but outdated ones
- **Reasoning tasks:** Deep hierarchical memory organization emerged, with multiple levels of abstraction
- **Tool-use tasks:** Procedural memory (skill chaining) dominated over episodic or semantic storage
- **Planning phases:** Evolved systems provided high-level strategic insights
- **Execution phases:** Evolved systems switched to specific tool-use suggestions and contextual information

A general progression was observed: simple frozen encoding/storage systems evolved toward complex architectures with multi-level abstractions, agent-driven encoding/decoding, hybrid retrieval strategies, and periodic memory maintenance.

---

## 6. Relationship to Other Memory Systems

MemEvolve sits at a higher level of abstraction than individual memory systems. It is a **meta-framework** that can discover, evaluate, and improve memory architectures:

| System | Relationship to MemEvolve |
|--------|--------------------------|
| **ExpeL** | One of 12 baselines; fixed-architecture exemplar that MemEvolve supersedes |
| **Voyager** | Skill-library approach re-implemented as a baseline; evolved architectures outperform it |
| **Reflexion** | Self-reflection as fixed strategy; MemEvolve can evolve whether/when to use reflection |
| **MemGPT/Letta** | OS-style memory management; MemEvolve could potentially discover similar patterns through evolution |
| **A-Mem** | Zettelkasten-inspired agentic memory; concurrent work with different focus (dynamic organization vs. architectural evolution) |
| **MemSkill** | Concurrent work that evolves memory *skills* (reusable operations), complementary to MemEvolve's architectural evolution |
| **Evo-Memory** | Google DeepMind benchmark for *evaluating* self-evolving memory; MemEvolve provides the *mechanism* for evolution |
| **Mem0** | Production-grade long-term memory; the practical implementation layer that could benefit from MemEvolve-discovered architectures |

---

## 7. SurrealDB Mapping — Implementing MemEvolve Concepts

This section maps each core MemEvolve concept to concrete SurrealDB primitives, showing how SurrealDB's multi-model architecture naturally supports meta-evolutionary memory.

### 7.1 EURM Modules as SurrealDB Structures

#### Encode Module → SurrealDB Record Links + Computed Fields

The Encode module transforms raw experience into structured representations. In SurrealDB, this maps to document creation with computed fields that automatically extract structure:

```surql
-- Raw trajectory storage (episodic encoding)
DEFINE TABLE trajectory SCHEMAFULL;
DEFINE FIELD agent         ON trajectory TYPE string;
DEFINE FIELD task_id       ON trajectory TYPE string;
DEFINE FIELD observations  ON trajectory TYPE array<object>;
DEFINE FIELD actions       ON trajectory TYPE array<object>;
DEFINE FIELD outcome       ON trajectory TYPE string
    ASSERT $value IN ["success", "failure", "partial"];
DEFINE FIELD reward        ON trajectory TYPE float;
DEFINE FIELD created_at    ON trajectory TYPE datetime
    DEFAULT time::now();
DEFINE FIELD duration_ms   ON trajectory TYPE int;

-- Encoded experience (structured representation derived from trajectory)
DEFINE TABLE encoded_experience SCHEMAFULL;
DEFINE FIELD source_trajectory ON encoded_experience TYPE record<trajectory>;
DEFINE FIELD encoding_strategy ON encoded_experience TYPE string;  -- which E module variant
DEFINE FIELD abstraction_level ON encoded_experience TYPE string
    ASSERT $value IN ["verbatim", "summarized", "pattern", "skill"];
DEFINE FIELD content        ON encoded_experience TYPE object;     -- strategy-specific payload
DEFINE FIELD embedding      ON encoded_experience TYPE array<float>;
DEFINE FIELD tags           ON encoded_experience TYPE array<string>;
DEFINE FIELD created_at     ON encoded_experience TYPE datetime DEFAULT time::now();

-- Vector index for semantic retrieval
DEFINE INDEX idx_experience_embedding
    ON encoded_experience FIELDS embedding
    HNSW DIMENSION 1536 DIST COSINE;
```

#### Store/Update Module → SurrealDB UPSERT + DEFINE EVENT

The Store module decides whether to insert, merge, or discard incoming encoded experiences. SurrealDB events can automate these policies:

```surql
-- Deduplication event: when a new encoded_experience is created,
-- check for near-duplicates and merge if found
DEFINE EVENT on_experience_created ON encoded_experience WHEN $event = "CREATE" THEN {
    -- Find near-duplicates using vector similarity
    LET $similar = SELECT id, content, embedding
        FROM encoded_experience
        WHERE id != $after.id
            AND vector::similarity::cosine(embedding, $after.embedding) > 0.92;

    -- If duplicates exist, merge into the existing record and delete the new one
    IF array::len($similar) > 0 {
        UPDATE $similar[0].id SET
            content.merged_count += 1,
            content.last_seen = time::now(),
            content.sources += [$after.source_trajectory];
        DELETE $after.id;
    };
};

-- Storage policy table (part of the architecture genotype)
DEFINE TABLE storage_policy SCHEMAFULL;
DEFINE FIELD name           ON storage_policy TYPE string;
DEFINE FIELD max_episodes   ON storage_policy TYPE int;
DEFINE FIELD dedup_threshold ON storage_policy TYPE float;  -- cosine similarity threshold
DEFINE FIELD abstraction_trigger ON storage_policy TYPE int; -- merge after N similar episodes
DEFINE FIELD retention_days ON storage_policy TYPE int;
```

#### Retrieve Module → SurrealDB Vector Search + Graph Traversal

The Retrieve module supports multiple retrieval strategies. SurrealDB enables all of them natively:

```surql
-- Strategy 1: Vector similarity retrieval
SELECT id, content, abstraction_level,
    vector::similarity::cosine(embedding, $query_embedding) AS relevance
FROM encoded_experience
WHERE vector::similarity::cosine(embedding, $query_embedding) > 0.7
ORDER BY relevance DESC
LIMIT 10;

-- Strategy 2: Recency-weighted retrieval (navigation tasks)
SELECT id, content,
    vector::similarity::cosine(embedding, $query_embedding) AS semantic,
    math::pow(0.95, duration::days(time::now() - created_at)) AS recency,
    (semantic * 0.4 + recency * 0.6) AS score
FROM encoded_experience
ORDER BY score DESC
LIMIT 10;

-- Strategy 3: Graph-traversal retrieval (reasoning tasks)
-- Follow relationships between experiences
SELECT <-relates_to<-encoded_experience AS related,
       ->leads_to->encoded_experience AS consequences
FROM encoded_experience
WHERE id = $anchor_memory;

-- Strategy 4: Hybrid retrieval (evolved pattern)
-- Combine vector search with graph expansion
LET $seeds = (SELECT id FROM encoded_experience
    WHERE vector::similarity::cosine(embedding, $query_embedding) > 0.75
    ORDER BY vector::similarity::cosine(embedding, $query_embedding) DESC
    LIMIT 5);
LET $expanded = (SELECT ->relates_to->encoded_experience.* AS related
    FROM $seeds);
-- Return union of seeds + graph-expanded results
```

#### Manage Module → SurrealDB Scheduled Events + Computed Fields

The Manage module handles memory lifecycle. SurrealDB computed fields and events model decay, consolidation, and pruning:

```surql
-- Memory decay: time-based relevance scoring via computed field
DEFINE FIELD relevance_score ON encoded_experience VALUE {
    LET $age_days = duration::days(time::now() - created_at);
    LET $base_relevance = IF outcome = "success" THEN 1.0 ELSE 0.5 END;
    LET $access_boost = math::log(access_count + 1) * 0.1;
    RETURN $base_relevance * math::pow(0.98, $age_days) + $access_boost
};

-- Consolidation event: merge episodic memories into semantic abstractions
-- Triggered when episode count for a task type exceeds threshold
DEFINE EVENT consolidate_memories ON encoded_experience WHEN $event = "CREATE" THEN {
    LET $task_type = $after.content.task_type;
    LET $episode_count = (SELECT count() FROM encoded_experience
        WHERE content.task_type = $task_type
            AND abstraction_level = "verbatim"
        GROUP ALL).count;

    IF $episode_count > 10 {
        -- Create a semantic abstraction from the cluster
        CREATE encoded_experience SET
            encoding_strategy = "consolidation",
            abstraction_level = "pattern",
            content = {
                task_type: $task_type,
                pattern: "consolidated from " + <string>$episode_count + " episodes",
                consolidated_at: time::now()
            },
            source_trajectory = $after.source_trajectory;

        -- Mark originals as consolidated (don't delete — keep lineage)
        UPDATE encoded_experience SET content.consolidated = true
            WHERE content.task_type = $task_type
                AND abstraction_level = "verbatim";
    };
};

-- Pruning: remove low-relevance memories
-- (Would be called periodically or via application logic)
DELETE FROM encoded_experience
    WHERE relevance_score < 0.1
        AND created_at < time::now() - 30d;
```

### 7.2 Architecture Genotype as SurrealDB Records

The key insight of MemEvolve is treating the memory architecture itself as an evolvable entity. In SurrealDB, the architecture genotype becomes a first-class record:

```surql
-- The memory architecture genotype
DEFINE TABLE memory_architecture SCHEMAFULL;
DEFINE FIELD name           ON memory_architecture TYPE string;
DEFINE FIELD generation     ON memory_architecture TYPE int;
DEFINE FIELD parent         ON memory_architecture TYPE option<record<memory_architecture>>;

-- EURM module specifications (the genes)
DEFINE FIELD encode_spec    ON memory_architecture TYPE object;
    -- e.g., { strategy: "llm_summarize", abstraction: "pattern", model: "gpt-4o-mini" }
DEFINE FIELD store_spec     ON memory_architecture TYPE object;
    -- e.g., { policy: "top_k_diverse", max_entries: 500, dedup_threshold: 0.9 }
DEFINE FIELD retrieve_spec  ON memory_architecture TYPE object;
    -- e.g., { strategy: "hybrid", vector_weight: 0.4, recency_weight: 0.6, top_k: 10 }
DEFINE FIELD manage_spec    ON memory_architecture TYPE object;
    -- e.g., { consolidation_threshold: 10, decay_rate: 0.98, prune_below: 0.1 }

-- Fitness metrics (multi-objective)
DEFINE FIELD fitness        ON memory_architecture TYPE object;
    -- { task_success: 0.74, api_cost: 0.023, latency_ms: 340 }
DEFINE FIELD defect_profile ON memory_architecture TYPE option<object>;
    -- Diagnosis results from outer loop

DEFINE FIELD created_at     ON memory_architecture TYPE datetime DEFAULT time::now();
DEFINE FIELD is_active      ON memory_architecture TYPE bool DEFAULT false;

-- Track evolutionary lineage
DEFINE TABLE evolved_from SCHEMAFULL TYPE RELATION
    FROM memory_architecture TO memory_architecture;
DEFINE FIELD operator   ON evolved_from TYPE string
    ASSERT $value IN ["mutation", "crossover", "elite_preservation"];
DEFINE FIELD module_changed ON evolved_from TYPE option<string>
    ASSERT $value IN [NONE, "encode", "store", "retrieve", "manage"];
DEFINE FIELD diagnosis  ON evolved_from TYPE option<string>;
```

This enables powerful evolutionary queries:

```surql
-- Find the best architecture for a given task type
SELECT name, fitness.task_success, generation
FROM memory_architecture
WHERE fitness.task_success IS NOT NONE
ORDER BY fitness.task_success DESC
LIMIT 5;

-- Trace the evolutionary lineage of the best architecture
SELECT <-evolved_from<-memory_architecture AS parents,
       ->evolved_from->memory_architecture AS children,
       defect_profile
FROM memory_architecture
WHERE name = "cerebra_fusion_v3";

-- Find which modules are most frequently mutated (bottleneck analysis)
SELECT module_changed, count() AS mutation_count
FROM evolved_from
WHERE operator = "mutation"
GROUP BY module_changed
ORDER BY mutation_count DESC;
```

### 7.3 Dual-Loop Evolution in SurrealDB

#### Inner Loop — Experience Accumulation

```surql
-- Record an agent's task execution within a fixed architecture
CREATE trajectory SET
    agent = "agent_01",
    task_id = "webwalker_q42",
    observations = [
        { step: 1, type: "page_load", url: "https://example.com", content: "..." },
        { step: 2, type: "click", target: "#nav-link", result: "navigated" }
    ],
    actions = [
        { step: 1, type: "navigate", target: "https://example.com" },
        { step: 2, type: "click", selector: "#nav-link" }
    ],
    outcome = "success",
    reward = 1.0,
    duration_ms = 4200;

-- The DEFINE EVENT on encoded_experience automatically handles
-- encoding, deduplication, and storage per the active architecture
```

#### Outer Loop — Architectural Evolution

```surql
-- Step 1: Aggregate fitness for current generation
LET $gen = 3;
SELECT
    name,
    math::mean(->evaluated_on->task_result.success) AS avg_success,
    math::mean(->evaluated_on->task_result.api_cost) AS avg_cost,
    math::mean(->evaluated_on->task_result.latency_ms) AS avg_latency
FROM memory_architecture
WHERE generation = $gen
GROUP BY name;

-- Step 2: Pareto selection (keep non-dominated solutions)
-- Application logic ranks by multiple objectives and selects top-k

-- Step 3: Create mutated descendant
CREATE memory_architecture SET
    name = "cerebra_fusion_v4",
    generation = $gen + 1,
    parent = memory_architecture:cerebra_v3,
    encode_spec = { strategy: "llm_summarize", abstraction: "pattern" },
    store_spec = { policy: "top_k_diverse", max_entries: 750, dedup_threshold: 0.88 },
    retrieve_spec = {
        strategy: "hybrid_evolved",
        vector_weight: 0.35,
        recency_weight: 0.45,
        graph_weight: 0.20,  -- NEW: added graph traversal
        top_k: 12
    },
    manage_spec = { consolidation_threshold: 8, decay_rate: 0.97, prune_below: 0.08 };

-- Record the evolutionary step
RELATE memory_architecture:cerebra_v3 -> evolved_from -> memory_architecture:cerebra_v4 SET
    operator = "mutation",
    module_changed = "retrieve",
    diagnosis = "Retrieval missed graph-connected memories in multi-hop reasoning tasks";
```

### 7.4 Defect Diagnosis with SurrealDB Analytics

```surql
-- Analyze retrieval quality for a given architecture
SELECT
    content.task_type,
    count() AS total_retrievals,
    math::mean(retrieval_relevance) AS avg_relevance,
    count(IF retrieval_relevance < 0.3 THEN true END) AS irrelevant_count,
    (irrelevant_count / total_retrievals * 100) AS irrelevant_pct
FROM retrieval_log
WHERE architecture = memory_architecture:cerebra_v3
GROUP BY content.task_type;

-- Identify which module is the bottleneck
-- Compare encode quality, store efficiency, retrieval precision, manage health
SELECT
    "encode" AS module,
    math::mean(encoding_quality_score) AS health
FROM encoded_experience
WHERE architecture = memory_architecture:cerebra_v3
UNION ALL
SELECT
    "retrieve" AS module,
    math::mean(retrieval_relevance) AS health
FROM retrieval_log
WHERE architecture = memory_architecture:cerebra_v3
UNION ALL
SELECT
    "manage" AS module,
    (1.0 - (dead_memory_count / total_memory_count)) AS health
FROM memory_health_check
WHERE architecture = memory_architecture:cerebra_v3
ORDER BY health ASC;
-- Lowest-health module is the diagnosis target
```

### 7.5 Cross-Task Generalization via Architecture Transfer

```surql
-- Find architectures that generalize well across task types
SELECT
    name,
    array::distinct(->evaluated_on->task_result.task_type) AS task_types,
    math::mean(->evaluated_on->task_result.success) AS overall_success,
    math::min(->evaluated_on->task_result.success) AS worst_case,
    (overall_success - worst_case) AS performance_variance
FROM memory_architecture
WHERE array::len(task_types) >= 3
ORDER BY overall_success DESC, performance_variance ASC
LIMIT 5;

-- Transfer an evolved architecture to a new task domain
-- Clone the architecture with a new evaluation context
CREATE memory_architecture SET
    name = "cerebra_fusion_v4_transfer",
    generation = 0,  -- reset generation for new domain
    parent = memory_architecture:cerebra_v4,
    encode_spec = (SELECT encode_spec FROM memory_architecture:cerebra_v4),
    store_spec = (SELECT store_spec FROM memory_architecture:cerebra_v4),
    retrieve_spec = (SELECT retrieve_spec FROM memory_architecture:cerebra_v4),
    manage_spec = (SELECT manage_spec FROM memory_architecture:cerebra_v4),
    is_active = true;
```

### 7.6 Complete Concept-to-Primitive Mapping Table

| MemEvolve Concept | SurrealDB Primitive | Notes |
|---|---|---|
| Raw experience / trajectory | `trajectory` table (document) | Full-fidelity episodic storage with structured fields |
| Encoded experience | `encoded_experience` table + computed fields | Abstraction level tracked per record |
| Memory architecture genotype | `memory_architecture` table | EURM specs as JSON objects; first-class evolvable entity |
| Evolutionary lineage | `evolved_from` RELATION + graph traversal | Tracks mutation/crossover ancestry with `<-` and `->` operators |
| Vector retrieval | `DEFINE INDEX ... HNSW DIMENSION 1536 DIST COSINE` | Native HNSW indexes on embedding fields |
| Similarity-based deduplication | `vector::similarity::cosine()` in EVENT triggers | Automatic on CREATE events |
| Memory decay | Computed field with `math::pow(rate, age_days)` | Recalculated on every read; zero storage overhead |
| Time-based scoring | `duration::days(time::now() - created_at)` | Native datetime arithmetic |
| Recency-weighted retrieval | Combined `cosine_sim * w1 + recency * w2` scoring | Weights stored in `retrieve_spec` of the architecture |
| Graph-based retrieval | `->relates_to->`, `<-leads_to<-` traversal | Native graph queries; no separate graph DB needed |
| Memory consolidation | `DEFINE EVENT` triggers on threshold conditions | Automatic pattern extraction when episode count exceeds threshold |
| Memory pruning | `DELETE ... WHERE relevance_score < threshold` | Based on computed decay field |
| Fitness evaluation | Aggregate queries with `math::mean()`, `math::min()` | Multi-objective Pareto analysis via application logic |
| Defect diagnosis | Analytical queries grouping by module health | `GROUP BY` + aggregation identifies bottleneck modules |
| Cross-task transfer | Record cloning with `parent` reference | Architecture specs copied; evaluation context reset |
| Population management | `generation` field + `WHERE generation = $gen` | Each evolutionary round is a generation; easy population queries |
| Elite preservation | `evolved_from` with `operator = "elite_preservation"` | Best architectures carried forward unchanged |
| Tournament selection | Task result relations + ranking queries | `ORDER BY fitness.task_success DESC LIMIT $top_k` |
| Adversarial robustness | Cross-validation via multiple retrieval paths | Graph + vector + recency redundancy resists single-vector poisoning |

### 7.7 Why SurrealDB Is a Natural Fit

SurrealDB's multi-model architecture maps remarkably well to MemEvolve's requirements because MemEvolve needs *all* of these simultaneously:

1. **Document store** (trajectories, experiences, architecture specs) — SurrealDB tables with flexible schemas
2. **Graph database** (evolutionary lineage, memory relationships, knowledge graphs) — native `RELATE` and graph traversal
3. **Vector database** (semantic retrieval, deduplication) — HNSW indexes with cosine/euclidean distance
4. **Event system** (storage policies, consolidation triggers) — `DEFINE EVENT` for automatic memory lifecycle
5. **Computed fields** (memory decay, relevance scoring) — dynamic values recalculated on access
6. **Multi-tenancy** (multiple agents, multiple architectures) — namespaces and record-level access control

A traditional stack would require separate systems for each: PostgreSQL for documents, Neo4j for graphs, Pinecone for vectors, Redis for events, plus application-level glue. SurrealDB collapses this into a single query language and storage engine, which directly mirrors MemEvolve's modular-but-unified design philosophy — four modules (EURM), one coherent system.

---

## 8. Implications for SurrealDB Agentic Memory Design

### 8.1 Architecture as Data

MemEvolve's most profound insight for database design is: **the memory architecture itself should be stored as data, not hard-coded as application logic**. SurrealDB enables this naturally:

- Storage policies become records in a `storage_policy` table
- Retrieval strategies become records in a `retrieval_strategy` table with weight configurations
- Consolidation rules become `DEFINE EVENT` definitions that reference architecture records
- The active architecture is a simple `WHERE is_active = true` filter

This means the system can switch architectures at runtime, A/B test different memory strategies, and even let the agent propose architectural modifications that get applied via SurrealQL updates.

### 8.2 Evolution-Ready Schema Design

When designing SurrealDB schemas for agentic memory, the MemEvolve lens suggests:

1. **Always track provenance** — every memory should link back to the trajectory that produced it and the architecture that encoded it
2. **Make abstraction level explicit** — a `level` field ("verbatim", "summarized", "pattern", "skill") enables consolidation queries
3. **Store fitness alongside architecture** — multi-objective metrics enable Pareto selection queries
4. **Use relations for lineage** — `evolved_from`, `consolidated_from`, `derived_from` relations create a full audit trail
5. **Design for multi-strategy retrieval** — HNSW indexes + graph edges + timestamp fields support any retrieval mix

### 8.3 Adaptive Memory at the Database Level

The MemEvolve approach suggests that SurrealDB events and computed fields can implement *adaptive* memory behavior without application-level orchestration:

- **Auto-consolidation:** EVENT triggers merge episodic memories into patterns when cluster density exceeds thresholds
- **Adaptive decay:** Computed relevance scores incorporate access patterns, not just time
- **Self-pruning:** Low-relevance memories are automatically cleaned up
- **Architecture-aware routing:** Queries dynamically select retrieval strategy based on the active `memory_architecture` record

This pushes intelligence into the database layer, keeping the agent application focused on task execution rather than memory plumbing.

---

## 9. Open Questions and Future Directions

1. **Can SurrealDB events fully replace the outer evolutionary loop?** The inner loop (experience accumulation) maps cleanly to database operations. The outer loop (architecture diagnosis and redesign) currently requires LLM-based analysis — can database-level analytics provide sufficient signal for automated architecture evolution?

2. **Scalability of architectural search.** MemEvolve's design space is combinatorial. Can SurrealDB's query engine efficiently evaluate thousands of architecture variants in parallel, or does this require external orchestration?

3. **Real-time architecture switching.** Can an agent switch memory architectures mid-task based on SurrealDB-detected performance degradation, implementing a form of online meta-learning?

4. **Federated evolution.** Multiple agents could share architectural discoveries via SurrealDB's multi-tenancy — evolved architectures from one agent's domain transferred to another's, implementing the cross-task generalization that MemEvolve demonstrates.

5. **Integration with [[Long-Term Memory Patterns]] and [[Short-Term and Working Memory Patterns]].** The EURM framework could serve as the unifying abstraction layer above the specific SurrealDB patterns designed for short-term, working, and long-term memory.

---

## 10. References

- Zhang, G., Ren, H., Zhan, C., Zhou, Z., Wang, J., Zhu, H., Zhou, W., Yan, S. (2025). *MemEvolve: Meta-Evolution of Agent Memory Systems.* arXiv:2512.18746.
- Zhao, A., Huang, D., Xu, Q., et al. (2024). *ExpeL: LLM Agents are Experiential Learners.* AAAI 2024.
- Wang, G., Xie, Y., Jiang, Y., et al. (2023). *Voyager: An Open-Ended Embodied Agent with Large Language Models.* arXiv:2305.16291.
- Shinn, N., Labash, B., Gopinath, A. (2023). *Reflexion: An Autonomous Agent with Dynamic Memory and Self-Reflection.* arXiv:2303.11366.
- Xu, W., Liang, Z., Mei, K., et al. (2025). *A-Mem: Agentic Memory for LLM Agents.* arXiv:2502.12110.
- Zhang, G., et al. (2026). *MemSkill: Learning and Evolving Memory Skills for Self-Evolving Agents.* arXiv:2602.02474.
- Wei, Y., et al. (2025). *Evo-Memory: Benchmarking LLM Agent Test-time Learning with Self-Evolving Memory.* arXiv:2511.20857.
- Chhikara, P., et al. (2025). *Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory.* arXiv:2504.19413.
- Park, J.S., O'Brien, J.C., Cai, C.J., et al. (2023). *Generative Agents: Interactive Simulacra of Human Behavior.* UIST 2023.
- Zhang, Z., Bo, X., Ma, C., et al. (2024). *A Survey on the Memory Mechanism of Large Language Model Based Agents.* arXiv:2404.13501.
