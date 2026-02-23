---
name: recall
description: Search and retrieve memories from SurrealDB. Find past knowledge, decisions, and patterns.
allowed-tools: ["recall_memories", "search_knowledge_graph", "get_memory_status"]
argument-hint: "<search query>"
arguments:
  - name: query
    description: What to search for
    required: true
---

Search for memories using the `recall_memories` MCP tool from the surrealdb-memory server.

Pass the query to `recall_memories`. Display results clearly with:
- Memory content
- Type and scope
- When it was created
- Tags
- Relevance score

If no results found, suggest broadening the search or trying different terms.
