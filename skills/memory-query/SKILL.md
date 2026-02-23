---
name: memory-query
description: |
  This skill should be used when querying or searching SurrealDB memories,
  constructing recall queries, or understanding how to use the memory MCP tools
  effectively. Triggers on: "search memories", "find in memory", "what do I
  remember about", "recall", "check memory for".
---

# Memory Query Patterns

## Available MCP Tools

- `store_memory` — create a memory (content, type, scope, tags, importance)
- `recall_memories` — search by text query with BM25 full-text search
- `forget_memory` — soft-delete a memory
- `get_memory_status` — connection and count stats
- `promote_memory` — move memory to higher scope

## Memory Types

| Type | Use For | Examples |
|------|---------|---------|
| `episodic` | Events, conversations, experiences | "Fixed auth bug by adding token refresh" |
| `semantic` | Facts, knowledge, concepts | "This project uses PostgreSQL 16 with pgvector" |
| `procedural` | Skills, patterns, how-tos | "To deploy, run `cdk deploy --all` from infra/" |
| `working` | Temporary task context | "Currently investigating the CORS issue on /api/users" |

## Memory Scopes

| Scope | Persists | Use For |
|-------|----------|---------|
| `session` | This conversation only | Working context, temporary notes |
| `project` | Across sessions in this project | Codebase knowledge, conventions |
| `user` | Across all projects | Personal preferences, cross-project patterns |

## Query Strategies

1. **Broad search**: `recall_memories(query: "authentication")` — finds all auth-related memories
2. **Scoped search**: `recall_memories(query: "test patterns", scope: "project")` — project-specific
3. **Typed search**: `recall_memories(query: "how to deploy", memory_type: "procedural")` — skills only
