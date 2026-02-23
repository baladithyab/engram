# Agentic Memory Frameworks Survey

> **Date:** 2026-02-23
> **Purpose:** Comprehensive survey of existing agentic memory frameworks, their storage patterns, retrieval mechanisms, and architectural trade-offs. Intended to inform the design of a SurrealDB-native agentic memory system.
> **Related:** [[SurrealDB Agentic Memory]] | [[SurrealDB Feature Mapping]]

---

## Table of Contents

- [[#Executive Summary]]
- [[#Framework Deep Dives]]
  - [[#1. Mem0]]
  - [[#2. Zep / Graphiti]]
  - [[#3. Letta (MemGPT)]]
  - [[#4. LangMem (LangChain)]]
  - [[#5. CrewAI Memory]]
  - [[#6. AutoGen / Microsoft Agent Framework]]
  - [[#7. Cognee]]
  - [[#8. Memary]]
  - [[#9. Graphlit]]
  - [[#10. ReMe (MemoryScope)]]
  - [[#11. MemEngine]]
  - [[#12. A-Mem]]
  - [[#13. Neo4j Agent Memory]]
- [[#Comprehensive Comparison Table]]
- [[#Cross-Framework Patterns]]
- [[#Gaps SurrealDB Could Fill]]
- [[#References]]

---

## Executive Summary

The agentic memory landscape as of early 2026 has converged around several recurring architectural patterns while remaining highly fragmented in implementation. No single framework dominates; instead, each targets a different slice of the problem space:

- **Hybrid storage** (vector + graph + relational/KV) is the emerging consensus architecture
- **Temporal awareness** is recognized as essential but rarely implemented well
- **Multi-agent memory sharing** remains an unsolved problem at scale
- **Consolidation and forgetting** are under-explored relative to storage and retrieval
- **Every framework requires multiple databases** --- a gap SurrealDB could uniquely fill

The survey covers 13 frameworks/platforms, from production-ready commercial offerings (Mem0 Cloud, Zep Cloud, Graphlit) to research-oriented libraries (A-Mem, MemEngine) and framework-integrated solutions (CrewAI, LangMem, AutoGen).

---

## Framework Deep Dives

### 1. Mem0

**Full Name:** Mem0 (formerly separate from MemGPT; Y Combinator S24)
**Repository:** [mem0ai/mem0](https://github.com/mem0ai/mem0) --- 36k+ stars
**Paper:** "Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory" (arXiv, April 2025)
**Deployment:** Open-source self-hosted + Mem0 Cloud (managed)

#### Architecture

Mem0 uses a **hybrid data store** approach combining three storage types:

| Store Type | Purpose | Backends Supported |
|---|---|---|
| **Vector DB** | Semantic/episodic memory retrieval | Qdrant, ChromaDB, PGVector, Milvus, Pinecone, FAISS, Weaviate, Redis, Elasticsearch, Supabase, MongoDB, Azure AI Search, Upstash, Vertex AI |
| **Graph DB** | Relationship/entity memory | Neo4j (optional, "Graph Memory" feature) |
| **Key-Value Store** | Facts, stable knowledge | Redis / Valkey |

The core insight is that **different memory types belong in different storage engines**: relationships go in a graph database, semantic/episodic memories in vector stores, and stable facts in key-value stores.

#### Memory Types Supported

- **Episodic Memory:** Conversation-specific experiences stored as vector embeddings
- **Semantic Memory:** Extracted facts and knowledge (e.g., "User prefers dark mode")
- **Procedural Memory:** Learned patterns and workflows
- **Associative Memory:** Cross-referenced related memories via graph relationships
- **Hierarchical Scoping:** Memories organized at user, session, and agent levels

#### Retrieval Mechanisms

- Vector similarity search (cosine similarity, top-k)
- Graph traversal for entity-centric queries (Mem0g variant)
- Semantic triplet matching (dense vector encoding of relationship triplets)
- Metadata filtering (logical AND/OR, date ranges, categories)
- Hybrid retrieval combining vector + graph results

#### Consolidation / Forgetting

- **Automatic deduplication filtering** to prevent memory bloat
- **Decay mechanisms** that remove irrelevant information over time
- **Conflict resolution:** LLM-driven evaluation determines when new information supersedes old (the "this supersedes that" problem)
- **Memory compression:** Chat history compressed into optimized memory representations (claims up to 80% token reduction)

#### Multi-Agent Support

- Hierarchical memory at user, session, and agent levels
- Agents can share a user-level memory store while maintaining private agent-level memories
- Framework-agnostic: integrates with LangChain, CrewAI, LlamaIndex, OpenAI, and custom solutions
- Python, JavaScript, and REST API SDKs

#### Strengths

- Broadest vector DB support of any framework (15+ backends)
- Simple API: `add()` and `search()` cover most use cases
- Production-proven with managed cloud option
- Active research with published benchmarks (outperforms MemGPT on LOCOMO)
- Dual open-source / managed deployment model

#### Weaknesses

- Graph memory requires additional configuration beyond basic setup
- Self-hosted deployments need infrastructure management for multiple databases
- Memory extraction quality depends heavily on the underlying LLM
- No built-in temporal reasoning (unlike Graphiti)
- Advanced features (custom categories, filtering rules) add complexity

---

### 2. Zep / Graphiti

**Full Name:** Zep (context engineering platform) + Graphiti (open-source knowledge graph engine)
**Repository:** [getzep/graphiti](https://github.com/getzep/graphiti)
**Paper:** "Zep: A Temporal Knowledge Graph Architecture for Agent Memory" (arXiv, January 2025)
**Deployment:** Zep Cloud (managed) + Graphiti (self-hosted open-source)

#### Architecture

Zep is built on Graphiti, a **temporally-aware knowledge graph engine**. The architecture is graph-native with hybrid retrieval:

| Component | Technology | Role |
|---|---|---|
| **Graph DB** | Neo4j (primary), FalkorDB, Kuzu, Amazon Neptune | Entities, relationships, communities |
| **Vector Index** | Neo4j Lucene (built-in) | Semantic similarity over facts/entities |
| **Full-text Index** | Neo4j BM25 (built-in) | Keyword search over facts/entities |
| **Episode Store** | Graph nodes | Raw data ingestion units (messages, text, JSON) |

The fundamental data model is a **bi-temporal knowledge graph**:
- **Event time:** When a fact was true in the real world
- **Ingestion time:** When the system learned about the fact
- Facts have `valid_at` and `invalid_at` timestamps, enabling historical queries

#### Key Concepts

- **Episodes:** Raw data units (messages, text, JSON) that feed graph construction
- **Entity Nodes:** People, concepts, objects extracted from episodes
- **Relationship Edges:** Typed connections with temporal validity periods
- **Communities:** Clusters of related entities (parallel to LightRAG's high-level search)
- **Entity Resolution:** Automatic deduplication and merging of entities across episodes

#### Retrieval Mechanisms

Three search functions combined via reranking:

1. **Cosine semantic similarity** (vector search over facts)
2. **BM25 full-text search** (keyword matching)
3. **Breadth-first graph traversal** (structural exploration)

P95 retrieval latency: ~300ms. No LLM calls during retrieval (pure index-based).

#### Consolidation / Forgetting

- **Temporal invalidation:** Facts automatically marked invalid when contradicted by newer information
- **Non-lossy updates:** Old facts are preserved with `invalid_at` timestamps, not deleted
- **Community evolution:** Communities restructure as entities and relationships change
- **Incremental processing:** New data integrated without full graph recomputation

#### Multi-Agent Support

- Session/user/agent scoping via `group_id` partitioning
- Multiple graphs can coexist within the same Graphiti instance
- SDKs: Python, TypeScript, Go
- MCP server available for direct integration with Claude, Cursor, etc.

#### Strengths

- **Temporal reasoning** is a first-class feature (unique among frameworks)
- State-of-the-art benchmark results (outperforms MemGPT on DMR benchmark)
- No LLM calls at retrieval time = fast, deterministic, cost-effective
- Bi-temporal model enables "what was true at time T?" queries
- Graph-native design captures relationships that vector stores miss

#### Weaknesses

- Requires Neo4j (or compatible graph DB) infrastructure
- Graph construction requires LLM calls (entity extraction, resolution)
- Performance depends on LLM quality for ingestion pipeline
- Best with models supporting Structured Output (OpenAI, Gemini)
- Self-hosted Graphiti requires building your own user/session management

---

### 3. Letta (MemGPT)

**Full Name:** Letta (framework) implementing the MemGPT (agent design pattern)
**Repository:** [letta-ai/letta](https://github.com/letta-ai/letta) --- 19k+ stars
**Paper:** "MemGPT: Towards LLMs as Operating Systems" (UC Berkeley, October 2023)
**Deployment:** Self-hosted server + Letta Cloud

#### Architecture

Letta treats memory as an **operating system problem**. The core metaphor is:

| OS Concept | MemGPT/Letta Equivalent |
|---|---|
| RAM / Main Memory | **Main Context** (what's in the LLM's context window) |
| Disk Storage | **External Context** (databases, archives) |
| Virtual Memory | **Virtual Context** (illusion of unlimited memory via paging) |
| Page Faults / Interrupts | Memory retrieval triggers when needed info is not in context |

#### Memory Tiers

1. **Core Memory (Memory Blocks):** Always visible in the agent's context window. High-priority, persistent information (user preferences, persona traits). Capped at configurable character limits.

2. **Recall Memory:** Conversation history persistence. Evicted messages are recursively summarized and stored. Full history searchable via conversation tools.

3. **Archival Memory:** Long-term storage for large volumes of data. Searchable external knowledge base. Functions as the agent's "hard drive."

4. **Working Context:** Dynamic compilation of system instructions, core memory blocks, tool rules, chat history, and memory statistics into the prompt.

#### Storage Backends

| Store | Default | Purpose |
|---|---|---|
| Metadata | SQLite | Agent configuration, tool definitions |
| Archival | SQLite | Long-term searchable archive |
| Recall | SQLite | Conversation history |
| Persistence Manager | In-memory or DB-backed | Runtime state |

As of late 2025, Letta introduced **Context Repositories**: agent context stored as local files in git repositories. Agents commit and push context updates; conflict resolution happens via git. This enables multi-agent memory coordination.

#### Retrieval Mechanisms

- **Self-directed:** The agent itself decides when and what to retrieve via function calls
- **Tool-based:** Memory operations exposed as tools (`core_memory_replace`, `archival_memory_search`, `conversation_search`)
- **Inner monologue:** Agent maintains private reasoning about what to remember/forget

#### Consolidation / Forgetting

- **Cognitive triage:** LLM evaluates future value of information fragments
- **Recursive summarization:** Evicted messages compressed into summaries
- **Priority-based retention:** User preferences and core facts retained; transient elements summarized or deleted
- **Self-editing:** Agent actively manages its own memory contents

#### Multi-Agent Support

- Agents persist as stateful services with unique identities
- **Conversations API** (Jan 2026): Shared memory across concurrent agent experiences
- Context Repositories enable git-based multi-agent coordination
- Model-agnostic: works with any LLM provider

#### Strengths

- **White-box memory:** Developers can inspect and modify agent memory state at any point
- Agent autonomy over memory (self-editing is a unique capability)
- Stateful by design --- agents survive restarts and maintain identity
- Rich conceptual framework (OS metaphor is well-developed)
- Context Repositories are a novel approach to multi-agent coordination

#### Weaknesses

- Full framework adoption required (not a standalone memory layer)
- Tool-based memory editing adds orchestration complexity
- Agents must explicitly manage memory through tool calls (no automatic extraction)
- SQLite defaults limit production scalability
- Runtime architecture couples memory operations to Letta's execution model

---

### 4. LangMem (LangChain)

**Full Name:** LangMem SDK --- Long-term memory for LangGraph agents
**Repository:** [langchain-ai/langmem](https://github.com/langchain-ai/langmem)
**Deployment:** Python SDK, integrates with LangGraph Platform

#### Architecture

LangMem is LangChain's answer to persistent agent memory. It provides **primitives** (not a platform) for memory operations:

1. **Core Memory API:** Storage-agnostic interface (works with any backend via LangGraph's `BaseStore`)
2. **Memory Tools:** Agent-accessible tools for recording and searching memories during conversations ("hot path")
3. **Background Memory Manager:** Async service that extracts, consolidates, and enriches memories outside the conversation flow ("cold path")

#### Storage Backends

LangMem delegates storage to LangGraph's `BaseStore` interface:

| Backend | Notes |
|---|---|
| In-memory | Development/testing |
| PostgreSQL | Via LangGraph Platform |
| MongoDB | New MongoDB Store integration (late 2025) |
| Redis | Via custom BaseStore implementation |
| Any custom store | Implement `BaseStore` interface |

Memory stored as JSON documents organized by **namespaces** (similar to folders) and **keys** (like file names). Hierarchical organization supports user/org/application scoping.

#### Memory Types Supported

- **Semantic Memory:** Facts, user preferences, domain knowledge
- **Episodic Memory:** Event records, interaction histories
- **Procedural Memory:** Learned procedures, agent behavior patterns
- **Profile Memory:** User/entity profiles built from interactions

#### Retrieval Mechanisms

- Vector similarity search via chosen embedding model
- Namespace-based memory organization and filtering
- Filter by memory type (semantic, episodic, procedural)
- Custom retrieval logic through `BaseStore` interface
- Cross-namespace searching via content filters

#### Consolidation / Forgetting

- **Memory consolidation:** Uses `trustcall` for type-safe memory merging and invalidation
- **Background extraction:** Async processing extracts memories without blocking conversations
- **Prompt refinement:** Memories can modify agent system prompts over time
- **Structured updates:** Type-safe schema enforcement during memory operations

#### Multi-Agent Support

- Namespace-based isolation between agents
- Shared namespaces for cross-agent memory
- Native LangGraph Platform deployment with built-in persistence
- Works with LangGraph's multi-agent orchestration patterns

#### Strengths

- Deep integration with LangChain/LangGraph ecosystem
- Storage-agnostic (bring your own backend)
- Dual-path architecture (hot path tools + cold path background processing)
- Lightweight SDK, not a full framework
- Voyage AI embeddings available for cutting-edge retrieval

#### Weaknesses

- Requires LangChain/LangGraph ecosystem buy-in for full benefits
- No built-in graph or relational storage
- Developer must implement retrieval strategy (more work, more flexibility)
- No temporal reasoning capabilities
- No managed memory infrastructure (you manage the storage)

---

### 5. CrewAI Memory

**Full Name:** CrewAI built-in memory system
**Documentation:** [docs.crewai.com/concepts/memory](https://docs.crewai.com/en/concepts/memory)
**Deployment:** Part of CrewAI framework (Python package)

#### Architecture

CrewAI provides an integrated memory system activated with `memory=True` on a Crew object. Memory is **agent-centric** with four types:

| Memory Type | Storage Backend | Persistence | Purpose |
|---|---|---|---|
| **Short-Term Memory** | ChromaDB (RAG) | Session only | Current task context, recent actions |
| **Long-Term Memory** | SQLite (`long_term_memory_storage.db`) | Cross-session | Task results, accumulated knowledge |
| **Entity Memory** | ChromaDB (RAG) | Session only | People, organizations, concepts |
| **User Memory** | ChromaDB (RAG) | Cross-session | User-specific preferences, personalization |

Storage locations follow OS-specific paths via the `appdirs` package (e.g., `~/.local/share/CrewAI/{project_name}/`).

#### Retrieval Mechanisms

- RAG-based semantic search for short-term and entity memory
- Hybrid score: `score(m) = (cosine_similarity) * exp(-lambda * delta_t)` (embedding similarity weighted by recency decay)
- SQLite queries for long-term memory
- Automatic context injection: before each task, agents check memory for relevant information

#### Consolidation / Forgetting

- Short-term and entity memory cleared after workflow completion
- Long-term memory persists indefinitely (manual reset via CLI or API)
- No automatic consolidation or forgetting beyond session boundaries
- Results automatically saved to long-term memory after task completion

#### Multi-Agent Support

- Memory enabled per-crew (all agents in a crew share the memory system)
- Agents within a crew can access each other's short-term context
- Hierarchical orchestration: manager agents can delegate with memory context
- Custom embedder configuration (supports Mem0 as a backend via integration)

#### Strengths

- Zero-configuration: `memory=True` enables everything
- Tight integration with CrewAI's task/agent model
- Automatic memory injection into task context
- Supports Mem0 as a pluggable backend for advanced use cases
- Simple mental model (four types, clear purposes)

#### Weaknesses

- ChromaDB is not production-grade for large-scale deployments
- No graph-based memory or relationship tracking
- Entity memory is session-only (lost between runs)
- Limited customization of memory strategies
- No temporal reasoning
- Tightly coupled to CrewAI framework

---

### 6. AutoGen / Microsoft Agent Framework

**Full Name:** AutoGen (v0.4, January 2025) --> Microsoft Agent Framework (GA October 2025)
**Repository:** [microsoft/autogen](https://github.com/microsoft/autogen)
**Deployment:** Open-source SDK + Azure AI Foundry Agent Service

#### Architecture

AutoGen v0.4 adopted an **actor model** for multi-agent orchestration with event-driven, asynchronous messaging. Memory is a **pluggable component** rather than a built-in subsystem:

| Aspect | AutoGen (standalone) | Microsoft Agent Framework |
|---|---|---|
| **State Management** | In-memory during runtime; lost on process end | Persistent by default via Azure services |
| **Memory Storage** | Pluggable (Redis, Pinecone, Azure AI Search) | Azure Cosmos DB, Azure AI Search, Fabric |
| **Observability** | OpenTelemetry support | Application Insights, full telemetry |
| **Multi-agent** | Asynchronous message passing | Distributed agents with independent lifecycles |

#### Memory Approach

AutoGen treats memory as a **tool** the agent can call, not a core architectural primitive:

- **Conversation memory:** Message history maintained in runtime context
- **Pluggable memory backends:** Redis, Pinecone, Azure AI Search, custom stores
- **Semantic Kernel integration:** After framework unification, gains SK's memory capabilities
- **No built-in memory taxonomy:** Developers define their own memory types and strategies

The Microsoft Agent Framework (post-unification) adds:
- Native connectors to Microsoft Graph, SharePoint, Fabric
- Persistent storage via Azure Cosmos DB
- Telemetry and monitoring via Application Insights
- Agent lifecycle management with scheduling and scaling

#### Retrieval Mechanisms

- Depends on chosen backend (vector similarity if using Pinecone/Azure AI Search)
- Native Microsoft ecosystem integration (Cognitive Search, Graph API)
- Custom retrieval logic via tool definitions

#### Consolidation / Forgetting

- No built-in consolidation or forgetting strategies
- Developers must implement their own memory management
- Azure services provide TTL and lifecycle management at the infrastructure level

#### Multi-Agent Support

- First-class multi-agent orchestration (core design goal)
- Agents communicate via asynchronous messages
- Each agent has independent lifecycle, memory, and resource allocation
- Distributed runtime with scheduling, persistence, monitoring, and scaling
- A2A (Agent-to-Agent) and MCP protocol support

#### Strengths

- Enterprise-grade when deployed on Azure
- Deep Microsoft ecosystem integration (Graph, Fabric, SharePoint)
- Actor model enables true distributed multi-agent systems
- Modular: plug in any memory backend
- Strong observability and debugging tools

#### Weaknesses

- Memory is not a first-class concern (developer must build it)
- Vanilla AutoGen loses state on process termination
- Optimal configuration requires careful architecture planning
- Best experience requires Azure investment
- AutoGen and Semantic Kernel now in maintenance mode (future = unified framework)

---

### 7. Cognee

**Full Name:** Cognee --- Knowledge Engine for AI Agent Memory
**Repository:** [topoteretes/cognee](https://github.com/topoteretes/cognee) --- 12.4k stars
**Deployment:** Open-source Python SDK + managed option

#### Architecture

Cognee uses a **three-store architecture** explicitly designed so that each store handles what it does best:

| Store | Default Backend | Alternatives | Role |
|---|---|---|---|
| **Relational** | SQLite | PostgreSQL | Document metadata, chunk provenance, pipeline state |
| **Vector** | LanceDB | Qdrant, PGVector, Weaviate | Semantic similarity search over embeddings |
| **Graph** | NetworkX | Neo4j, FalkorDB | Entity-relationship knowledge graph |

The data pipeline follows an **ECL (Extract-Cognify-Load)** model:
1. **Extract:** Parse 30+ data types (text, audio, images, PDFs)
2. **Cognify:** Generate knowledge graph with entity extraction, relationship mapping, and ontology enforcement
3. **Load:** Write to vector + graph stores simultaneously

#### Memory Types Supported

- **Semantic Memory:** Facts and knowledge stored as graph triplets (subject-relation-object)
- **Episodic Memory:** Interaction records linked to source documents
- **Procedural Memory:** Domain rules captured via RDF-based ontologies
- **Self-Improving Memory:** Memify pipeline enhances memory in the background (cleaning old data, adding associations, weighting frequently accessed memories)

#### Retrieval Mechanisms

- **Semantic search:** Vector similarity over embeddings (via LanceDB/Qdrant/etc.)
- **Structural search:** Cypher queries directly against the knowledge graph
- **Hybrid search:** Vector + graph combined for contextually rich, structurally precise results
- **Natural language queries:** Reasoning layer hides Cypher complexity

#### Consolidation / Forgetting

- **Memify Pipeline:** Background process that cleans old data, adds associations, weights memories
- **Self-Improving Memory Logic:** Feedback incorporated into the memory itself
- **Time Awareness:** Temporal context capture and reconciliation
- **Provenance tracking:** All inferred information linked back to original source documents

#### Multi-Agent Support

- Per-workspace isolation (dedicated stores per user/workspace/test)
- Pipeline-based architecture supports parallel processing
- Integration with agent frameworks (LangChain, CrewAI, etc.)
- Composable pipelines allow different agents to use different memory configurations

#### Strengths

- Strict provenance: inferred information always traceable to source documents
- Ontology-driven reasoning (RDF-based) for semantically meaningful relationships
- Self-improving memory that gets smarter over time
- Per-workspace isolation model is clean and production-friendly
- Accuracy approaching 90% vs. RAG's 60% (per Cognee benchmarks)

#### Weaknesses

- Requires multiple databases for full functionality
- Graph construction is LLM-dependent
- More complex setup than simpler vector-only solutions
- Smaller community than Mem0 or Letta
- Documentation still maturing

---

### 8. Memary

**Full Name:** Memary --- Open Source Memory Layer for Autonomous Agents
**Repository:** [kingjulio8238/Memary](https://github.com/kingjulio8238/Memary) --- 2.6k stars
**Deployment:** Open-source Python library

#### Architecture

Memary emulates human memory with a focus on **knowledge graphs** as the primary storage:

| Component | Technology | Role |
|---|---|---|
| **Knowledge Graph** | Neo4j or FalkorDB | Entity tracking, relationship memory, preferences |
| **Routing Agent** | LLM-powered | Decides which tools and memory to use |
| **Memory Module** | Custom | Auto-generated memory from interactions |

#### Key Features

- **Auto-generated Memory:** Conversations automatically extracted into knowledge graph entries
- **Recursive Retrieval:** Subgraph construction based on key entities minimizes query times
- **Multi-Agent Framework:** Unique, dedicated graphs per agent for individualized memory management
- **Benchmarking Playground:** Compare different memory configurations for specific tasks

#### Retrieval Mechanisms

- Graph traversal for entity and relationship queries
- Subgraph extraction for focused retrieval
- Integration with local models via Ollama

#### Strengths

- Knowledge graph-first approach
- Per-agent graph isolation
- Easy integration onto existing agents
- Supports local model deployment (privacy-friendly)

#### Weaknesses

- Smaller community and less mature than alternatives
- Limited to graph-based memory (no vector search)
- Requires Neo4j or FalkorDB infrastructure
- Python version constrained (<= 3.11.9)
- No temporal reasoning or memory consolidation

---

### 9. Graphlit

**Full Name:** Graphlit --- Semantic Memory Platform for AI Agents
**Website:** [graphlit.com](https://www.graphlit.com/)
**Deployment:** Managed SaaS platform (cloud-native)

#### Architecture

Graphlit is a **fully managed semantic memory platform** emphasizing multimodal content:

| Capability | Implementation |
|---|---|
| **Ingestion** | 30+ connectors (Slack, GitHub, Gmail, Notion, RSS, etc.) |
| **Content Types** | Documents, audio (with transcription + diarization), video, images (OCR), conversations |
| **Entity Extraction** | Automatic using Schema.org standards |
| **Knowledge Graph** | Per-user graphs with entity linking and relationship tracking |
| **Search** | Hybrid: vector + keyword (BM25) + graph traversal |
| **Storage** | Managed infrastructure (no databases to operate) |

#### Memory Model

- Per-user knowledge graphs with entity isolation
- Semantic memory across all content types (multimodal)
- Temporal context preserved from ingestion
- Named collections for grouping related content
- Workflow-based automation pipelines

#### Retrieval Mechanisms

- Vector semantic search (conceptual similarity)
- Keyword search with BM25 ranking
- Graph-aware context expansion (entity relationship traversal)
- Entity filters, temporal filters, metadata filters
- Natural language or date range queries

#### Strengths

- True multimodal support (audio, video, images, documents)
- 30+ data connectors with automated pipelines
- Managed infrastructure (no ops burden)
- Schema.org-based entity extraction is standards-compliant
- Per-user isolation for multi-tenant applications

#### Weaknesses

- SaaS-only (no self-hosted option)
- Vendor lock-in concerns
- Less control over graph modeling than Cognee or Graphiti
- No open-source component
- Primarily suited for content-heavy use cases rather than conversation memory

---

### 10. ReMe (MemoryScope)

**Full Name:** ReMe --- Memory Management Kit for Agents (formerly MemoryScope)
**Repository:** [agentscope-ai/ReMe](https://github.com/agentscope-ai/ReMe) --- ~1k stars
**Paper:** "Remember Me, Refine Me: A Dynamic Procedural Memory Framework for Experience-Driven Agent Evolution" (December 2025)

#### Architecture

ReMe provides a modular memory management kit with a structured taxonomy:

```
Agent Memory = Long-Term Memory + Short-Term Memory
             = (Personal + Task + Tool) Memory + (Working Memory)
```

| Memory Type | Purpose |
|---|---|
| **Personal Memory** | User preferences, context adaptation |
| **Task Memory** | Experience from similar tasks, performance improvement |
| **Tool Memory** | Tool selection and parameter optimization from history |
| **Working Memory** | Short-term context for long-running agents |

#### Key Features

- Unified memory capabilities across users, tasks, and agents
- Memory extraction, reuse, and sharing
- Dynamic procedural memory for experience-driven agent evolution
- Modular design for plug-and-play integration

#### Strengths

- Clean conceptual taxonomy of memory types
- Focus on procedural/experiential memory (underserved niche)
- Tool memory optimization is a unique capability
- Actively maintained with regular releases

#### Weaknesses

- Relatively small community
- Less documentation than major frameworks
- Storage backend details less well-documented
- Newer project, production maturity unclear

---

### 11. MemEngine

**Full Name:** MemEngine --- Unified and Modular Library for Developing Advanced Memory
**Paper:** "MemEngine: A Unified and Modular Library for Developing Advanced Memory of LLM-based Agents" (WWW Companion 2025)

#### Architecture

MemEngine is a **research-focused meta-framework** that unifies existing memory models:

| Level | Components | Examples |
|---|---|---|
| **Memory Functions** (lowest) | Basic operations | Encoder, Retrieval, Summarizer, Judge |
| **Memory Operations** (middle) | Composed operations | StoreOp, RecallOp, ManageOp, OptimizeOp |
| **Memory Models** (highest) | Full implementations | MemoryBank, FullUpMemory, LTMemory, GAMemory |

Configuration via YAML/JSON files, supporting reproducibility and easy tuning. All levels are modularized with higher-level modules reusing lower-level ones.

#### Strengths

- Unified implementation of many published memory models
- Facilitates systematic benchmarking and comparison
- Extensible plugin architecture
- Valuable for research and ablation studies

#### Weaknesses

- Research-oriented, not production-ready
- Meta-framework adds abstraction overhead
- Requires understanding of underlying memory models
- Not designed for deployment

---

### 12. A-Mem

**Full Name:** A-Mem --- Agentic Memory for LLM Agents
**Paper:** "A-Mem: Agentic Memory for LLM Agents" (NeurIPS 2025)

#### Architecture

A-Mem implements a **self-organizing memory system** inspired by the Zettelkasten method:

- Memories organized as interconnected notes with dynamic indexing and linking
- When a new memory is added, the system generates connections to existing memories
- Memory network evolves organically as the agent learns
- Focus on flexible organization rather than rigid taxonomies

#### Key Innovation

The Zettelkasten-inspired approach creates **interconnected knowledge networks** through:
1. Dynamic indexing of new memories
2. Automatic linking to related existing memories
3. Memory evolution as connections strengthen or weaken
4. Emergent structure rather than predefined categories

#### Benchmark Performance

On LOCOMO dataset (with gpt-4o-mini evaluation):
- Outperforms MemGPT, MemoryBank, and LoCoMo on most metrics
- Particularly strong on temporal and open-domain queries

#### Strengths

- Novel organizational approach (Zettelkasten for AI)
- Strong benchmark performance
- Adapts across diverse task types
- Self-organizing reduces need for predefined schemas

#### Weaknesses

- Research prototype, not production-ready
- Limited storage backend documentation
- No multi-agent support
- Organizational overhead for simple use cases

---

### 13. Neo4j Agent Memory

**Full Name:** neo4j-agent-memory --- Neo4j Labs project
**Repository:** neo4j-labs/neo4j-agent-memory
**Deployment:** Open-source Python library

#### Architecture

Three-layer memory architecture, all stored in Neo4j:

| Layer | Purpose |
|---|---|
| **Short-term Memory** | Conversation history and session state |
| **Long-term Memory** | Entities, relationships, learned preferences |
| **Reasoning Memory** | Decision traces, tool usage audits, provenance |

The unique contribution is **reasoning memory** --- audit trails explaining why agents made specific decisions.

#### Strengths

- All three memory types in a single graph database
- Reasoning memory enables explainability and debugging
- Integrates with LangChain, Pydantic AI, LlamaIndex, OpenAI Agents, CrewAI
- Provenance from question to answer
- Open-source with Neo4j backing

#### Weaknesses

- Neo4j dependency
- No vector search (relies on graph traversal)
- Newer project (early 2026)
- Limited to Neo4j's query patterns

---

## Comprehensive Comparison Table

| Framework | Storage Backend(s) | Memory Types | Retrieval | Temporal | Multi-Agent | Consolidation | Maturity |
|---|---|---|---|---|---|---|---|
| **Mem0** | Vector (15+ options) + Graph (Neo4j) + KV (Redis) | Episodic, Semantic, Procedural, Associative | Vector + Graph + Metadata filtering | Basic (decay) | User/Session/Agent scoping | Dedup, decay, conflict resolution | Production |
| **Zep/Graphiti** | Neo4j + built-in vector/BM25 | Episodic, Semantic, Community-based | Vector + BM25 + Graph traversal (hybrid) | First-class (bi-temporal) | Group-based partitioning | Temporal invalidation, non-lossy | Production |
| **Letta (MemGPT)** | SQLite (default), DB-backed persistence | Core, Recall, Archival, Working | Self-directed tool calls | None built-in | Context Repositories (git-based) | Cognitive triage, recursive summarization | Production |
| **LangMem** | Any (BaseStore: Postgres, MongoDB, Redis, custom) | Semantic, Episodic, Procedural, Profile | Vector similarity + namespace filtering | None | Namespace-based isolation | trustcall merging, background extraction | Production |
| **CrewAI** | ChromaDB (RAG) + SQLite (LTM) | Short-term, Long-term, Entity, User | RAG + recency-weighted scoring | None | Per-crew shared memory | Session clearing only | Framework-integrated |
| **AutoGen/MS Agent** | Pluggable (Redis, Pinecone, Azure AI Search, Cosmos DB) | Developer-defined | Backend-dependent | None | First-class (actor model) | Developer-implemented | Enterprise |
| **Cognee** | Relational (SQLite/Postgres) + Vector (LanceDB/Qdrant) + Graph (NetworkX/Neo4j) | Semantic, Episodic, Procedural, Self-improving | Vector + Graph + Hybrid | Partial (Memify) | Per-workspace isolation | Memify pipeline, self-improving | Growing |
| **Memary** | Graph (Neo4j/FalkorDB) | Entity, Relationship, Preference | Graph traversal, subgraph extraction | None | Per-agent graphs | None | Early |
| **Graphlit** | Managed (vector + graph + connectors) | Semantic, Temporal, Entity-based | Vector + BM25 + Graph | Partial (ingestion time) | Per-user graphs | Managed lifecycle | Commercial |
| **ReMe** | Configurable | Personal, Task, Tool, Working | Configurable | None documented | Memory sharing across agents | Dynamic procedural evolution | Early |
| **MemEngine** | Meta (wraps any) | Implements published models | Configurable per model | Model-dependent | Not a focus | Model-dependent | Research |
| **A-Mem** | Zettelkasten-inspired network | Self-organizing | Dynamic index + linking | None | None | Emergent pruning | Research |
| **Neo4j Agent Memory** | Neo4j | Short-term, Long-term, Reasoning | Graph traversal | None | Framework integrations | None documented | Early |

---

## Cross-Framework Patterns

### Pattern 1: Hybrid Storage is the Consensus

Nearly every production framework has converged on using **multiple storage engines**:

- **Vector store** for semantic similarity search
- **Graph store** for entity relationships and structural queries
- **Relational/KV store** for metadata, provenance, and fast lookups

This creates operational complexity --- deploying an agent memory system means managing 2-3 databases. **SurrealDB's multi-model capability (document + graph + relations in one engine) directly addresses this pain point.**

### Pattern 2: Memory Taxonomy is Converging

Despite different naming, most frameworks implement variations of:

| Canonical Type | Cognitive Analogy | Common Implementations |
|---|---|---|
| **Working Memory** | "What I'm thinking about now" | Context window, session state, short-term buffers |
| **Episodic Memory** | "What happened" | Conversation logs, interaction records, event sequences |
| **Semantic Memory** | "What I know" | Facts, preferences, domain knowledge, entity attributes |
| **Procedural Memory** | "How to do things" | Learned workflows, tool usage patterns, behavioral rules |

The December 2025 survey "Memory in the Age of AI Agents" proposes that short-term and long-term memory are not separate storage types but **emergent phenomena** from the temporal patterns of how an agent uses Formation, Evolution, and Retrieval (FER) operations. Fast FER cycles = working memory. Slow FER cycles = long-term memory. This reframing suggests the storage should support **variable-speed memory operations** rather than hard-coded tiers.

### Pattern 3: Retrieval is Moving to Hybrid

Pure vector search is insufficient. The trajectory:

1. **Vector-only** (2023): Cosine similarity over embeddings
2. **Vector + Keyword** (2024): BM25 added for exact matching
3. **Vector + Keyword + Graph** (2025): Graph traversal for structural context
4. **Vector + Keyword + Graph + Temporal** (2025-26): Time-aware filtering

**SurrealDB supports full-text search, vector search (planned/emerging), and graph traversal natively**, making it well-positioned for hybrid retrieval.

### Pattern 4: Temporal Reasoning is Rare but Critical

Only Zep/Graphiti implements true bi-temporal reasoning. Most frameworks treat memory as a flat store with timestamps at best. Yet temporal queries are essential for production agents:

- "What did the user prefer *last month*?"
- "What changed *since our last conversation*?"
- "What was the project status *on January 15th*?"

**SurrealDB's record versioning, change feeds, and temporal queries could provide temporal reasoning capabilities that most frameworks lack.**

### Pattern 5: Consolidation is Under-explored

Memory consolidation (merging, summarizing, forgetting) receives far less attention than storage and retrieval:

| Strategy | Frameworks Using It |
|---|---|
| Deduplication | Mem0 |
| Temporal invalidation | Zep/Graphiti |
| Recency decay | CrewAI, Mem0 |
| LLM-driven summarization | Letta |
| Self-organizing evolution | A-Mem, Cognee (Memify) |
| Ebbinghaus forgetting curve | MemoryBank (referenced in surveys) |
| No consolidation | Most others |

This is a significant gap. **SurrealDB's LIVE queries and event system could enable real-time consolidation triggers** --- e.g., automatically merging memories when similarity exceeds a threshold, or decaying access weights over time via scheduled functions.

### Pattern 6: Multi-Agent Memory Coordination is Immature

Most frameworks handle multi-agent memory through simple isolation (namespaces, separate stores). Genuine coordination patterns are rare:

- **Letta's Context Repositories** (git-based) are the most innovative approach
- **Mem0's hierarchical scoping** (user > session > agent) is practical but limited
- **AutoGen's actor model** enables message passing but not shared memory

**SurrealDB's real-time LIVE queries, permission system (record-level access control), and multi-tenancy could enable sophisticated agent-to-agent memory sharing with proper isolation.**

### Pattern 7: The "Memory Layer" vs "Full Framework" Divide

Frameworks split into two camps:

| Memory Layer (pluggable) | Full Framework (all-in-one) |
|---|---|
| Mem0 | Letta |
| LangMem | CrewAI |
| Graphiti | AutoGen |
| Cognee | |
| Memary | |

Memory layers are more flexible but require more integration work. Full frameworks are easier to start with but create lock-in. **A SurrealDB-native memory system should aim to be a memory layer (pluggable into any framework) while providing enough built-in intelligence to reduce integration burden.**

---

## Gaps SurrealDB Could Fill

Based on this survey, the following gaps represent opportunities for a SurrealDB-native agentic memory system:

### Gap 1: Multi-Model Storage in One Engine

**Current state:** Every framework requires 2-3 separate databases (vector + graph + relational/KV).

**SurrealDB opportunity:** Single database handling documents (semantic memory), graph relations (entity memory), full-text search (keyword retrieval), and potentially vector search --- eliminating the operational complexity of multi-database deployments.

### Gap 2: Native Temporal Reasoning

**Current state:** Only Zep/Graphiti has bi-temporal support, and it's built on top of Neo4j (not native to the database).

**SurrealDB opportunity:** Record versioning, change feeds, and time-travel queries could provide **database-native temporal reasoning** without application-level timestamp management.

### Gap 3: Real-Time Memory Events

**Current state:** No framework offers real-time memory event streams. Consolidation is batch-only.

**SurrealDB opportunity:** LIVE queries could power **reactive memory consolidation** --- automatically triggering merges, decay, or alerts when memory state changes.

### Gap 4: Fine-Grained Access Control for Multi-Agent

**Current state:** Multi-agent memory isolation is namespace-based (coarse) or non-existent.

**SurrealDB opportunity:** Record-level permissions with DEFINE ACCESS could enable **per-memory, per-agent access control** --- Agent A can read but not write Agent B's memories; shared memories have explicit ACLs.

### Gap 5: Unified Query Language

**Current state:** Developers write different query syntaxes for vector search (Python API), graph traversal (Cypher/Gremlin), and metadata filtering (SQL/ORM). No single query language spans all memory types.

**SurrealDB opportunity:** SurrealQL could provide a **single query language** that spans document queries, graph traversal (`->` operator), full-text search, and filtering --- dramatically simplifying memory retrieval logic.

### Gap 6: Edge/Embedded Deployment

**Current state:** Most frameworks require cloud databases or heavy infrastructure. None targets edge/embedded scenarios.

**SurrealDB opportunity:** SurrealDB can run **embedded** (in-process), as a single binary, or distributed --- enabling agent memory that works offline, on edge devices, or in air-gapped environments.

### Gap 7: Schema Flexibility with Optional Enforcement

**Current state:** Frameworks either have rigid schemas (Graphiti's entity types) or no schema at all (Mem0's freeform).

**SurrealDB opportunity:** Optional schema enforcement with `DEFINE FIELD` allows starting schemaless and progressively adding constraints as memory patterns stabilize --- **schema evolution** that matches how agent memory naturally develops.

### Gap 8: Built-In Computed Fields and Constraints

**Current state:** Memory scoring (recency decay, access frequency, importance weighting) is always application-level code.

**SurrealDB opportunity:** Computed fields (`DEFINE FIELD score VALUE ...`) and events (`DEFINE EVENT`) could push **memory scoring into the database layer**, ensuring consistent scoring regardless of which agent or application queries the memory.

---

## References

### Papers

- Packer et al. (2023). "MemGPT: Towards LLMs as Operating Systems." arXiv:2310.08560
- Rasmussen et al. (2025). "Zep: A Temporal Knowledge Graph Architecture for Agent Memory." arXiv:2501.13956
- Dev & Taranjeet (2025). "Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory." arXiv:2504.19413
- Xu et al. (2025). "A-Mem: Agentic Memory for LLM Agents." arXiv:2502.12110 (NeurIPS 2025)
- Zhang et al. (2025). "MemEngine: A Unified and Modular Library for Developing Advanced Memory of LLM-based Agents." WWW Companion 2025
- Cao et al. (2025). "Remember Me, Refine Me: A Dynamic Procedural Memory Framework for Experience-Driven Agent Evolution." arXiv:2512.10696
- (2025). "Memory in the Age of AI Agents: A Survey." arXiv:2512.13564

### Repositories

- Mem0: https://github.com/mem0ai/mem0
- Graphiti: https://github.com/getzep/graphiti
- Letta: https://github.com/letta-ai/letta
- LangMem: https://github.com/langchain-ai/langmem
- Cognee: https://github.com/topoteretes/cognee
- Memary: https://github.com/kingjulio8238/Memary
- ReMe: https://github.com/agentscope-ai/ReMe
- Neo4j Agent Memory: https://github.com/neo4j-labs/neo4j-agent-memory
- AutoGen: https://github.com/microsoft/autogen

### Curated Lists

- Awesome Memory for Agents: https://github.com/TsinghuaC3I/Awesome-Memory-for-Agents
- Agent Memory Paper List: https://github.com/Shichun-Liu/Agent-Memory-Paper-List

### Key Blog Posts and Articles

- Graphlit Survey of AI Agent Memory Frameworks: https://www.graphlit.com/blog/survey-of-ai-agent-memory-frameworks
- Neo4j: "Meet Lenny's Memory: Building Context Graphs for AI Agents"
- Letta Blog: "RAG is not Agent Memory" (Feb 2025)
- The New Stack: "Memory for AI Agents: A New Paradigm of Context Engineering"
