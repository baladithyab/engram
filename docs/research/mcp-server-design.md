# MCP Server Design

> The MCP server is the primary interface between Claude Code and the SurrealDB memory backend. It wraps all database operations behind memory-specific tools, exposes resources for passive context retrieval, and handles connection lifecycle, embedding generation, and graceful degradation.

Related documents: [[Plugin Architecture]] | [[Hierarchical Memory Model]] | [[Hooks System Design]] | [[Multi-Deployment Architecture]] | [[Implementation Blueprint]]

---

## Table of Contents

- [[#Architecture Overview]]
- [[#MCP Tools — Core Memory]]
- [[#MCP Tools — Administrative]]
- [[#MCP Resources]]
- [[#Tool Schemas]]
- [[#Embedding Strategy]]
- [[#Connection Lifecycle]]
- [[#Error Handling and Graceful Degradation]]
- [[#Configuration and .mcp.json]]
- [[#Server Implementation Structure]]
- [[#Security Considerations]]

---

## Architecture Overview

```
Claude Code ←→ MCP Protocol (stdio) ←→ MCP Server (Node.js)
                                            │
                                   ┌────────┴────────┐
                                   │  SurrealDB       │
                                   │  Connection Pool  │
                                   └────────┬────────┘
                                            │
                              ┌─────────────┼─────────────┐
                              │             │             │
                         In-Memory      File-backed    Remote
                         (surrealkv)    (surrealkv)   (WebSocket)
```

**Key Design Decisions:**

1. **Single MCP server process** — one server handles all memory operations; no sidecar processes.
2. **Stdio transport** — Claude Code launches the server as a child process communicating over stdin/stdout per MCP spec.
3. **SurrealDB.js client** — uses the official `surrealdb` npm package which supports all connection modes (in-memory, file-backed, WebSocket to remote).
4. **Embedding generation inside the server** — avoids external dependencies; uses a lightweight local model bundled with the plugin.
5. **Stateless between requests** — the server does not cache memory state beyond what SurrealDB provides; each tool call is a fresh query.

---

## MCP Tools — Core Memory

### `store_memory`

Store a new memory with content, classification, and metadata. The server generates embeddings automatically.

**When it's called:** By hooks (post-tool, session end) or explicitly by Claude when it identifies something worth remembering.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `content` | string | yes | The memory content — observation, fact, procedure, etc. |
| `type` | enum | yes | `episodic` (events/interactions), `semantic` (facts/knowledge), `procedural` (how-to/patterns) |
| `scope` | enum | yes | `session`, `project`, `user` |
| `importance` | number | no | 0.0–1.0, defaults to 0.5. Influences recall ranking and consolidation priority. |
| `tags` | string[] | no | Freeform labels for organization |
| `source` | object | no | `{ tool?: string, file?: string, conversation_turn?: number }` — provenance tracking |
| `related_entities` | object[] | no | `[{ name: string, type: string, relationship: string }]` — for knowledge graph edges |
| `session_id` | string | no | Defaults to current session. Allows backdating to a specific session. |

**Returns:**
```json
{
  "memory_id": "memory:ulid",
  "embedding_generated": true,
  "graph_edges_created": 2,
  "scope": "project",
  "type": "semantic"
}
```

**Server-side behavior:**
1. Validate input against schema
2. Generate embedding vector from `content` using the configured embedding model
3. INSERT into `memory` table with all fields + auto-generated timestamps
4. If `related_entities` provided, upsert entity nodes and create RELATE edges in the knowledge graph
5. If `scope` is `session`, associate with current `session_id`
6. Return confirmation with generated ID

---

### `recall_memories`

Retrieve memories relevant to a query, with filtering and ranking.

**When it's called:** By hooks (pre-prompt injection) or explicitly by Claude when it needs context.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | yes | Natural language query for semantic search |
| `scope` | enum\|enum[] | no | Filter to `session`, `project`, `user`, or array of multiple. Defaults to all. |
| `type` | enum\|enum[] | no | Filter to `episodic`, `semantic`, `procedural`, or array. Defaults to all. |
| `strategy` | enum | no | `vector` (embedding similarity), `keyword` (full-text), `hybrid` (both + RRF), `graph` (entity traversal). Defaults to `hybrid`. |
| `limit` | number | no | Max results. Defaults to 10. |
| `min_importance` | number | no | Floor for importance score. Defaults to 0.0. |
| `tags` | string[] | no | Filter to memories with ANY of these tags |
| `time_range` | object | no | `{ after?: ISO8601, before?: ISO8601 }` — temporal filtering |
| `include_forgotten` | boolean | no | Include soft-deleted memories. Defaults to false. |

**Returns:**
```json
{
  "memories": [
    {
      "id": "memory:ulid",
      "content": "User prefers TypeScript over JavaScript for new projects",
      "type": "semantic",
      "scope": "user",
      "importance": 0.8,
      "relevance_score": 0.92,
      "tags": ["preferences", "languages"],
      "created_at": "2026-02-20T14:30:00Z",
      "access_count": 5,
      "source": { "conversation_turn": 12 }
    }
  ],
  "total_matched": 23,
  "strategy_used": "hybrid",
  "query_time_ms": 45
}
```

**Server-side behavior:**
1. Generate embedding vector from `query`
2. Execute search based on `strategy`:
   - **vector:** `SELECT ... WHERE embedding <|10|> $query_vec` (SurrealDB vector search)
   - **keyword:** `SELECT ... WHERE content @@ $query` (SurrealDB full-text index)
   - **hybrid:** Run both, merge results using Reciprocal Rank Fusion (RRF)
   - **graph:** Extract entities from query, traverse graph, return connected memories
3. Apply scope/type/tag/time/importance filters
4. Rank by composite score: `relevance * 0.6 + importance * 0.2 + recency * 0.2`
5. Update `last_accessed` and increment `access_count` on returned memories
6. Return sorted results up to `limit`

---

### `search_knowledge_graph`

Traverse the knowledge graph to discover entity relationships and connected memories.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entity` | string | no | Entity name to look up. If omitted, returns graph overview. |
| `relationship_type` | string | no | Filter edges by type (e.g., `uses`, `depends_on`, `authored_by`) |
| `direction` | enum | no | `outgoing`, `incoming`, `both`. Defaults to `both`. |
| `depth` | number | no | Max traversal hops. Defaults to 1, max 3. |
| `include_memories` | boolean | no | Attach memories linked to discovered entities. Defaults to true. |
| `limit` | number | no | Max entities returned. Defaults to 20. |

**Returns:**
```json
{
  "entities": [
    {
      "name": "AuthService",
      "type": "component",
      "relationships": [
        { "type": "depends_on", "target": "TokenValidator", "direction": "outgoing" },
        { "type": "used_by", "target": "APIGateway", "direction": "incoming" }
      ],
      "memory_count": 4
    }
  ],
  "memories": [ ... ],
  "graph_stats": {
    "entities_traversed": 8,
    "relationships_found": 12,
    "depth_reached": 2
  }
}
```

**Server-side behavior:**
1. If `entity` provided: `SELECT * FROM entity WHERE name = $entity`
2. Traverse via `SELECT ->relates_to->entity` (and reverse) up to `depth` hops using SurrealDB graph queries
3. Filter by `relationship_type` if specified
4. If `include_memories`: join back to `memory` table via `memory_entity` edge table
5. Return structured graph data

---

### `forget_memory`

Soft-delete a memory. The memory remains in the database but is excluded from recall by default.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `memory_id` | string | yes | The memory ID to forget |
| `reason` | string | no | Why this memory is being forgotten (for audit trail) |

**Returns:**
```json
{
  "memory_id": "memory:ulid",
  "status": "forgotten",
  "reason": "Outdated information — project moved to new framework"
}
```

**Server-side behavior:**
1. UPDATE memory SET `forgotten = true`, `forgotten_at = time::now()`, `forgotten_reason = $reason`
2. Do NOT delete — forgotten memories can be recalled with `include_forgotten: true`
3. Knowledge graph edges remain but are annotated as stale

---

### `update_memory`

Modify an existing memory's content, metadata, or importance.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `memory_id` | string | yes | The memory ID to update |
| `content` | string | no | New content (triggers re-embedding) |
| `importance` | number | no | New importance score |
| `tags` | object | no | `{ add?: string[], remove?: string[] }` |
| `metadata` | object | no | Arbitrary key-value pairs to merge |
| `related_entities` | object | no | `{ add?: EntityRef[], remove?: string[] }` |

**Returns:**
```json
{
  "memory_id": "memory:ulid",
  "updated_fields": ["content", "importance"],
  "re_embedded": true,
  "version": 3
}
```

**Server-side behavior:**
1. Fetch existing memory
2. If `content` changed: regenerate embedding vector
3. Apply updates; increment `version` counter
4. Store previous version in `memory_history` table (append-only audit log)
5. Update knowledge graph edges if `related_entities` changed

---

### `reflect_and_consolidate`

Trigger memory consolidation for the current session. This is the "reflection" step where the server analyzes session memories and produces consolidated insights.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `session_id` | string | no | Defaults to current session |
| `strategy` | enum | no | `summarize` (compress episodic→semantic), `extract_patterns` (find recurring themes), `full` (both). Defaults to `full`. |
| `dry_run` | boolean | no | If true, return what would be consolidated without writing. Defaults to false. |

**Returns:**
```json
{
  "consolidated_memories": [
    {
      "id": "memory:new_ulid",
      "content": "This project uses a microservices architecture with gRPC for inter-service communication",
      "type": "semantic",
      "derived_from": ["memory:a", "memory:b", "memory:c"],
      "scope": "project"
    }
  ],
  "patterns_detected": [
    {
      "pattern": "User frequently asks about error handling patterns",
      "frequency": 4,
      "suggested_scope": "user"
    }
  ],
  "session_stats": {
    "memories_analyzed": 15,
    "consolidated_into": 3,
    "patterns_found": 2
  }
}
```

**Server-side behavior:**
1. Retrieve all memories for the session, ordered by timestamp
2. Group by type and topic (using embedding clustering)
3. For `summarize`: identify clusters of related episodic memories, produce a single semantic memory summarizing each cluster, link via `derived_from`
4. For `extract_patterns`: analyze across sessions for recurring themes, produce procedural memories for detected patterns
5. Mark source episodic memories with `consolidated: true` (they still exist but are deprioritized in recall)
6. If `dry_run`: return the plan without writing

**Important:** This tool produces the *candidate* consolidated memories and returns them. Claude then decides which to keep, modify, or discard — the server does not autonomously write consolidated memories without Claude's involvement unless called with `dry_run: false`.

---

## MCP Tools — Administrative

### `get_memory_status`

Return connection health and memory statistics.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| (none) | | | |

**Returns:**
```json
{
  "connection": {
    "status": "connected",
    "mode": "file-backed",
    "path": "/Users/me/.claude/surrealdb-memory/data",
    "uptime_seconds": 3600,
    "version": "2.2.1"
  },
  "counts": {
    "total": 247,
    "by_scope": { "session": 12, "project": 185, "user": 50 },
    "by_type": { "episodic": 95, "semantic": 120, "procedural": 32 },
    "forgotten": 8,
    "entities": 64,
    "relationships": 112
  },
  "storage": {
    "database_size_bytes": 15728640,
    "embedding_dimensions": 384,
    "embedding_model": "all-MiniLM-L6-v2"
  },
  "current_session": {
    "session_id": "session:abc123",
    "memories_this_session": 12,
    "started_at": "2026-02-23T10:00:00Z"
  }
}
```

---

### `get_memory_context`

Assemble a pre-formatted context block for the current task. This is the primary tool used by hooks to inject relevant memory into Claude's context window.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `task_description` | string | no | What Claude is currently working on (for relevance ranking) |
| `files_in_context` | string[] | no | File paths currently open/referenced (for project memory filtering) |
| `max_tokens` | number | no | Budget for the context block. Defaults to 2000. |
| `sections` | string[] | no | Which sections to include: `preferences`, `project_context`, `session_history`, `relevant_procedures`. Defaults to all. |

**Returns:**
```json
{
  "context_block": "## Memory Context\n\n### User Preferences\n- Prefers TypeScript...\n\n### Project Knowledge\n- This service uses gRPC...\n\n### Recent Session\n- Earlier discussed auth flow...\n\n### Relevant Procedures\n- When writing tests, user prefers...",
  "memories_used": 8,
  "tokens_used": 1450,
  "truncated": false
}
```

**Server-side behavior:**
1. Run parallel recall queries for each section:
   - `preferences`: scope=user, type=semantic/procedural, high importance
   - `project_context`: scope=project, semantic search on `task_description` + `files_in_context`
   - `session_history`: scope=session, most recent episodic memories
   - `relevant_procedures`: scope=project+user, type=procedural, semantic search on task
2. Allocate token budget across sections (proportional, with preferences getting priority)
3. Format as a markdown block suitable for system prompt injection
4. Track which memories were surfaced for access_count updates

---

### `promote_memory`

Explicitly promote a memory from a narrower scope to a broader one.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `memory_id` | string | yes | Memory to promote |
| `target_scope` | enum | yes | `project` or `user` (must be broader than current) |
| `reason` | string | no | Why this memory is being promoted |

**Returns:**
```json
{
  "memory_id": "memory:ulid",
  "previous_scope": "session",
  "new_scope": "project",
  "reason": "Reusable pattern for error handling"
}
```

**Server-side behavior:**
1. Validate that `target_scope` is broader than current scope
2. UPDATE memory SET `scope = $target_scope`, record promotion in `memory_history`
3. If promoting session→project: detach from session_id (memory persists beyond session)

---

### `tag_memory`

Add or remove tags on a memory.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `memory_id` | string | yes | Memory to tag |
| `add` | string[] | no | Tags to add |
| `remove` | string[] | no | Tags to remove |

**Returns:**
```json
{
  "memory_id": "memory:ulid",
  "tags": ["architecture", "decisions", "grpc"]
}
```

---

## MCP Resources

MCP resources provide passive, read-only context that Claude can reference without making an explicit tool call. The MCP protocol lets Claude read these via `resource://` URIs.

### `memory://status`

Current connection status and aggregate statistics. Same data as `get_memory_status` but as a readable resource.

```yaml
uri: memory://status
name: Memory System Status
description: Connection health, memory counts, and storage statistics
mimeType: application/json
```

### `memory://session/summary`

Summary of the current session's memory activity.

```yaml
uri: memory://session/summary
name: Current Session Summary
description: Memories stored, recalled, and consolidated this session
mimeType: text/markdown
```

Content example:
```markdown
## Session Memory Summary
**Session:** session:abc123 | Started: 2026-02-23 10:00
**Memories stored:** 12 (7 episodic, 4 semantic, 1 procedural)
**Memories recalled:** 23 queries, 45 unique memories served
**Key topics:** authentication, gRPC migration, error handling
```

### `memory://project/knowledge-graph`

Overview of the project-scope knowledge graph — entities, relationship types, and density.

```yaml
uri: memory://project/knowledge-graph
name: Project Knowledge Graph
description: Entity and relationship overview for the current project
mimeType: text/markdown
```

### `memory://user/preferences`

User preferences and behavioral patterns extracted from cross-project memories.

```yaml
uri: memory://user/preferences
name: User Preferences
description: Learned user preferences and coding patterns
mimeType: text/markdown
```

---

## Tool Schemas

Full JSON Schema definitions for each tool's `inputSchema` as registered with the MCP protocol.

### store_memory

```json
{
  "name": "store_memory",
  "description": "Store a new memory with content, classification, and metadata. Embeddings are generated automatically.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "content": {
        "type": "string",
        "description": "The memory content — an observation, fact, procedure, or interaction to remember"
      },
      "type": {
        "type": "string",
        "enum": ["episodic", "semantic", "procedural"],
        "description": "Memory type: episodic (events/interactions), semantic (facts/knowledge), procedural (how-to/patterns)"
      },
      "scope": {
        "type": "string",
        "enum": ["session", "project", "user"],
        "description": "Memory scope: session (current conversation), project (current codebase), user (cross-project)"
      },
      "importance": {
        "type": "number",
        "minimum": 0,
        "maximum": 1,
        "default": 0.5,
        "description": "Importance score from 0.0 to 1.0. Higher values are recalled more often and resisted during consolidation."
      },
      "tags": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Freeform labels for categorization and filtering"
      },
      "source": {
        "type": "object",
        "properties": {
          "tool": { "type": "string", "description": "MCP tool that produced this memory" },
          "file": { "type": "string", "description": "File path relevant to this memory" },
          "conversation_turn": { "type": "integer", "description": "Conversation turn number" }
        },
        "additionalProperties": false
      },
      "related_entities": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "name": { "type": "string" },
            "type": { "type": "string", "description": "Entity type: component, file, person, concept, library, service, etc." },
            "relationship": { "type": "string", "description": "Relationship label: uses, depends_on, authored_by, implements, etc." }
          },
          "required": ["name", "type", "relationship"]
        },
        "description": "Entities to link in the knowledge graph"
      },
      "session_id": {
        "type": "string",
        "description": "Session ID to associate with. Defaults to the current session."
      }
    },
    "required": ["content", "type", "scope"]
  }
}
```

### recall_memories

```json
{
  "name": "recall_memories",
  "description": "Retrieve memories by semantic query with scope filtering, search strategy selection, and relevance ranking.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "description": "Natural language query for semantic search"
      },
      "scope": {
        "oneOf": [
          { "type": "string", "enum": ["session", "project", "user"] },
          { "type": "array", "items": { "type": "string", "enum": ["session", "project", "user"] } }
        ],
        "description": "Scope filter. Single value or array. Defaults to all scopes."
      },
      "type": {
        "oneOf": [
          { "type": "string", "enum": ["episodic", "semantic", "procedural"] },
          { "type": "array", "items": { "type": "string", "enum": ["episodic", "semantic", "procedural"] } }
        ],
        "description": "Type filter. Single value or array. Defaults to all types."
      },
      "strategy": {
        "type": "string",
        "enum": ["vector", "keyword", "hybrid", "graph"],
        "default": "hybrid",
        "description": "Search strategy: vector (embedding similarity), keyword (full-text), hybrid (both + RRF), graph (entity traversal)"
      },
      "limit": {
        "type": "integer",
        "minimum": 1,
        "maximum": 50,
        "default": 10,
        "description": "Maximum number of results"
      },
      "min_importance": {
        "type": "number",
        "minimum": 0,
        "maximum": 1,
        "default": 0,
        "description": "Minimum importance score to include"
      },
      "tags": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Filter to memories with ANY of these tags"
      },
      "time_range": {
        "type": "object",
        "properties": {
          "after": { "type": "string", "format": "date-time" },
          "before": { "type": "string", "format": "date-time" }
        },
        "description": "Temporal filter using ISO 8601 timestamps"
      },
      "include_forgotten": {
        "type": "boolean",
        "default": false,
        "description": "Include soft-deleted memories in results"
      }
    },
    "required": ["query"]
  }
}
```

### search_knowledge_graph

```json
{
  "name": "search_knowledge_graph",
  "description": "Traverse the knowledge graph to discover entity relationships and connected memories.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "entity": {
        "type": "string",
        "description": "Entity name to look up. Omit for a graph overview."
      },
      "relationship_type": {
        "type": "string",
        "description": "Filter edges by relationship type (e.g., uses, depends_on, authored_by)"
      },
      "direction": {
        "type": "string",
        "enum": ["outgoing", "incoming", "both"],
        "default": "both"
      },
      "depth": {
        "type": "integer",
        "minimum": 1,
        "maximum": 3,
        "default": 1,
        "description": "Maximum traversal hops"
      },
      "include_memories": {
        "type": "boolean",
        "default": true,
        "description": "Include memories linked to discovered entities"
      },
      "limit": {
        "type": "integer",
        "minimum": 1,
        "maximum": 100,
        "default": 20
      }
    }
  }
}
```

### forget_memory

```json
{
  "name": "forget_memory",
  "description": "Soft-delete a memory. The memory is excluded from recall by default but remains in the database.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "memory_id": {
        "type": "string",
        "description": "The memory record ID (e.g., memory:ulid)"
      },
      "reason": {
        "type": "string",
        "description": "Reason for forgetting (stored for audit trail)"
      }
    },
    "required": ["memory_id"]
  }
}
```

### update_memory

```json
{
  "name": "update_memory",
  "description": "Update a memory's content, metadata, importance, tags, or entity relationships.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "memory_id": {
        "type": "string",
        "description": "The memory record ID"
      },
      "content": {
        "type": "string",
        "description": "New content (triggers re-embedding)"
      },
      "importance": {
        "type": "number",
        "minimum": 0,
        "maximum": 1
      },
      "tags": {
        "type": "object",
        "properties": {
          "add": { "type": "array", "items": { "type": "string" } },
          "remove": { "type": "array", "items": { "type": "string" } }
        }
      },
      "metadata": {
        "type": "object",
        "additionalProperties": true,
        "description": "Arbitrary key-value pairs to merge into existing metadata"
      },
      "related_entities": {
        "type": "object",
        "properties": {
          "add": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "name": { "type": "string" },
                "type": { "type": "string" },
                "relationship": { "type": "string" }
              },
              "required": ["name", "type", "relationship"]
            }
          },
          "remove": {
            "type": "array",
            "items": { "type": "string" },
            "description": "Entity names to unlink"
          }
        }
      }
    },
    "required": ["memory_id"]
  }
}
```

### reflect_and_consolidate

```json
{
  "name": "reflect_and_consolidate",
  "description": "Analyze session memories and produce consolidated insights — summarize episodic memories into semantic ones, extract recurring patterns into procedural memories.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "session_id": {
        "type": "string",
        "description": "Session to consolidate. Defaults to current session."
      },
      "strategy": {
        "type": "string",
        "enum": ["summarize", "extract_patterns", "full"],
        "default": "full",
        "description": "Consolidation strategy: summarize (compress episodic→semantic), extract_patterns (find recurring themes), full (both)"
      },
      "dry_run": {
        "type": "boolean",
        "default": false,
        "description": "If true, return what would be consolidated without writing to the database"
      }
    }
  }
}
```

### get_memory_status

```json
{
  "name": "get_memory_status",
  "description": "Return connection health, memory counts by scope and type, storage statistics, and current session info.",
  "inputSchema": {
    "type": "object",
    "properties": {}
  }
}
```

### get_memory_context

```json
{
  "name": "get_memory_context",
  "description": "Assemble a pre-formatted context block of relevant memories for the current task. Used by hooks for automatic context injection.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "task_description": {
        "type": "string",
        "description": "What Claude is currently working on (improves relevance ranking)"
      },
      "files_in_context": {
        "type": "array",
        "items": { "type": "string" },
        "description": "File paths currently in Claude's context (for project memory filtering)"
      },
      "max_tokens": {
        "type": "integer",
        "minimum": 100,
        "maximum": 8000,
        "default": 2000,
        "description": "Token budget for the context block"
      },
      "sections": {
        "type": "array",
        "items": {
          "type": "string",
          "enum": ["preferences", "project_context", "session_history", "relevant_procedures"]
        },
        "description": "Which sections to include. Defaults to all."
      }
    }
  }
}
```

### promote_memory

```json
{
  "name": "promote_memory",
  "description": "Promote a memory from a narrower scope to a broader one (session→project, session→user, project→user).",
  "inputSchema": {
    "type": "object",
    "properties": {
      "memory_id": {
        "type": "string",
        "description": "Memory to promote"
      },
      "target_scope": {
        "type": "string",
        "enum": ["project", "user"],
        "description": "Target scope (must be broader than the memory's current scope)"
      },
      "reason": {
        "type": "string",
        "description": "Reason for promotion"
      }
    },
    "required": ["memory_id", "target_scope"]
  }
}
```

### tag_memory

```json
{
  "name": "tag_memory",
  "description": "Add or remove tags on a memory for organization and filtering.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "memory_id": {
        "type": "string",
        "description": "Memory to tag"
      },
      "add": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Tags to add"
      },
      "remove": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Tags to remove"
      }
    },
    "required": ["memory_id"]
  }
}
```

---

## Embedding Strategy

### Approach: Bundled Local Model

The MCP server generates embeddings locally using a lightweight ONNX model bundled with the plugin. This avoids external API dependencies and keeps all data local.

**Recommended model:** `all-MiniLM-L6-v2` via the `@xenova/transformers` npm package (Transformers.js)

| Property | Value |
|----------|-------|
| Dimensions | 384 |
| Model size | ~23MB (quantized) |
| Inference time | ~5-15ms per text on CPU |
| Quality | Competitive with OpenAI ada-002 for short texts |
| Privacy | Fully local, no network calls |

### Why not SurrealDB built-in ML?

SurrealDB v2.x has SurrealML for running ML models inside the database. However:
- SurrealML model loading adds startup complexity
- The ONNX runtime in Node.js (via Transformers.js) is mature and well-tested
- Keeping embedding generation in the MCP server gives us control over batching, caching, and model swapping
- We can cache the model after first load — subsequent embeddings are near-instant

### Why not an external embedding API?

- Adds latency (network round-trip)
- Requires API keys and network access
- Breaks offline/air-gapped use cases
- Cost per embedding adds up with frequent memory operations
- Privacy concern — memory content leaves the machine

### Implementation

```javascript
// mcp/embeddings.js
import { pipeline } from '@xenova/transformers';

let embedder = null;

export async function initEmbeddings() {
  embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
    quantized: true,
    // Cache model in plugin directory
    cache_dir: path.join(PLUGIN_ROOT, '.cache', 'models')
  });
}

export async function generateEmbedding(text) {
  if (!embedder) await initEmbeddings();
  const output = await embedder(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data); // Float32Array → plain array for SurrealDB
}
```

### Embedding in SurrealDB

SurrealDB stores vectors natively and supports vector search operators:

```sql
-- Define the vector field on memory table
DEFINE FIELD embedding ON memory TYPE array<float, 384>;

-- Define vector index for fast similarity search
DEFINE INDEX idx_memory_embedding ON memory FIELDS embedding MTREE DIMENSION 384 DIST COSINE;

-- Vector search query
SELECT *, vector::similarity::cosine(embedding, $query_vec) AS score
  FROM memory
  WHERE embedding <|10|> $query_vec
  ORDER BY score DESC;
```

---

## Connection Lifecycle

### Startup Sequence

```
Server process starts (spawned by Claude Code via MCP stdio)
  │
  ├─ 1. Load configuration
  │     Read .claude/surrealdb-memory.local.md (or environment variables)
  │     Determine deployment mode: in-memory | file-backed | remote
  │
  ├─ 2. Initialize embedding model
  │     Load ONNX model (cached after first run, ~2s cold, ~100ms warm)
  │
  ├─ 3. Connect to SurrealDB
  │     ├─ In-memory/file-backed: import surrealdb + surrealkv, open embedded
  │     └─ Remote: WebSocket connect to ws://host:port
  │     Authenticate (namespace + database + credentials)
  │
  ├─ 4. Run schema migrations
  │     Ensure tables, indexes, and fields exist (idempotent DEFINE statements)
  │
  ├─ 5. Initialize/resume session
  │     Create new session record or resume if session_id provided in env
  │
  └─ 6. Register MCP tools and resources
        Server is ready — respond to MCP initialize handshake
```

### Connection Modes

The server adapts its connection strategy based on the configured deployment mode (see [[Multi-Deployment Architecture]]):

| Mode | Connection Method | Library |
|------|-------------------|---------|
| `embedded-memory` | In-process, no network | `surrealdb` + `surrealdb.node` (native binding) |
| `embedded-file` | In-process, file-backed | `surrealdb` + `surrealdb.node` (native binding) |
| `local-server` | WebSocket to localhost | `surrealdb` (WebSocket transport) |
| `remote` | WebSocket to remote host | `surrealdb` (WebSocket transport) |

### Reconnection

For WebSocket modes (`local-server`, `remote`):

```
Connection lost
  │
  ├─ Attempt 1: immediate retry
  ├─ Attempt 2: after 1s
  ├─ Attempt 3: after 2s
  ├─ Attempt 4: after 4s
  └─ Attempt 5: after 8s (give up, enter degraded mode)
```

In degraded mode:
- All write tools (`store_memory`, `update_memory`, etc.) queue operations to an in-memory buffer
- Read tools return a `{ "degraded": true, "message": "..." }` warning with best-effort cached results
- Background reconnection attempts continue every 30s
- On reconnection: flush queued writes in order

### Shutdown

When the MCP server receives a shutdown signal (SIGTERM from Claude Code, or MCP close):

1. If session active: run a lightweight session summary (not full consolidation)
2. Flush any queued writes
3. Close SurrealDB connection
4. Exit cleanly

---

## Error Handling and Graceful Degradation

### Principle: Never Block Claude

The memory system is an enhancement, not a dependency. If memory is unavailable, Claude should work normally without it. Every tool must handle errors gracefully.

### Error Categories

| Category | Behavior | User-Facing |
|----------|----------|-------------|
| **Connection failure** | Enter degraded mode; queue writes, warn on reads | Tool returns `{ "error": "memory_unavailable", "degraded": true }` |
| **Query timeout** | Return partial results if available, else empty | Tool returns `{ "memories": [], "warning": "query_timeout" }` |
| **Embedding failure** | Store memory without embedding (keyword-only searchable) | Tool returns `{ "warning": "embedding_failed", "searchable_by": "keyword_only" }` |
| **Schema mismatch** | Attempt auto-migration; if fails, log and continue | Logged, not surfaced unless it blocks operations |
| **Invalid input** | Return MCP error with descriptive message | Standard MCP error response |
| **Storage full** | Log warning; reject new writes with clear message | `{ "error": "storage_full", "current_size": "...", "limit": "..." }` |

### Error Response Format

All tools use a consistent error envelope:

```json
{
  "error": "error_code",
  "message": "Human-readable description",
  "degraded": false,
  "retry_possible": true
}
```

When the tool succeeds but with caveats:

```json
{
  "memories": [ ... ],
  "warnings": [
    { "code": "partial_results", "message": "Vector search unavailable, fell back to keyword" }
  ]
}
```

---

## Configuration and .mcp.json

### Plugin's .mcp.json

The plugin registers the MCP server in its `.mcp.json` file, which Claude Code reads when the plugin is installed:

```json
{
  "mcpServers": {
    "surrealdb-memory": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/mcp/server.js"],
      "env": {
        "MEMORY_CONFIG_PATH": "${HOME}/.claude/surrealdb-memory.local.md",
        "MEMORY_LOG_LEVEL": "info",
        "NODE_OPTIONS": "--experimental-vm-modules"
      }
    }
  }
}
```

### Environment Variables

The server reads these from the environment (set in `.mcp.json` env or by the plugin setup wizard):

| Variable | Description | Default |
|----------|-------------|---------|
| `MEMORY_CONFIG_PATH` | Path to the config file | `~/.claude/surrealdb-memory.local.md` |
| `MEMORY_LOG_LEVEL` | Log verbosity: `debug`, `info`, `warn`, `error` | `info` |
| `MEMORY_DEPLOYMENT_MODE` | Override: `embedded-memory`, `embedded-file`, `local-server`, `remote` | Read from config |
| `MEMORY_DB_PATH` | Override: file path for embedded-file mode | Read from config |
| `MEMORY_REMOTE_URL` | Override: WebSocket URL for remote mode | Read from config |
| `MEMORY_SESSION_ID` | Resume a specific session (used by hooks for continuity) | Auto-generated |

### Configuration File Format

The config file at `~/.claude/surrealdb-memory.local.md` is a markdown file with YAML frontmatter (readable by both humans and the server):

```markdown
---
deployment_mode: embedded-file
db_path: ~/.claude/surrealdb-memory/data
namespace: memory
database: default
embedding_model: all-MiniLM-L6-v2
embedding_dimensions: 384
max_memories_per_session: 100
consolidation_on_shutdown: true
log_level: info
---

# SurrealDB Memory Configuration

This file configures the SurrealDB memory plugin for Claude Code.
Edit the YAML frontmatter above to change settings.
Run the setup wizard to regenerate: `claude plugin configure surrealdb-memory`

## Remote Mode Settings (only used when deployment_mode is "remote")

```yaml
remote_url: ws://localhost:8000
remote_user: root
remote_pass: root
```
```

The server parses this file at startup using a simple frontmatter parser (e.g., `gray-matter` npm package).

---

## Server Implementation Structure

### File Layout

```
mcp/
  server.js              ← Entry point: MCP server setup, tool/resource registration
  config.js              ← Configuration loading from env + config file
  connection.js          ← SurrealDB connection management (all modes)
  embeddings.js          ← Local embedding model (Transformers.js)
  schema.js              ← Database schema definitions and migrations
  tools/
    store.js             ← store_memory implementation
    recall.js            ← recall_memories implementation
    graph.js             ← search_knowledge_graph implementation
    forget.js            ← forget_memory implementation
    update.js            ← update_memory implementation
    consolidate.js       ← reflect_and_consolidate implementation
    status.js            ← get_memory_status implementation
    context.js           ← get_memory_context implementation
    promote.js           ← promote_memory implementation
    tag.js               ← tag_memory implementation
  resources/
    status.js            ← memory://status resource
    session.js           ← memory://session/summary resource
    graph.js             ← memory://project/knowledge-graph resource
    preferences.js       ← memory://user/preferences resource
  lib/
    scoring.js           ← Relevance scoring, RRF merging, composite ranking
    session.js           ← Session management (create, resume, summarize)
    queue.js             ← Write queue for degraded mode
    errors.js            ← Error types and consistent error responses
    tokens.js            ← Token counting for context budget management
```

### Entry Point (server.js)

```javascript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { connectDB } from './connection.js';
import { initEmbeddings } from './embeddings.js';
import { ensureSchema } from './schema.js';
import { registerTools } from './tools/index.js';
import { registerResources } from './resources/index.js';

const config = await loadConfig();

const server = new Server({
  name: 'surrealdb-memory',
  version: '0.1.0',
}, {
  capabilities: {
    tools: {},
    resources: { subscribe: true },
  },
});

// Initialize subsystems
const db = await connectDB(config);
await initEmbeddings(config);
await ensureSchema(db);

// Register all tools and resources
registerTools(server, db, config);
registerResources(server, db, config);

// Start listening on stdio
const transport = new StdioServerTransport();
await server.connect(transport);
```

### Tool Registration Pattern

Each tool module exports a registration function:

```javascript
// tools/store.js
import { generateEmbedding } from '../embeddings.js';

export function registerStoreTool(server, db) {
  server.setRequestHandler('tools/call', async (request) => {
    if (request.params.name !== 'store_memory') return;

    const { content, type, scope, importance, tags, source, related_entities, session_id } = request.params.arguments;

    // Generate embedding
    let embedding;
    let embeddingWarning;
    try {
      embedding = await generateEmbedding(content);
    } catch (err) {
      embeddingWarning = 'Embedding generation failed; memory stored with keyword search only';
    }

    // Build record
    const record = {
      content,
      type,
      scope,
      importance: importance ?? 0.5,
      tags: tags ?? [],
      source: source ?? {},
      embedding: embedding ?? null,
      session_id: session_id ?? getCurrentSessionId(),
      forgotten: false,
      consolidated: false,
      access_count: 0,
      version: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Insert
    const [result] = await db.create('memory', record);

    // Handle knowledge graph edges
    let graphEdges = 0;
    if (related_entities?.length) {
      for (const entity of related_entities) {
        await db.query(`
          LET $ent = (SELECT * FROM entity WHERE name = $name AND type = $etype);
          IF array::len($ent) = 0 {
            CREATE entity SET name = $name, type = $etype, created_at = time::now();
          };
          RELATE $memory_id->memory_entity->entity
            SET relationship = $rel, created_at = time::now()
            WHERE entity.name = $name;
        `, {
          name: entity.name,
          etype: entity.type,
          rel: entity.relationship,
          memory_id: result.id,
        });
        graphEdges++;
      }
    }

    const response = {
      memory_id: result.id.toString(),
      embedding_generated: !!embedding,
      graph_edges_created: graphEdges,
      scope,
      type,
    };

    if (embeddingWarning) {
      response.warnings = [{ code: 'embedding_failed', message: embeddingWarning }];
    }

    return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
  });
}
```

---

## Security Considerations

### Data Locality

- All memory data stays on the user's machine (embedded modes) or within their configured remote endpoint
- Embeddings are generated locally — no content sent to external APIs
- The MCP server has no network access beyond the SurrealDB connection

### Authentication

- **Embedded modes:** No authentication needed (single-user, same-process access)
- **Remote mode:** Credentials stored in `surrealdb-memory.local.md` (which is `.gitignore`'d by convention)
- The config file should be user-readable only: `chmod 600 ~/.claude/surrealdb-memory.local.md`

### Content Sensitivity

- Memories may contain code snippets, error messages, file paths, and user preferences
- The `forget_memory` tool provides a mechanism to remove sensitive content
- No telemetry, analytics, or external reporting from the MCP server

### Input Validation

- All tool inputs are validated against JSON Schema before processing
- SurrealDB parameterized queries prevent injection
- Entity names and tags are sanitized (alphanumeric + common punctuation only)

---

## SurrealDB Schema

The MCP server ensures this schema exists at startup via idempotent `DEFINE` statements:

```sql
-- Namespace and database
DEFINE NAMESPACE IF NOT EXISTS memory;
USE NS memory;
DEFINE DATABASE IF NOT EXISTS default;
USE DB default;

-- Memory table
DEFINE TABLE IF NOT EXISTS memory SCHEMAFULL;
DEFINE FIELD content       ON memory TYPE string;
DEFINE FIELD type          ON memory TYPE string ASSERT $value IN ['episodic', 'semantic', 'procedural'];
DEFINE FIELD scope         ON memory TYPE string ASSERT $value IN ['session', 'project', 'user'];
DEFINE FIELD importance    ON memory TYPE float  DEFAULT 0.5;
DEFINE FIELD tags          ON memory TYPE array<string> DEFAULT [];
DEFINE FIELD source        ON memory TYPE object DEFAULT {};
DEFINE FIELD embedding     ON memory TYPE option<array<float, 384>>;
DEFINE FIELD session_id    ON memory TYPE option<string>;
DEFINE FIELD forgotten     ON memory TYPE bool   DEFAULT false;
DEFINE FIELD forgotten_at  ON memory TYPE option<datetime>;
DEFINE FIELD forgotten_reason ON memory TYPE option<string>;
DEFINE FIELD consolidated  ON memory TYPE bool   DEFAULT false;
DEFINE FIELD derived_from  ON memory TYPE array<record<memory>> DEFAULT [];
DEFINE FIELD access_count  ON memory TYPE int    DEFAULT 0;
DEFINE FIELD last_accessed ON memory TYPE option<datetime>;
DEFINE FIELD version       ON memory TYPE int    DEFAULT 1;
DEFINE FIELD metadata      ON memory TYPE object DEFAULT {};
DEFINE FIELD created_at    ON memory TYPE datetime DEFAULT time::now();
DEFINE FIELD updated_at    ON memory TYPE datetime DEFAULT time::now();

-- Indexes
DEFINE INDEX idx_memory_scope      ON memory FIELDS scope;
DEFINE INDEX idx_memory_type       ON memory FIELDS type;
DEFINE INDEX idx_memory_session    ON memory FIELDS session_id;
DEFINE INDEX idx_memory_forgotten  ON memory FIELDS forgotten;
DEFINE INDEX idx_memory_importance ON memory FIELDS importance;
DEFINE INDEX idx_memory_tags       ON memory FIELDS tags;
DEFINE INDEX idx_memory_created    ON memory FIELDS created_at;
DEFINE INDEX idx_memory_embedding  ON memory FIELDS embedding MTREE DIMENSION 384 DIST COSINE;
DEFINE ANALYZER memory_analyzer TOKENIZERS blank, class FILTERS ascii, lowercase, snowball(english);
DEFINE INDEX idx_memory_content_ft ON memory FIELDS content SEARCH ANALYZER memory_analyzer BM25;

-- Entity table (knowledge graph nodes)
DEFINE TABLE IF NOT EXISTS entity SCHEMAFULL;
DEFINE FIELD name       ON entity TYPE string;
DEFINE FIELD type       ON entity TYPE string;
DEFINE FIELD metadata   ON entity TYPE object DEFAULT {};
DEFINE FIELD created_at ON entity TYPE datetime DEFAULT time::now();
DEFINE FIELD updated_at ON entity TYPE datetime DEFAULT time::now();
DEFINE INDEX idx_entity_name ON entity FIELDS name;
DEFINE INDEX idx_entity_type ON entity FIELDS type;
DEFINE INDEX idx_entity_name_type ON entity FIELDS name, type UNIQUE;

-- Knowledge graph edges (memory ↔ entity)
DEFINE TABLE IF NOT EXISTS memory_entity TYPE RELATION IN memory OUT entity SCHEMAFULL;
DEFINE FIELD relationship ON memory_entity TYPE string;
DEFINE FIELD created_at   ON memory_entity TYPE datetime DEFAULT time::now();

-- Entity-to-entity relationships
DEFINE TABLE IF NOT EXISTS relates_to TYPE RELATION IN entity OUT entity SCHEMAFULL;
DEFINE FIELD relationship ON relates_to TYPE string;
DEFINE FIELD weight       ON relates_to TYPE float DEFAULT 1.0;
DEFINE FIELD created_at   ON relates_to TYPE datetime DEFAULT time::now();

-- Memory history (audit log)
DEFINE TABLE IF NOT EXISTS memory_history SCHEMAFULL;
DEFINE FIELD memory_id    ON memory_history TYPE record<memory>;
DEFINE FIELD content      ON memory_history TYPE string;
DEFINE FIELD importance   ON memory_history TYPE float;
DEFINE FIELD tags         ON memory_history TYPE array<string>;
DEFINE FIELD version      ON memory_history TYPE int;
DEFINE FIELD changed_at   ON memory_history TYPE datetime DEFAULT time::now();
DEFINE INDEX idx_history_memory ON memory_history FIELDS memory_id;

-- Session table
DEFINE TABLE IF NOT EXISTS session SCHEMAFULL;
DEFINE FIELD project_path ON session TYPE option<string>;
DEFINE FIELD started_at   ON session TYPE datetime DEFAULT time::now();
DEFINE FIELD ended_at     ON session TYPE option<datetime>;
DEFINE FIELD summary      ON session TYPE option<string>;
DEFINE FIELD memory_count ON session TYPE int DEFAULT 0;
```

---

## Hybrid Search Implementation Detail

The `recall_memories` tool's hybrid strategy is the most complex query. Here is the implementation approach:

### Reciprocal Rank Fusion (RRF)

RRF merges ranked lists from vector and keyword search without requiring score normalization:

```
RRF_score(doc) = Σ  1 / (k + rank_i(doc))
```

Where `k = 60` (standard constant) and `rank_i` is the document's rank in result list `i`.

### SurrealQL Implementation

```sql
-- Vector search (top N candidates)
LET $vec_results = (
  SELECT id, content, type, scope, importance, tags, created_at, access_count,
         vector::similarity::cosine(embedding, $query_vec) AS vec_score
  FROM memory
  WHERE embedding <|50|> $query_vec
    AND forgotten = false
    AND ($scope_filter IS NONE OR scope IN $scope_filter)
    AND ($type_filter IS NONE OR type IN $type_filter)
    AND importance >= $min_importance
  ORDER BY vec_score DESC
  LIMIT 50
);

-- Keyword search (top N candidates)
LET $kw_results = (
  SELECT id, content, type, scope, importance, tags, created_at, access_count,
         search::score(1) AS kw_score
  FROM memory
  WHERE content @1@ $query_text
    AND forgotten = false
    AND ($scope_filter IS NONE OR scope IN $scope_filter)
    AND ($type_filter IS NONE OR type IN $type_filter)
    AND importance >= $min_importance
  ORDER BY kw_score DESC
  LIMIT 50
);

-- RRF merge happens in application code (Node.js)
-- because SurrealQL doesn't natively support cross-query rank fusion
```

The application layer then:
1. Assigns ranks to each result in each list
2. Computes RRF scores
3. Applies the composite scoring formula: `final = rrf * 0.6 + importance * 0.2 + recency * 0.2`
4. Sorts and truncates to `limit`

---

## Performance Considerations

| Operation | Target Latency | Notes |
|-----------|----------------|-------|
| `store_memory` | < 50ms | Embedding is ~10ms, DB insert is ~5ms |
| `recall_memories` (vector) | < 100ms | MTREE index makes this fast |
| `recall_memories` (hybrid) | < 200ms | Two parallel queries + RRF merge |
| `search_knowledge_graph` (depth 1) | < 50ms | Single graph traversal |
| `search_knowledge_graph` (depth 3) | < 200ms | Multi-hop, bounded by limit |
| `get_memory_context` | < 300ms | Multiple recall queries in parallel |
| `reflect_and_consolidate` | < 2s | Reads all session memories, clusters, writes summaries |
| Embedding model cold start | ~2s | First embedding after server start; cached thereafter |

These targets assume embedded mode with < 10,000 memories. Remote mode adds network latency.

---

## Testing Strategy

### Unit Tests

- Each tool module has isolated tests with a mock SurrealDB connection
- Embedding module tested with known inputs → expected vector shapes
- Scoring module tested with synthetic ranked lists → verified RRF output
- Error handling tested: connection failures, timeouts, invalid input

### Integration Tests

- Spin up an in-memory SurrealDB instance per test suite
- Full round-trip: store → recall → verify content matches
- Knowledge graph: store with entities → traverse → verify edges
- Consolidation: store episodic memories → consolidate → verify semantic memories created
- Degraded mode: disconnect DB mid-operation → verify queue → reconnect → verify flush

### MCP Protocol Tests

- Use `@modelcontextprotocol/sdk` test utilities
- Verify tool registration, schema validation, and response format
- Verify resource URIs resolve correctly

---

## Open Design Questions

1. **Embedding model upgradeability:** If we want to support swapping embedding models later, we need a migration path for re-embedding all stored memories. One approach: store the model name alongside the embedding and re-embed lazily on recall if the model has changed.

2. **Multi-project isolation:** When the same user works on multiple projects, should the MCP server run one SurrealDB database per project (full isolation) or one database with project-scoped namespaces? Namespace isolation is simpler but prevents cross-project knowledge graph queries.

3. **Consolidation trigger:** Should `reflect_and_consolidate` be called automatically at session end (by a hook), or only when Claude explicitly decides to? Automatic is more reliable but adds latency to session shutdown.

4. **Token counting accuracy:** The `get_memory_context` tool needs to count tokens for budget management. Should we bundle a tokenizer (e.g., `tiktoken` for Claude's tokenizer) or use a character-based approximation?

5. **Concurrent sessions:** If a user opens multiple Claude Code windows on the same project, they share the same SurrealDB. The server needs session-level isolation but project-level sharing. This is handled at the query level (filter by session_id) but could have race conditions on consolidation.
